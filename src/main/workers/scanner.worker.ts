/**
 * scanner.worker —— 首次全量扫描 / 批量重解析的工作线程
 *
 * 协议（见 shared/data-contract.ts，仅类型）：
 * - parent → worker：一条 ScannerRequest { cmd:'ingest', source, dbPath? }
 * - worker → parent：若干 ScanProgress 事件，最终一条 ScannerResponse
 *
 * 本文件不涉及 ipcMain 接线（spawn + 事件透传见 src/main/services/scanService.ts）。
 */
import { isMainThread, parentPort } from 'node:worker_threads'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { AgentSource } from '../../shared/unified-model'
import type {
  ScanProgress,
  ScannerPortMessage,
  ScannerRequest,
  ScannerResponse
} from '../../shared/data-contract'
import { getDefaultDbPath, openDb } from '../db/connection'
import { migrate } from '../db/migrations'
import { loadReader } from '../readers/registry'
import { ingestSource } from '../pipeline/ingest'

if (isMainThread) {
  throw new Error('scanner.worker 必须在 worker_thread 中运行')
}
if (parentPort === null) {
  throw new Error('scanner.worker 缺少 parentPort')
}

const port = parentPort

/** 当前 read_state 中已建档的 extId 集合（增量 diff 的基线） */
function collectReadStateExtIds(db: DatabaseType, source: AgentSource): Set<string> {
  const rows = db
    .prepare('SELECT ext_id FROM read_state WHERE source = ?')
    .all(source) as Array<{ ext_id: string }>
  return new Set(rows.map((r) => r.ext_id))
}

async function runJob(request: ScannerRequest): Promise<void> {
  let dbPath = request.dbPath
  try {
    if (dbPath === undefined) dbPath = getDefaultDbPath()
    const db = openDb(dbPath)
    try {
      migrate(db)
      const loadResult = await loadReader(request.source)
      if (loadResult === undefined) {
        postResult({ ok: false, error: `未注册的读取器: ${request.source}` })
        return
      }
      if ('unavailableReason' in loadResult) {
        const reason = loadResult.unavailableReason
        postResult({ ok: false, error: `读取器不可用: ${request.source} (${reason})` })
        return
      }
      const reader = loadResult
      // 高水位在 ingest 内部推进；读取前/后差集即本次新入库的 extId
      const before = collectReadStateExtIds(db, request.source)
      const report = await ingestSource(reader, db, {
        onProgress: (progress: ScanProgress) => {
          const message: ScannerPortMessage = { type: 'progress', payload: progress }
          port.postMessage(message)
        }
      })
      const after = collectReadStateExtIds(db, request.source)
      const newExtIds = [...after].filter((id) => !before.has(id))
      postResult({ ok: true, report, newExtIds })
    } finally {
      if (db.open) db.close()
    }
  } catch (error) {
    postResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function postResult(payload: ScannerResponse): void {
  const message: ScannerPortMessage = { type: 'result', payload }
  port.postMessage(message)
  // 结果投递后让线程自然退出（父进程收到 result 后也会 terminate，双保险）
  setTimeout(() => process.exit(0), 150)
}

port.on('message', (request: ScannerRequest) => {
  void runJob(request)
})
