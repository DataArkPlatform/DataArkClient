/**
 * ingest 编排 —— discover → diff(增量) → read → normalize → hooks → index
 *
 * 一次 ingestSource() 对应一个 ReaderAdapter 的完整扫描：
 * - 以 read_state.high_water 做增量 diff：新会话入库，变更会话重读替换，未变会话跳过
 * - 每个会话的写库（upsert 会话行 + 整会话替换消息 + FTS 重建 + 高水位推进）在单个事务内完成
 * - 单会话错误不阻断整体，汇总进 IngestReport.errors
 *
 * FTS 索引维护位于 DAO（replaceMessages 内部），本模块只做编排。
 */
import { randomUUID } from 'node:crypto'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { ScanProgress, IngestReport } from '../../shared/data-contract'
import type { Message, RawSessionRef, Session } from '../../shared/unified-model'
import type { ReaderAdapter } from '../readers/types'
import { createDaos } from '../db/dao'
import { normalizeMessage } from './normalize'
import { applyHooks, registerHook, type PipelineHook } from './hooks'

export interface IngestOptions {
  /** 进度回调（扫描器/进度 UI 使用） */
  onProgress?: (progress: ScanProgress) => void
  /** 告警回调（降级 / 丢弃 / 非致命错误） */
  warn?: (message: string) => void
  /** 附加处理钩子（在 redact / standardize 之后执行） */
  hooks?: PipelineHook[]
}

export interface SessionDiff {
  ref: RawSessionRef
  kind: 'new' | 'updated' | 'skipped'
}

/** 仅基于 read_state 做增量 diff，不读取任何消息 */
export function diffSessions(
  refs: RawSessionRef[],
  getHighWater: (extId: string) => number | undefined
): SessionDiff[] {
  return refs.map((ref) => {
    const highWater = getHighWater(ref.extId)
    if (highWater === undefined) return { ref, kind: 'new' }
    if (ref.updatedAt > highWater) return { ref, kind: 'updated' }
    return { ref, kind: 'skipped' }
  })
}

/** 扫描并入库单个数据源；返回汇总报告 */
export async function ingestSource(
  reader: ReaderAdapter,
  db: DatabaseType,
  options: IngestOptions = {}
): Promise<IngestReport> {
  const report: IngestReport = { scannedNew: 0, scannedUpdated: 0, skipped: 0, errors: [] }
  const daos = createDaos(db)
  const progress = options.onProgress ?? ((): void => {})
  const warn = options.warn ?? ((message: string): void => console.warn('[ingest]', message))
  // 附加钩子注册进钩子链（redact/standardize 之后），结束后注销，避免污染
  const unregisters = (options.hooks ?? []).map((hook) => registerHook(hook))

  try {
    // 1) discover
    progress({ phase: 'discover', source: reader.source, current: 0, total: 0 })
    let refs: RawSessionRef[]
    try {
      refs = await reader.listSessions()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report.errors.push({ extId: '<discover>', message: `listSessions 失败: ${message}` })
      progress({ phase: 'done', source: reader.source, current: 0, total: 0, message })
      return report
    }
    // 2) diff
    const diffs = diffSessions(refs, (extId) => daos.readState.get(reader.source, extId)?.highWater)
    // 数据量进度：非跳过会话的 sizeHint（字节）之和 = 本次待读总量；跳过=不读取=零工作
    const weightTotal = diffs.reduce(
      (sum, d) => sum + (d.kind !== 'skipped' ? (d.ref.sizeHint ?? 0) : 0),
      0
    )
    let weightDone = 0
    let processed = 0

    // 探测收尾（diff 之后）：报告本次待读数据量，供 renderer 初始化字节加权进度
    progress({
      phase: 'discover',
      source: reader.source,
      current: refs.length,
      total: refs.length,
      message: `发现 ${refs.length} 个会话`,
      weightCurrent: 0,
      weightTotal
    })

    // 3) read → normalize → hooks → 单事务写库
    for (const diff of diffs) {
      if (diff.kind === 'skipped') {
        report.skipped += 1
        continue
      }

      const sessionId = randomUUID()
      const messages: Message[] = []
      let tokensIn: number | undefined
      let tokensOut: number | undefined
      let cost: number | undefined
      let firstSentAt: number | undefined
      let seqCounter = 0

      try {
        const stream = reader.readSession(diff.ref)
        for await (const raw of stream) {
          // 强制归属与序号：以本会话为事实源，保证 (session_id, seq) 一致
          const normalized = normalizeMessage(raw, {
            sessionId,
            warn
          })
          if (normalized === null) continue

          const finalMsg = applyHooks(normalized, {
            source: reader.source,
            sessionId,
            seq: normalized.seq
          })
          if (finalMsg === null) continue

          finalMsg.sessionId = sessionId
          finalMsg.seq = seqCounter
          messages.push(finalMsg)
          seqCounter += 1

          if (firstSentAt === undefined) firstSentAt = finalMsg.sentAt
          tokensIn = addOptional(tokensIn, raw.tokensIn)
          tokensOut = addOptional(tokensOut, raw.tokensOut)
          cost = addOptional(cost, raw.cost)
        }

        const session: Session = {
          id: sessionId,
          source: reader.source,
          extId: diff.ref.extId,
          ...(diff.ref.titleHint !== undefined ? { title: diff.ref.titleHint } : {}),
          ...(diff.ref.directory !== undefined ? { directory: diff.ref.directory } : {}),
          ...(diff.ref.parentExtId !== undefined ? { parentExtId: diff.ref.parentExtId } : {}),
          startedAt: diff.ref.startedAt ?? firstSentAt ?? Date.now(),
          updatedAt: diff.ref.updatedAt,
          msgCount: messages.length,
          ...(tokensIn !== undefined ? { tokensIn } : {}),
          ...(tokensOut !== undefined ? { tokensOut } : {}),
          ...(cost !== undefined ? { cost } : {})
        }

        const write = db.transaction(() => {
          // upsert 冲突时保留原 id，消息必须归属真实会话 id，否则外键失败
          const finalId = daos.sessions.upsertSession(session)
          for (const msg of messages) msg.sessionId = finalId
          daos.messages.replaceMessages(finalId, messages)
          daos.readState.set(reader.source, diff.ref.extId, diff.ref.updatedAt)
        })
        write()

        if (diff.kind === 'new') report.scannedNew += 1
        else report.scannedUpdated += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        report.errors.push({ extId: diff.ref.extId, message })
      }

      processed += 1
      // 该会话的读取工作已完成（含失败尝试）：按其数据量累计进度
      weightDone += diff.ref.sizeHint ?? 0
      progress({
        phase: 'reading',
        source: reader.source,
        current: processed + 1,
        total: refs.length,
        extId: diff.ref.extId,
        weightCurrent: weightDone,
        weightTotal
      })
    }

    progress({
      phase: 'done',
      source: reader.source,
      current: processed,
      total: refs.length,
      message: `新增 ${report.scannedNew} · 更新 ${report.scannedUpdated} · 跳过 ${report.skipped}`,
      weightCurrent: weightDone,
      weightTotal
    })
    return report
  } finally {
    for (const unregister of unregisters) unregister()
  }
}

function addOptional(current: number | undefined, delta: number | undefined): number | undefined {
  if (delta === undefined) return current
  return (current ?? 0) + delta
}
