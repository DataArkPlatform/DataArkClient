/**
 * OpenCode 数据库 schema 版本探测
 *
 * V1：message / part 两表（本机 1.18.x 实测主版本）
 * V2：dev 分支的 session_message 表（type + seq 排序），本适配器暂不支持（读取时抛类型化错误）
 *
 * 关键实测教训（本机 opencode.db v1.18.23，WAL 活跃库）：
 * - `session_message` 表**存在但为空**（0 行），message/part 才是活表。
 *   因此**不能**仅凭「session_message 表存在」判定 V2 —— 那是旧占位探测逻辑的缺陷。
 * - 判定规则（防御性，向后兼容）：
 *   1. session_message 具 V2 形状（含 session_id/type/seq/data 列）且
 *      message 表无数据（或缺失）而 session_message 有数据 → V2
 *   2. message/part 表缺失而 session_message 有数据 → V2
 *   3. 其余（含「session_message 存在但为空」）→ V1
 * - 探测结果每进程只 console.info 一次（避免 658+ 会话读取时刷屏）。
 */
import type { Database as DatabaseType } from 'better-sqlite3'

export type OpenCodeSchemaVersion = 'v1' | 'v2'

/** V2（session_message 存储）尚未实现 —— 读取时抛出，调用方应按错误语义处理 */
export class OpenCodeV2UnsupportedError extends Error {
  constructor(context?: string) {
    super(`OpenCode V2 schema（session_message 存储）暂不支持: ${context ?? '未知会话'}`)
    this.name = 'OpenCodeV2UnsupportedError'
  }
}

export function hasTable(db: DatabaseType, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined
  return row !== undefined
}

/** 表列名集合（表名来自代码内常量，无注入面） */
function tableColumns(db: DatabaseType, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map((r) => r.name))
}

function countRows(db: DatabaseType, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get() as { c: number }
  return row.c
}

let loggedVersion: OpenCodeSchemaVersion | undefined

function logOnce(version: OpenCodeSchemaVersion): void {
  if (loggedVersion === version) return
  loggedVersion = version
  console.info(`[opencode] schema 版本探测: ${version}`)
}

/** V2 活表形状：session_message 应含的列（与本机残留空表区分） */
const V2_REQUIRED_COLUMNS = ['session_id', 'type', 'seq', 'data']

/** 按 sqlite_master + 行数探测版本；每个进程只 log 一次 */
export function detectSchemaVersion(db: DatabaseType): OpenCodeSchemaVersion {
  const hasMessage = hasTable(db, 'message')
  const hasPart = hasTable(db, 'part')
  const hasSessionMessage = hasTable(db, 'session_message')

  if (hasSessionMessage) {
    const cols = tableColumns(db, 'session_message')
    const isV2Shape = V2_REQUIRED_COLUMNS.every((c) => cols.has(c))
    if (isV2Shape) {
      const smCount = countRows(db, 'session_message')
      const msgCount = hasMessage ? countRows(db, 'message') : 0
      // V2 活表：session_message 有数据且 message 表无数据（或缺失）
      if (smCount > 0 && (!hasMessage || msgCount === 0)) {
        logOnce('v2')
        return 'v2'
      }
      // message/part 主表缺失 → 视为 V2（由 unsupported 错误兜底，不静默崩溃）
      if (!hasMessage || !hasPart) {
        logOnce('v2')
        return 'v2'
      }
    }
  }
  logOnce('v1')
  return 'v1'
}
