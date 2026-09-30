/**
 * OpenCode 适配器 —— ★首发数据源（V1 真实数据全量回归 / V2 防御性拒绝）
 *
 * 数据目录（Windows）：%USERPROFILE%\.local\share\opencode\opencode.db
 * 可用 OPENCODE_HOME 环境变量覆盖（指向包含 opencode.db 的目录）。
 *
 * 只读策略：openRo 直读（readonly + WAL 可读）→ 锁冲突自动快照副本兜底，永不写源库。
 * 增量依据：session.time_updated 高水位（listSessions 返回 updatedAt）。
 *
 * V1 读取管线（本机 1.18.x 实测主版本）：
 * - 每条会话一条索引 JOIN 查询，.iterate() 流式消费（不 all()），按 (time_created, id) 有序分组；
 * - message.data 解析 role/agent/modelID/providerID/time{created,completed}/cost/tokens/finish；
 * - 仅保留 user/assistant 角色，其余角色跳过并统计（供对账归因）；
 * - part.data 经 mappers.mapPartToBlock 映射为统一 ContentBlock（未知类型跳过并统计）。
 * - 所有读取统计累计于内部 stats，经 readSessionStats() 暴露给对账脚本。
 *
 * V2（session_message 存储）未实现：检测到即抛 OpenCodeV2UnsupportedError（见 schema-detect）。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ContentBlock, RawMessage, RawSessionRef } from '../../../shared/unified-model'
import type { ReaderAdapter, ReaderAvailability } from '../types'
import { openRo, type RoDatabase } from '../infra/ro-sqlite'
import { appDataDir } from '../infra/app-data'
import { detectSchemaVersion, OpenCodeV2UnsupportedError } from './schema-detect'
import { mapPartToBlock, partTypeOf } from './mappers'

/** 解析 opencode.db 路径（OPENCODE_HOME 覆盖；否则在多个规范数据目录中取首个存在者） */
export function resolveDbPath(): string {
  const home = process.env['OPENCODE_HOME']
  if (home !== undefined && home !== '') return join(home, 'opencode.db')

  const candidates: string[] = []
  const xdgData = process.env['XDG_DATA_HOME']
  if (xdgData !== undefined && xdgData !== '') candidates.push(join(xdgData, 'opencode'))
  // OpenCode 各平台实测位置：XDG data（Linux/Win/macOS 均可能是 ~/.local/share）
  candidates.push(join(homedir(), '.local', 'share', 'opencode'))
  // Electron 风格应用数据目录（%APPDATA% / ~/Library/Application Support / ~/.config）
  candidates.push(join(appDataDir(), 'opencode'))
  const found = candidates.find((dir) => existsSync(join(dir, 'opencode.db')))
  return join(found ?? candidates[0]!, 'opencode.db')
}

interface SessionRow {
  id: string
  title: string | null
  directory: string | null
  parent_id: string | null
  time_created: number | null
  time_updated: number | null
}

interface PartRow {
  messageId: string
  messageData: string | null
  messageTime: number | null
  partData: string | null
}

interface MessageData {
  role?: string
  agent?: string
  modelID?: string
  providerID?: string
  cost?: number
  tokens?: { input?: number; output?: number }
  time?: { created?: number; completed?: number }
  finish?: string
}

/**
 * 读取统计（对账归因用）：
 * - 消息：rolesSeen = 全部消息角色分布；malformedMessages = data 缺失/JSON 解析失败；
 *   messagesSkippedByRole = 非 user/assistant 被跳过；messagesYielded = 实际产出。
 *   恒等式：ΣrolesSeen + malformedMessages = messagesYielded + ΣmessagesSkippedByRole + malformedMessages
 *   = 源 message 行数。
 * - part：partsByType = 全部 part 类型分布；partsUnknown = 未知类型被跳过；partsMapped = 成功映射。
 *   恒等式：ΣpartsByType = ΣpartsMapped + ΣpartsUnknown = 源 part 行数；入库块数 = ΣpartsMapped。
 */
