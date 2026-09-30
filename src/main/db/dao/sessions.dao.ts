/**
 * sessions DAO —— 预编译语句 + 投影映射
 */
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import type { Session } from '../../../shared/unified-model'

/** sessions 表投影（camelCase，内部字段并入） */
export interface SessionRow {
  id: string
  source: string
  extId: string
  title: string | null
  directory: string | null
  parentExtId: string | null
  startedAt: number | null
  updatedAt: number | null
  msgCount: number
  tokensIn: number | null
  tokensOut: number | null
  cost: number | null
  starred: number
  groupId: string | null
  deletedAt: number | null
}

export type SessionOrder =
  | 'updated_desc'
  | 'updated_asc'
  | 'created_desc'
  | 'created_asc'
  | 'title_asc'

export interface ListSessionsOptions {
  /** 是否包含已软删除会话（默认 false：只返回未删除） */
  includeDeleted?: boolean
  /** 只返回指定分组的会话；null = 只返回未分组的；undefined = 不过滤 */
  groupId?: string | null
  starredOnly?: boolean
  /** 只返回指定数据源的会话；undefined = 不过滤 */
  source?: string
  order?: SessionOrder
  limit?: number
  offset?: number
}

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

const ORDER_CLAUSES: Record<SessionOrder, string> = {
  updated_desc: 'updated_at DESC',
  updated_asc: 'updated_at ASC',
  created_desc: 'started_at DESC',
  created_asc: 'started_at ASC',
  title_asc: 'title ASC'
}

export class SessionsDao {
  private readonly upsertStmt: Statement
  private readonly getByIdStmt: Statement
  private readonly getByExtStmt: Statement
  private readonly setStarredStmt: Statement
  private readonly moveToGroupStmt: Statement

  constructor(private readonly db: DatabaseType) {
    this.upsertStmt = db.prepare(`
      INSERT INTO sessions (
        id, source, ext_id, title, directory, parent_ext_id,
        started_at, updated_at, msg_count, tokens_in, tokens_out, cost
      ) VALUES (
        @id, @source, @extId, @title, @directory, @parentExtId,
        @startedAt, @updatedAt, @msgCount, @tokensIn, @tokensOut, @cost
      )
      ON CONFLICT(source, ext_id) DO UPDATE SET
        title = excluded.title,
        directory = excluded.directory,
        parent_ext_id = excluded.parent_ext_id,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        msg_count = excluded.msg_count,
        tokens_in = excluded.tokens_in,
        tokens_out = excluded.tokens_out,
        cost = excluded.cost
      RETURNING id
    `)
    this.getByIdStmt = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = @id`)
    this.getByExtStmt = db.prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE source = @source AND ext_id = @extId`
    )
    this.setStarredStmt = db.prepare(`UPDATE sessions SET starred = @starred WHERE id = @id`)
    this.moveToGroupStmt = db.prepare(`UPDATE sessions SET group_id = @groupId WHERE id = @id`)
  }

  /**
   * 幂等 upsert：(source, ext_id) 冲突时只更新内容字段，
   * 保留用户字段 starred / group_id / deleted_at 以及原 id。
   * 返回会话内部 id。
   */
  upsertSession(session: Session): string {
    const row = this.upsertStmt.get({
      id: session.id,
      source: session.source,
      extId: session.extId,
      title: session.title ?? null,
      directory: session.directory ?? null,
      parentExtId: session.parentExtId ?? null,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      msgCount: session.msgCount,
      tokensIn: session.tokensIn ?? null,
      tokensOut: session.tokensOut ?? null,
      cost: session.cost ?? null
    }) as { id: string }
    return row.id
  }

  getById(id: string): SessionRow | undefined {
    return this.getByIdStmt.get({ id }) as SessionRow | undefined
  }

  getByExtId(source: string, extId: string): SessionRow | undefined {
    return this.getByExtStmt.get({ source, extId }) as SessionRow | undefined
  }

  /** 列表查询：条件白名单拼接，排序列从固定映射取，无注入面 */
  listSessions(options: ListSessionsOptions = {}): SessionRow[] {
    const clauses: string[] = []
    const params: Record<string, unknown> = {}

    if (!options.includeDeleted) {
      clauses.push('deleted_at IS NULL')
    }
    if (options.groupId !== undefined) {
      clauses.push(options.groupId === null ? 'group_id IS NULL' : 'group_id = @groupId')
      if (options.groupId !== null) params.groupId = options.groupId
    }
    if (options.starredOnly) {
      clauses.push('starred = 1')
    }
    if (options.source !== undefined) {
      clauses.push('source = @source')
      params.source = options.source
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const order = ORDER_CLAUSES[options.order ?? 'updated_desc']
    let sql = `SELECT ${SESSION_COLUMNS} FROM sessions ${where} ORDER BY ${order}`
    if (options.limit !== undefined) {
      sql += ' LIMIT @limit'
      params.limit = options.limit
      if (options.offset !== undefined) {
        sql += ' OFFSET @offset'
        params.offset = options.offset
      }
    }
    return this.db.prepare(sql).all(params) as SessionRow[]
  }

  /** 各数据源未删除会话计数（会话管理「按 Agent 筛选」胶囊） */
  countBySource(): Array<{ source: string; count: number }> {
    return this.db
      .prepare(
        `SELECT source, COUNT(*) AS count FROM sessions
         WHERE deleted_at IS NULL GROUP BY source ORDER BY count DESC`
      )
      .all() as Array<{ source: string; count: number }>
  }

  /** 收藏/取消收藏 */
  setStarred(id: string, starred: boolean): number {
    return this.setStarredStmt.run({ id, starred: starred ? 1 : 0 }).changes
  }

  /** 移动分组；groupId = null 表示移出分组 */
  moveToGroup(id: string, groupId: string | null): number {
    return this.moveToGroupStmt.run({ id, groupId }).changes
  }
}
