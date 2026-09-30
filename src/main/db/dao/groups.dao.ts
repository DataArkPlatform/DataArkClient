/**
 * groups DAO —— 会话分组
 */
import { randomUUID } from 'node:crypto'
import type { Database as DatabaseType, Statement } from 'better-sqlite3'

export interface GroupRow {
  id: string
  name: string
  createdAt: number
  sessionCount: number
}

export class GroupsDao {
  private readonly insertStmt: Statement
  private readonly renameStmt: Statement
  private readonly deleteStmt: Statement
  private readonly unlinkStmt: Statement
  private readonly getStmt: Statement
  private readonly listStmt: Statement

  constructor(private readonly db: DatabaseType) {
    this.insertStmt = db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)')
    this.renameStmt = db.prepare('UPDATE groups SET name = @name WHERE id = @id')
    this.deleteStmt = db.prepare('DELETE FROM groups WHERE id = @id')
    this.unlinkStmt = db.prepare('UPDATE sessions SET group_id = NULL WHERE group_id = @id')
    this.getStmt = db.prepare('SELECT id, name, created_at AS createdAt FROM groups WHERE id = @id')
    this.listStmt = db.prepare(`
      SELECT
        g.id,
        g.name,
        g.created_at AS createdAt,
        COUNT(s.id) AS sessionCount
      FROM groups g
      LEFT JOIN sessions s ON s.group_id = g.id AND s.deleted_at IS NULL
      GROUP BY g.id
      ORDER BY g.created_at ASC
    `)
  }

  /** 新建分组，返回分组 id */
  createGroup(name: string): string {
    const id = randomUUID()
    this.insertStmt.run(id, name, Date.now())
    return id
  }

  renameGroup(id: string, name: string): number {
    return this.renameStmt.run({ id, name }).changes
  }

  /** 删除分组（组内会话移出分组，不删会话） */
  deleteGroup(id: string): void {
    const remove = this.db.transaction(() => {
      this.unlinkStmt.run({ id })
      this.deleteStmt.run({ id })
    })
    remove()
  }

  get(id: string): GroupRow | undefined {
    const row = this.getStmt.get({ id }) as Omit<GroupRow, 'sessionCount'> | undefined
    if (!row) return undefined
    return { ...row, sessionCount: 0 }
  }

  list(): GroupRow[] {
    return this.listStmt.all() as GroupRow[]
  }
}
