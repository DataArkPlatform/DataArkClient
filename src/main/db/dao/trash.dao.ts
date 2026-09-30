/**
 * trash DAO —— 回收站：软删除 / 恢复 / 按龄彻底清除
 *
 * 软删除只置 deleted_at；彻底清除会连带清理对应消息的 FTS 索引。
 */
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import type { SessionRow } from './sessions.dao'

const SESSION_COLUMNS = `
  id,
  source,
  ext_id AS extId,
  title,
  directory,
  parent_ext_id AS parentExtId,
  started_at AS startedAt,
  updated_at AS updatedAt,
  msg_count AS msgCount,
  tokens_in AS tokensIn,
  tokens_out AS tokensOut,
  cost,
  starred,
  group_id AS groupId,
  deleted_at AS deletedAt
`

export class TrashDao {
  private readonly listStmt: Statement
  private readonly deleteFtsStmt: Statement

  constructor(private readonly db: DatabaseType) {
    this.listStmt = db.prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    )
    this.deleteFtsStmt = db.prepare('DELETE FROM fts_messages WHERE rowid = ?')
  }

  private idsPlaceholder(ids: readonly string[]): string {
    return ids.map(() => '?').join(', ')
  }

  /** 软删除若干会话（置 deleted_at），返回实际删除数 */
  softDeleteSessions(ids: readonly string[], deletedAt = Date.now()): number {
    if (ids.length === 0) return 0
    const stmt = this.db.prepare(
      `UPDATE sessions SET deleted_at = ? WHERE id IN (${this.idsPlaceholder(ids)}) AND deleted_at IS NULL`
    )
    return stmt.run(deletedAt, ...ids).changes
  }

  /** 恢复若干会话（清 deleted_at），返回实际恢复数 */
  restoreSessions(ids: readonly string[]): number {
    if (ids.length === 0) return 0
    const stmt = this.db.prepare(
      `UPDATE sessions SET deleted_at = NULL WHERE id IN (${this.idsPlaceholder(ids)}) AND deleted_at IS NOT NULL`
    )
    return stmt.run(...ids).changes
  }

  list(): SessionRow[] {
    return this.listStmt.all() as SessionRow[]
  }

  /**
   * 彻底清除指定 id 的软删除会话（级联删消息 + FTS 行同步）。
   * 仅作用于 deleted_at 非空的会话；其余 id 静默忽略。返回实际清除数。
   */
  purgeByIds(ids: readonly string[]): number {
    if (ids.length === 0) return 0
    const doomed = this.db
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM sessions WHERE deleted_at IS NOT NULL AND id IN (${this.idsPlaceholder(ids)})`
      )
      .all(...ids) as SessionRow[]
    if (doomed.length === 0) return 0
    return this.purgeRows(
      doomed,
      `DELETE FROM sessions WHERE deleted_at IS NOT NULL AND id IN (${this.idsPlaceholder(ids)})`,
      [...ids]
    )
  }

  /**
   * 彻底清除 deleted_at 早于 (now - olderThanMs) 的会话（级联删消息），
   * 并同步清理其消息的 FTS 行。返回清除的会话数。
   */
  purgeDeleted(olderThanMs: number, now = Date.now()): number {
    const cutoff = now - olderThanMs
    const doomed = this.db
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < @cutoff`
      )
      .all({ cutoff }) as SessionRow[]
    if (doomed.length === 0) return 0
    return this.purgeRows(
      doomed,
      'DELETE FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < @cutoff',
      [{ cutoff }]
    )
  }

  /** 清除一组已软删除会话：单事务删 sessions + 消息 + FTS 行，返回删除的会话数 */
  private purgeRows(doomed: SessionRow[], deleteSql: string, deleteParams: unknown[]): number {
    const purge = this.db.transaction((): number => {
      const sessionIds = doomed.map((s) => s.id)
      const msgIds = (this.db
        .prepare(`SELECT id FROM messages WHERE session_id IN (${this.idsPlaceholder(sessionIds)})`)
        .all(...sessionIds) as Array<{ id: number }>).map((r) => r.id)
      const result = this.db.prepare(deleteSql).run(...deleteParams)
      for (const msgId of msgIds) this.deleteFtsStmt.run(msgId)
      return result.changes
    })
    return purge()
  }
}
