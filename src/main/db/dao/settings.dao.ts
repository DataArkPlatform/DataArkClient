/**
 * settings DAO —— 键值设置，value 以 JSON 文本存储
 */
import type { Database as DatabaseType, Statement } from 'better-sqlite3'

export class SettingsDao {
  private readonly getStmt: Statement
  private readonly setStmt: Statement
  private readonly listStmt: Statement

  constructor(db: DatabaseType) {
    this.getStmt = db.prepare('SELECT value FROM settings WHERE key = @key')
    this.setStmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    this.listStmt = db.prepare('SELECT key, value FROM settings')
  }

  /** 读取 JSON 设置；不存在返回 undefined，解析失败时返回原始字符串 */
  get(key: string): unknown {
    const row = this.getStmt.get({ key }) as { value: string } | undefined
    if (!row) return undefined
    try {
      return JSON.parse(row.value) as unknown
    } catch {
      return row.value
    }
  }

  /** 写入 JSON 设置 */
  set(key: string, value: unknown): void {
    this.setStmt.run({ key, value: JSON.stringify(value) })
  }

  /** 全部设置（已解析） */
  getAll(): Record<string, unknown> {
    const rows = this.listStmt.all() as Array<{ key: string; value: string }>
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value) as unknown
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }
}
