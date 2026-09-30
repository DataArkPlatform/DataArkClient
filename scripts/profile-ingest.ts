/**
 * 首扫性能剖析：对真实库前 N 个会话分别计时 读(readSession)/归一化(normalize)/写库(dao) 三相。
 * 用法: npx tsx scripts/profile-ingest.ts [N=80]
 */
import { performance } from 'node:perf_hooks'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpencodeReader } from '../src/main/readers/opencode'
import { openRo } from '../src/main/readers/infra/ro-sqlite'
import { openDb } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrations'
import { createDaos } from '../src/main/db/dao'
import { normalizeMessage } from '../src/main/pipeline/normalize'

const N = Number(process.argv[2] ?? 80)

async function main(): Promise<void> {
  const reader = new OpencodeReader()
  const refs = (await reader.listSessions()).slice(0, N)
  console.log(`profiling ${refs.length} sessions`)

  /* 相位1：读取（ro 打开 + SQL iterate + JSON.parse + mappers） */
  const collected: Array<{ extId: string; list: unknown[] }> = []
  const t0 = performance.now()
  let readMsgCount = 0
  for (const ref of refs) {
    const list: unknown[] = []
    for await (const raw of reader.readSession(ref)) {
      list.push(raw)
      readMsgCount++
    }
    collected.push({ extId: ref.extId, list })
  }
  const tRead = performance.now() - t0
  console.log(`[read]      ${tRead.toFixed(0)}ms  (${readMsgCount} msgs)`)

  /* 相位2：归一化（zod 校验 + 块映射降级） */
  const t1 = performance.now()
  const normalized: Array<{ extId: string; msgs: unknown[] }> = []
  let normCount = 0
  for (const { extId, list } of collected) {
    const msgs: unknown[] = []
    let seq = 0
    for (const raw of list) {
      const msg = normalizeMessage(raw as never, {
        sessionId: extId,
        warn: () => {}
      })
      if (msg !== null) {
        ;(msg as { seq: number }).seq = seq++ // 与 ingest.ts 一致：normalize 后重排 seq
        msgs.push(msg)
        normCount++
      }
    }
    normalized.push({ extId, msgs })
  }
  const tNorm = performance.now() - t1
  console.log(`[normalize] ${tNorm.toFixed(0)}ms  (${normCount} msgs)`)

  /* 相位3：写库（upsert + replaceMessages 含 FTS 维护） */
  const dbPath = join(tmpdir(), `dataark-profile-${Date.now()}.db`)
  rmSync(dbPath, { force: true })
  const db = openDb(dbPath)
  migrate(db)
  const daos = createDaos(db)
  const t2 = performance.now()
  let writtenSessions = 0
  for (const item of normalized) {
    daos.sessions.upsertSession({
      id: item.extId,
      source: 'opencode',
      extId: item.extId,
      title: item.extId,
      startedAt: 0,
      updatedAt: Date.now(),
      msgCount: item.msgs.length
    })
    daos.messages.replaceMessages(item.extId, item.msgs as never)
    daos.readState.set('opencode', item.extId, Date.now())
    writtenSessions++
  }
  const tWrite = performance.now() - t2
  console.log(`[write]     ${tWrite.toFixed(0)}ms  (${writtenSessions} sessions)`)
  console.log(
    `TOTAL ${(tRead + tNorm + tWrite).toFixed(0)}ms | share: read ${(tRead / (tRead + tNorm + tWrite) * 100).toFixed(0)}% norm ${(tNorm / (tRead + tNorm + tWrite) * 100).toFixed(0)}% write ${(tWrite / (tRead + tNorm + tWrite) * 100).toFixed(0)}%`
  )
  db.close()
  // 只读句柄兜底关闭
  try {
    ;(reader as unknown as { closeAll?: () => void }).closeAll?.()
  } catch {
    /* noop */
  }
  void openRo
}

void main().catch((err) => {
  console.error('PROFILE FAILED:', err)
  process.exitCode = 1
})
