/**
 * M3 对账脚本 —— 真实 opencode.db 全量 ingest + 增量重扫 + 计数对账 + 性能测量
 *
 * 运行：npx tsx scripts/reconcile-m3.ts [--fresh]
 *   --fresh          先删除临时索引库（默认 %TEMP%\dataark-m3\dataark.db）
 *
 * 流程：
 *   1. 只读探测源库计数（前）——session/message/part + 归档 + 子代理 + 角色/part 类型分布
 *   2. 首次全量 ingest 到临时索引库，记录墙钟时长
 *   3. 对账：源计数 vs 入库计数，逐项归因（角色过滤 / 未知 part 类型 / 归档会话 / 活写增长）
 *   4. 增量重扫：N=未变会话数（全跳过），时长 < 5s
 *   4b. 源库计数（后）——证明读取归因 R 落在 [前,后] 区间（写者只增不删）
 *
 * 退出码：0 通过；非 0 = 首次 ingest >90s / 对账无法归因 / 增量超时 / 任一错误。
 * 全程只读真实库（经 infra/ro-sqlite.ts），索引库只写 %TEMP%。
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openDb } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrations'
import { ingestSource } from '../src/main/pipeline/ingest'
import { openRo } from '../src/main/readers/infra/ro-sqlite'
import { OpencodeReader, resolveDbPath, type OpencodeReadStats } from '../src/main/readers/opencode'

const REAL_DB = resolveDbPath()
const APP_DB_DIR = join(tmpdir(), 'dataark-m3')
const APP_DB = join(APP_DB_DIR, 'dataark.db')

interface SourceCounts {
  sessions: number
  archivedSessions: number
  subagentSessions: number
  messages: number
  parts: number
  messagesByRole: Record<string, number>
  partTypes: Record<string, number>
}

function sum(map: Record<string, number>): number {
  return Object.values(map).reduce((acc, n) => acc + n, 0)
}

/** 只读源库计数（经 infra/ro-sqlite.ts，永不写真实库） */
async function collectSourceCounts(dbPath: string): Promise<SourceCounts> {
  const ro = await openRo(dbPath)
  try {
    const one = (sql: string): number => (ro.db.prepare(sql).get() as { c: number }).c
    const roles = ro.db
      .prepare("SELECT json_extract(data, '$.role') AS role, COUNT(*) AS c FROM message GROUP BY role")
      .all() as Array<{ role: string | null; c: number }>
    const types = ro.db
      .prepare("SELECT json_extract(data, '$.type') AS type, COUNT(*) AS c FROM part GROUP BY type")
      .all() as Array<{ type: string | null; c: number }>
    return {
      sessions: one('SELECT COUNT(*) AS c FROM session'),
      archivedSessions: one('SELECT COUNT(*) AS c FROM session WHERE time_archived IS NOT NULL'),
      subagentSessions: one('SELECT COUNT(*) AS c FROM session WHERE parent_id IS NOT NULL'),
      messages: one('SELECT COUNT(*) AS c FROM message'),
      parts: one('SELECT COUNT(*) AS c FROM part'),
      messagesByRole: Object.fromEntries(roles.map((r) => [r.role ?? '<missing>', r.c])),
      partTypes: Object.fromEntries(types.map((t) => [t.type ?? '<missing>', t.c]))
    }
  } finally {
    ro.close()
  }
}

function pad(s: string, width = 16): string {
  return s.padEnd(width)
}

function printStats(name: string, value: string | number): void {
  console.log(`  ${pad(name)} ${value}`)
}