export interface OpencodeReadStats {
  sessionsRead: number
  messagesYielded: number
  rolesSeen: Record<string, number>
  messagesSkippedByRole: Record<string, number>
  malformedMessages: number
  partsByType: Record<string, number>
  partsMapped: Record<string, number>
  partsUnknown: Record<string, number>
}

function emptyStats(): OpencodeReadStats {
  return {
    sessionsRead: 0,
    messagesYielded: 0,
    rolesSeen: {},
    messagesSkippedByRole: {},
    malformedMessages: 0,
    partsByType: {},
    partsMapped: {},
    partsUnknown: {}
  }
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

export class OpencodeReader implements ReaderAdapter {
  readonly source = 'opencode' as const
  private readonly dbPath: string
  private readonly stats: OpencodeReadStats = emptyStats()

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? resolveDbPath()
  }

  /** 本次进程内累计读取统计（对账脚本 / 测试断言用） */
  readSessionStats(): OpencodeReadStats {
    return {
      ...this.stats,
      rolesSeen: { ...this.stats.rolesSeen },
      messagesSkippedByRole: { ...this.stats.messagesSkippedByRole },
      partsByType: { ...this.stats.partsByType },
      partsMapped: { ...this.stats.partsMapped },
      partsUnknown: { ...this.stats.partsUnknown }
    }
  }

  async isAvailable(): Promise<ReaderAvailability> {
    if (!existsSync(this.dbPath)) {
      return { available: false, detail: `数据库不存在: ${this.dbPath}`, unavailableReason: 'no_data' }
    }
    let ro: RoDatabase
    try {
      ro = await openRo(this.dbPath, { retries: 0 })
    } catch (error) {
      return {
        available: false,
        detail: `打开失败: ${error instanceof Error ? error.message : String(error)}`,
        unavailableReason: 'access_denied'
      }
    }
    try {
      const { hasTable } = await import('./schema-detect')
      if (hasTable(ro.db, 'session') && hasTable(ro.db, 'message')) {
        return { available: true, detail: this.dbPath }
      }
      return { available: false, detail: `缺少 session/message 表: ${this.dbPath}`, unavailableReason: 'corrupted' }
    } finally {
      ro.close()
    }
  }

  async listSessions(): Promise<RawSessionRef[]> {
    const ro = await openRo(this.dbPath)
    try {
      const rows = ro.db
        .prepare(
          `SELECT id, title, directory, parent_id, time_created, time_updated
           FROM session WHERE time_archived IS NULL`
        )
        .all() as SessionRow[]
      // 每个会话的内容字节量（part.data 之和）→ sizeHint：进度条按真实数据量加权。
      // 单次 GROUP BY 全表扫描，实测 3.6GB 库约 600ms，可接受。
      const weightRows = ro.db
        .prepare(
          `SELECT session_id AS sid, SUM(LENGTH(data)) AS bytes
           FROM part GROUP BY session_id`
        )
        .all() as Array<{ sid: string; bytes: number | null }>
      const weightMap = new Map(weightRows.map((r) => [r.sid, r.bytes ?? 0]))
      return rows.map((row) => ({
        source: this.source,
        extId: row.id,
        updatedAt: row.time_updated ?? row.time_created ?? 0,
        ...(row.title != null ? { titleHint: row.title } : {}),
        ...(row.directory != null ? { directory: row.directory } : {}),
        ...(row.parent_id != null ? { parentExtId: row.parent_id } : {}),
        ...(row.time_created != null ? { startedAt: row.time_created } : {}),
        sizeHint: weightMap.get(row.id) ?? 0
      }))
    } finally {
      ro.close()
    }
  }

  async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
    const ro = await openRo(this.dbPath)
    try {
      const version = detectSchemaVersion(ro.db)
      if (version === 'v2') {
        // V2 尚未实现：显式抛类型化错误，绝不静默崩溃或产出错误数据
        throw new OpenCodeV2UnsupportedError(ref.extId)
      }
      yield* this.readV1(ro, ref.extId)
    } finally {
      ro.close()
    }
  }

  /**
   * V1：message+part 索引 JOIN 流式读取（每会话一条查询，.iterate() 不 all()），
   * 按 (m.time_created, m.id, p.time_created) 有序 → 消息分组流式产出。
   */
  private async *readV1(ro: RoDatabase, extId: string): AsyncGenerator<RawMessage> {
    const stmt = ro.db.prepare(
      `SELECT
         m.id AS messageId,
         m.data AS messageData,
         m.time_created AS messageTime,
         p.data AS partData
       FROM message m
       LEFT JOIN part p ON p.message_id = m.id
       WHERE m.session_id = @extId
       ORDER BY m.time_created ASC, m.id ASC, p.time_created ASC`
    )
    const iterator = stmt.iterate({ extId }) as IterableIterator<PartRow>

    let currentMessageId: string | null = null
    let pending: { row: PartRow; blocks: ContentBlock[] } | null = null

    for (const row of iterator) {
      if (row.messageId !== currentMessageId) {
        if (pending) {
          const built = this.buildMessage(extId, pending.row, pending.blocks)
          if (built) {
            this.stats.messagesYielded += 1
            yield built
          }
        }
        currentMessageId = row.messageId
        pending = { row, blocks: [] }
      }
      if (row.partData !== null) {
        const part = this.safeParsePart(row.partData)
        if (part === undefined) continue
        const type = partTypeOf(part)
        bump(this.stats.partsByType, type)
        const block = mapPartToBlock(part)
        if (block !== null) {
          bump(this.stats.partsMapped, type)
          pending?.blocks.push(block)
        } else {
          bump(this.stats.partsUnknown, type)
        }
      }
    }
    if (pending) {
      const built = this.buildMessage(extId, pending.row, pending.blocks)
      if (built) {
        this.stats.messagesYielded += 1
        yield built
      }
    }
    this.stats.sessionsRead += 1
  }

  /** part.data JSON 解析；损坏行返回 undefined（不中断整条会话流） */
  private safeParsePart(raw: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed === null || typeof parsed !== 'object') return undefined
      return parsed as Record<string, unknown>
    } catch {
      return undefined
    }
  }

  /** message.data JSON 解析 + 角色统计；失败计入 malformedMessages */
  private parseMessageData(raw: string | null): { data: MessageData; role: string | undefined } {
    if (raw === null || raw === '') {
      this.stats.malformedMessages += 1
      return { data: {}, role: undefined }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.stats.malformedMessages += 1
      return { data: {}, role: undefined }
    }
    if (parsed === null || typeof parsed !== 'object') {
      this.stats.malformedMessages += 1
      return { data: {}, role: undefined }
    }
    const record = parsed as Record<string, unknown>
    const role = typeof record['role'] === 'string' ? (record['role'] as string) : undefined
    bump(this.stats.rolesSeen, role ?? '<missing>')
    return { data: record as MessageData, role }
  }

  /** 组装 RawMessage；仅 user/assistant（其余角色跳过并统计） */
  private buildMessage(
    sessionExtId: string,
    row: PartRow,
    blocks: ContentBlock[]
  ): RawMessage | null {
    const { data, role } = this.parseMessageData(row.messageData)
    if (role !== 'user' && role !== 'assistant') {
      bump(this.stats.messagesSkippedByRole, role ?? '<missing>')
      return null
    }

    return {
      sessionId: sessionExtId,
      role,
      ...(typeof data.agent === 'string' ? { agentName: data.agent } : {}),
      ...(typeof data.modelID === 'string' ? { modelName: data.modelID } : {}),
      ...(typeof data.providerID === 'string' ? { provider: data.providerID } : {}),
      sentAt: data.time?.created ?? row.messageTime ?? 0,
      ...(typeof data.finish === 'string' ? { finishReason: data.finish } : {}),
      ...(data.tokens?.input !== undefined ? { tokensIn: data.tokens.input } : {}),
      ...(data.tokens?.output !== undefined ? { tokensOut: data.tokens.output } : {}),
      ...(data.cost !== undefined ? { cost: data.cost } : {}),
      blocks
    }
  }
}

/** 便捷工厂（registry 惰性加载入口） */
export function createOpencodeReader(dbPath?: string): OpencodeReader {
  return new OpencodeReader(dbPath)
}
