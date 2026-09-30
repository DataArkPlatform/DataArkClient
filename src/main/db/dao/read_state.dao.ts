/**
 * read_state DAO —— 增量扫描高水位游标（每 source+extId 一条）
 */
import type { Database as DatabaseType, Statement } from 'better-sqlite3'

export interface ReadStateRow {
  source: string
  extId: string
  highWater: number
  scannedAt: number | null
}

export class ReadStateDao {
  private readonly getStmt: Statement
  private readonly upsertStmt: Statement
  private readonly removeStmt: Statement
  private readonly listStmt: Statement

  constructor(private readonly db: DatabaseType) {
    this.getStmt = db.prepare(
      `SELECT source, ext_id AS extId, high_water AS highWater, scanned_at AS scannedAt
       FROM read_state WHERE source = @source AND ext_id = @extId`
    )
    this.upsertStmt = db.prepare(`
      INSERT INTO read_state (source, ext_id, high_water, scanned_at)
      VALUES (@source, @extId, @highWater, @scannedAt)
      ON CONFLICT(source, ext_id) DO UPDATE SET
        high_water = excluded.high_water,
        scanned_at = excluded.scanned_at
    `)
    this.removeStmt = db.prepare('DELETE FROM read_state WHERE source = @source AND ext_id = @extId')
    this.listStmt = db.prepare(
      `SELECT source, ext_id AS extId, high_water AS highWater, scanned_at AS scannedAt
       FROM read_state ORDER BY source, ext_id`
    )
  }

  get(source: string, extId: string): ReadStateRow | undefined {
    return this.getStmt.get({ source, extId }) as ReadStateRow | undefined
  }

  /** upsert 高水位；scanned_at 默认当前时间 */
  set(source: string, extId: string, highWater: number, now = Date.now()): void {
    this.upsertStmt.run({ source, extId, highWater, scannedAt: now })
  }

  remove(source: string, extId: string): void {
    this.removeStmt.run({ source, extId })
  }

  list(source?: string): ReadStateRow[] {
    if (source === undefined) return this.listStmt.all() as ReadStateRow[]
    return this.db
      .prepare(
        `SELECT source, ext_id AS extId, high_water AS highWater, scanned_at AS scannedAt
         FROM read_state WHERE source = ? ORDER BY ext_id`
      )
      .all(source) as ReadStateRow[]
  }
}