function fmtMs(ms: number): string {
  return `${ms.toFixed(0)} ms (${(ms / 1000).toFixed(2)} s)`
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fresh = args.includes('--fresh')

  console.log('语料方舟 DataArt · M3 真实数据对账\n')
  console.log(`真实源库: ${REAL_DB}`)
  if (!existsSync(REAL_DB)) {
    console.error(`✘ 真实源库不存在（无法对账）: ${REAL_DB}`)
    process.exitCode = 2
    return
  }

  // ---- 0) 临时索引库 ----
  if (fresh && existsSync(APP_DB_DIR)) {
    rmSync(APP_DB_DIR, { recursive: true, force: true })
    console.log(`[0] --fresh: 已删除临时索引库目录 ${APP_DB_DIR}`)
  }
  mkdirSync(APP_DB_DIR, { recursive: true })
  const db = openDb(APP_DB)
  migrate(db)
  // 已含 opencode 高水位 ⇒ 本次是非 fresh 的增量运行，仅验证增量行为
  const isFullRun = (
    db.prepare("SELECT COUNT(*) AS c FROM read_state WHERE source = 'opencode'").get() as {
      c: number
    }
  ).c === 0
  console.log(`[0] 临时索引库: ${APP_DB} (fresh=${fresh}, 全量运行=${isFullRun})\n`)

  try {
    // ---- 1) 源计数（前）----
    // 注意：真实库正被 opencode 进程活跃写入（本次任务会话持续追加消息/part）。
    // 因此源计数是移动靶：前后各测一次（src / srcPost），读取归因 R 应满足
    //   S1 ≤ R ≤ S2（写者只增不删），差值 = ingest 窗口内活写增长。
    console.log('[1] 源库计数（只读，前）')
    const src = await collectSourceCounts(REAL_DB)
    printStats('sessions', src.sessions)
    printStats('  ├ 归档(排除)', src.archivedSessions)
    printStats('  └ 子代理(parent≠null)', src.subagentSessions)
    printStats('messages', src.messages)
    printStats('  └ 按角色', JSON.stringify(src.messagesByRole))
    printStats('parts', src.parts)
    printStats('  └ 按类型', JSON.stringify(src.partTypes))
    console.log()

    // ---- 2) 首次全量 ingest ----
    const reader = new OpencodeReader()
    const firstStart = performance.now()
    let lastProgress = 0
    const first = await ingestSource(reader, db, {
      onProgress: (p) => {
        if (p.phase === 'reading' && p.current - lastProgress >= 50) {
          lastProgress = p.current
          console.log(`    读取 ${p.current}/${p.total} 会话...`)
        }
      },
      warn: (message) => console.warn(`    [warn] ${message}`)
    })
    const firstElapsed = performance.now() - firstStart
    console.log(`[2] 首次全量 ingest: ${fmtMs(firstElapsed)}`)
    printStats('新增', first.scannedNew)
    printStats('更新', first.scannedUpdated)
    printStats('跳过', first.skipped)
    printStats('错误', first.errors.length)
    for (const e of first.errors) console.error(`    ✘ ${e.extId}: ${e.message}`)
    console.log()

    // ---- 3) 对账 ----
    console.log('[3] 对账（源 vs 入库）')
    const stats: OpencodeReadStats = reader.readSessionStats()
    const ingestedSessions = (
      db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE source = 'opencode'").get() as { c: number }
    ).c
    const ingestedSubagent = (
      db
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE source = 'opencode' AND parent_ext_id IS NOT NULL")
        .get() as { c: number }
    ).c
    const ingestedMessages = (
      db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }
    ).c
    const ingestedBlocks = (
      db
        .prepare('SELECT COALESCE(SUM(json_array_length(blocks)), 0) AS c FROM messages')
        .get() as { c: number }
    ).c

    // 归因推导（读取侧是自洽快照：归因 = 产出 + 跳过 + 损坏）
    const rolesSeenTotal = sum(stats.rolesSeen)
    const rolesSkippedTotal = sum(stats.messagesSkippedByRole)
    const partsSeenTotal = sum(stats.partsByType)
    const partsMappedTotal = sum(stats.partsMapped)
    const partsUnknownTotal = sum(stats.partsUnknown)
    const readerMessages = rolesSeenTotal + stats.malformedMessages // R：读取时刻的消息总量
    const readerParts = partsSeenTotal // R：读取时刻的 part 总量
    const expectedIngestedSessions = src.sessions - src.archivedSessions

    console.log(`  ${pad('会话')}`)
    printStats('  源 session(前)', src.sessions)
    printStats('  - 归档(排除)', src.archivedSessions)
    printStats('  = 期望入库', expectedIngestedSessions)
    printStats('  实际入库', ingestedSessions)
    printStats(
      '  ✔/✘',
      expectedIngestedSessions === ingestedSessions
        ? '✔'
        : `✘ 差 ${ingestedSessions - expectedIngestedSessions}`
    )
    printStats('  子代理入库', ingestedSubagent)
    printStats('  子代理源', src.subagentSessions)
    printStats('  ✔/✘', ingestedSubagent === src.subagentSessions ? '✔' : `✘ 差 ${ingestedSubagent - src.subagentSessions}`)
    console.log()

    console.log(`  ${pad('消息')}`)
    printStats('  源 message(前)', src.messages)
    printStats('  读取归因 R(=入库)', readerMessages)
    printStats('    读取角色分布', JSON.stringify(stats.rolesSeen))
    printStats(
      '    - 跳过角色',
      `${rolesSkippedTotal}（明细 ${JSON.stringify(stats.messagesSkippedByRole)}）`
    )
    printStats('    - 损坏消息行', stats.malformedMessages)
    printStats('    = 产出消息', stats.messagesYielded)
    printStats('  实际入库消息', ingestedMessages)
    printStats(
      '  ✔/✘ 归因=产出=入库',
      readerMessages === stats.messagesYielded && stats.messagesYielded === ingestedMessages ? '✔' : '✘'
    )
    console.log()

    console.log(`  ${pad('内容块')}`)
    printStats('  源 part(前)', src.parts)
    printStats('  读取 part 类型', JSON.stringify(stats.partsByType))
    printStats(
      '  - 未知类型跳过',
      `${partsUnknownTotal}（明细 ${JSON.stringify(stats.partsUnknown)}）`
    )
    printStats('  = 映射块(=入库)', partsMappedTotal)
    printStats('  实际入库块', ingestedBlocks)
    printStats('  ✔/✘', partsMappedTotal === ingestedBlocks ? '✔' : `✘ 差 ${ingestedBlocks - partsMappedTotal}`)
    printStats('  读会话数', stats.sessionsRead)
    console.log()

    // ---- 4) 增量重扫 ----
    // 注意：真实库正被 opencode 进程活跃写入，两次 listSessions 之间可能有少量
    // 会话被更新（updated）或新建（new）。增量正确性 = 未变会话全部跳过（N=skipped），
    // 仅活写增量被重读，且总耗时 < 5s（对比全量 20~60s）。
    const secondStart = performance.now()
    const second = await ingestSource(new OpencodeReader(), db)
    const secondElapsed = performance.now() - secondStart
    console.log(`[4] 增量重扫: ${fmtMs(secondElapsed)}`)
    printStats('跳过 N（未变）', second.skipped)
    printStats('更新（活写增量）', second.scannedUpdated)
    printStats('新增（活写增量）', second.scannedNew)
    printStats('错误', second.errors.length)
    const messagesAfter = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c
    printStats('重扫后消息数', messagesAfter)
    printStats('  ├ 首次后', ingestedMessages)
    printStats('  └ 差(活写增量)', messagesAfter - ingestedMessages)
    console.log()

    // ---- 4b) 源计数（后）----
    // 读取归因 R 应落在 [S1, S2] 区间：S1→R 的差 = ingest 期间活写增长，R→S2 的差 = ingest 后增长。
    console.log('[4b] 源库计数（只读，后）')
    const srcPost = await collectSourceCounts(REAL_DB)
    printStats('sessions', srcPost.sessions)
    printStats('messages', srcPost.messages)
    printStats('parts', srcPost.parts)
    console.log()

    // ---- 5) 判定 ----
    console.log('[5] 判定')
    const failures: string[] = []
    const check = (name: string, ok: boolean, detail: string): void => {
      console.log(`  ${ok ? '✔' : '✘'} ${name}: ${detail}`)
      if (!ok) failures.push(name)
    }
    check('首次 ingest ≤ 90s', firstElapsed <= 90_000, fmtMs(firstElapsed))
    if (isFullRun) {
      check(
        '会话数对账',
        expectedIngestedSessions === ingestedSessions,
        `${expectedIngestedSessions} = ${ingestedSessions}`
      )
      check('子代理数对账', ingestedSubagent === src.subagentSessions,
        `${src.subagentSessions} = ${ingestedSubagent}`)
      check(
        '消息归因闭合',
        readerMessages === stats.messagesYielded && stats.messagesYielded === ingestedMessages,
        `归因 ${readerMessages} = 产出 ${stats.messagesYielded} = 入库 ${ingestedMessages}`
      )
      check(
        '消息读取∈[前,后] 活写归因',
        readerMessages >= src.messages && readerMessages <= srcPost.messages,
        `${src.messages}(前) ≤ R ${readerMessages} ≤ ${srcPost.messages}(后)，差 ${readerMessages - src.messages} = ingest 期间活写增长`
      )
      check('未知 part 类型 = 0', partsUnknownTotal === 0, `未知 ${partsUnknownTotal}`)
      check('块数对账', partsMappedTotal === ingestedBlocks,
        `${partsMappedTotal} = ${ingestedBlocks}`)
      check(
        'part 读取∈[前,后] 活写归因',
        readerParts >= src.parts && readerParts <= srcPost.parts,
        `${src.parts}(前) ≤ R ${readerParts} ≤ ${srcPost.parts}(后)，差 ${readerParts - src.parts} = ingest 期间活写增长`
      )
      check('无 ingest 错误', first.errors.length === 0, `首次 ${first.errors.length}`)
    } else {
      check('本次为非 fresh 增量运行（跳过全量断言）', true,
        '对账全量检查仅在 --fresh 全量运行下断言')
    }
    check('增量无错误', second.errors.length === 0, `增量 ${second.errors.length}`)
    check('增量未变会话全跳过(N≥600)', second.skipped >= 600, `N = ${second.skipped}`)
    check('增量活写增量 ≤ 10%', second.scannedNew + second.scannedUpdated <= 63,
      `new ${second.scannedNew} + updated ${second.scannedUpdated}`)
    check('增量 < 5s', secondElapsed < 5_000, fmtMs(secondElapsed))
    check('增量后消息数不减少', messagesAfter >= ingestedMessages,
      `${messagesAfter} >= ${ingestedMessages}`)

    console.log()
    if (failures.length > 0) {
      console.error(`结果: ${failures.length} 项未通过 -> ${failures.join(' | ')}`)
      process.exitCode = 1
    } else {
      console.log('结果: 全部通过 ✔')
    }
  } finally {
    db.close()
  }
}

void main()
