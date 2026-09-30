/**
 * messages DAO —— 消息读写 + FTS5 trigram 全文索引维护
 *
 * FTS 方案：独立虚拟表 fts_messages，rowid 对齐 messages.id。
 * 会话级重建策略：replaceMessages 在同一事务内
 * 先记录旧消息 id → 删 messages → 删对应 fts 行 → 插新消息 → 插新 fts 行。
 */
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import { blockSearchText, type ContentBlock, type Message } from '../../../shared/unified-model'
import { SessionsDao, type SessionRow } from './sessions.dao'

/** 消息表投影 */
export interface MessageRow {
  id: number
  sessionId: string
  seq: number
  role: string
  sentAt: number | null
  agentName: string | null
  modelName: string | null
  provider: string | null
  finishReason: string | null
  blocks: ContentBlock[]
}

/** 全文命中（消息级） */
export interface MessageHit {
  message: Message
  snippet: string | null
}

/** 全文命中（会话级，去重 + 最佳相关度） */
export interface SessionHit extends SessionRow {
  snippet: string | null
}

export interface SearchOptions {
  sessionId?: string
  limit?: number
  offset?: number
}

const MESSAGE_COLUMNS = `
  id,
  session_id AS sessionId,
  seq,
  role,
  sent_at AS sentAt,
  agent_name AS agentName,
  model_name AS modelName,
  provider,
  finish_reason AS finishReason,
  blocks
`

/** 把用户查询转成安全的 FTS 短语查询（转义双引号），空串返回 null */
export function buildFtsQuery(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const escaped = trimmed.replaceAll('"', '""')
  return `"${escaped}"`
}

export class MessagesDao {
  private readonly replaceTx: (sessionId: string, msgs: Message[]) => void
  private readonly insertStmt: Statement
  private readonly insertFtsStmt: Statement
  private readonly deleteStmt: Statement
  private readonly deleteFtsStmt: Statement
  private readonly listIdsStmt: Statement
  private readonly getBySessionStmt: Statement
  private readonly countStmt: Statement
  private readonly snippetStmt: Statement
  private readonly sessionsDao: SessionsDao

  constructor(private readonly db: DatabaseType) {
    this.insertStmt = db.prepare(`
      INSERT INTO messages (
        session_id, seq, role, sent_at, agent_name, model_name, provider, finish_reason, blocks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertFtsStmt = db.prepare('INSERT INTO fts_messages (rowid, text) VALUES (?, ?)')
    this.deleteStmt = db.prepare('DELETE FROM messages WHERE session_id = ?')
    this.deleteFtsStmt = db.prepare('DELETE FROM fts_messages WHERE rowid = ?')
    this.listIdsStmt = db.prepare('SELECT id FROM messages WHERE session_id = ?')
    this.getBySessionStmt = db.prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? ORDER BY seq ASC`
    )
    this.countStmt = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE session_id = ?')
    // FTS 辅助函数 snippet() 只能在直接含 MATCH 的查询里用（不能进聚合/窗口上下文），
    // 因此 searchSessions 采用两步：先按会话聚合取 bestRank，再逐会话取 snippet。
    this.snippetStmt = db.prepare(`
      SELECT snippet(fts_messages, 0, '‹', '›', '…', 24) AS snippet
      FROM fts_messages
      JOIN messages m ON m.id = fts_messages.rowid
      WHERE fts_messages MATCH @q AND m.session_id = @sessionId
      ORDER BY fts_messages.rank ASC
      LIMIT 1
    `)
    this.sessionsDao = new SessionsDao(db)

    this.replaceTx = this.db.transaction((sessionId: string, msgs: Message[]) => {
      const oldIds = (this.listIdsStmt.all(sessionId) as Array<{ id: number }>).map((r) => r.id)
      this.deleteStmt.run(sessionId)
      for (const id of oldIds) this.deleteFtsStmt.run(id)
      for (const msg of msgs) {
        const info = this.insertStmt.run(
          msg.sessionId,
          msg.seq,
          msg.role,
          msg.sentAt,
          msg.agentName ?? null,
          msg.modelName ?? null,
          msg.provider ?? null,
          msg.finishReason ?? null,
          JSON.stringify(msg.blocks)
        )
        const text = blockSearchText(msg.blocks)
        if (text.length > 0) {
          this.insertFtsStmt.run(info.lastInsertRowid, text)
        }
      }
    })
  }

  /**
   * 整会话替换（delete + insert + FTS 重建），单事务。
   * 用于：首次入库、增量更新、以及未来"重新解析"。
   */
  replaceMessages(sessionId: string, msgs: Message[]): void {
    this.replaceTx(sessionId, msgs)
  }

  /** 按 seq 升序取会话内全部消息 */
  getMessages(sessionId: string): MessageRow[] {
    const rows = this.getBySessionStmt.all(sessionId) as Array<
      Omit<MessageRow, 'blocks'> & { blocks: string }
    >
    return rows.map((row) => ({ ...row, blocks: JSON.parse(row.blocks) as ContentBlock[] }))
  }

  countMessages(sessionId: string): number {
    const row = this.countStmt.get(sessionId) as { c: number }
    return row.c
  }

  /** FTS 命中消息（可限定会话） */
  searchMessages(query: string, options: SearchOptions = {}): MessageHit[] {
    const ftsQuery = buildFtsQuery(query)
    if (ftsQuery === null) return []
    const params: unknown[] = [ftsQuery]
    let sql = `
      SELECT
        m.id,
        m.session_id AS sessionId,
        m.seq,
        m.role,
        m.sent_at AS sentAt,
        m.agent_name AS agentName,
        m.model_name AS modelName,
        m.provider,
        m.finish_reason AS finishReason,
        m.blocks,
        snippet(fts_messages, 0, '‹', '›', '…', 24) AS snippet
      FROM fts_messages
      JOIN messages m ON m.id = fts_messages.rowid
      WHERE fts_messages MATCH ?
        AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = m.session_id AND s.deleted_at IS NULL)
    `
    if (options.sessionId !== undefined) {
      sql += ' AND m.session_id = ?'
      params.push(options.sessionId)
    }
    sql += ' ORDER BY m.seq ASC'
    if (options.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(options.limit)
      if (options.offset !== undefined) {
        sql += ' OFFSET ?'
        params.push(options.offset)
      }
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{
      snippet: string | null
      blocks: string
      id: number
      sessionId: string
      seq: number
      role: string
      sentAt: number | null
      agentName: string | null
      modelName: string | null
      provider: string | null
      finishReason: string | null
    }>
    return rows.map((row) => ({
      snippet: row.snippet,
      message: {
        sessionId: row.sessionId,
        seq: row.seq,
        role: row.role as Message['role'],
        sentAt: row.sentAt ?? 0,
        agentName: row.agentName ?? undefined,
        modelName: row.modelName ?? undefined,
        provider: row.provider ?? undefined,
        finishReason: row.finishReason ?? undefined,
        blocks: JSON.parse(row.blocks) as ContentBlock[]
      }
    }))
  }

  /** FTS 命中会话（去重，按最佳相关度排序），返回会话 + snippet */
  searchSessions(query: string, options: SearchOptions = {}): SessionHit[] {
    const ftsQuery = buildFtsQuery(query)
    if (ftsQuery === null) return []
    const params: unknown[] = [ftsQuery]
    let sql = `
      SELECT m.session_id AS sessionId, MIN(fts_messages.rank) AS bestRank
      FROM fts_messages
      JOIN messages m ON m.id = fts_messages.rowid
      WHERE fts_messages MATCH ?
      GROUP BY m.session_id
      ORDER BY bestRank ASC
    `
    if (options.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(options.limit, options.offset ?? 0)
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{ sessionId: string }>
    const hits: SessionHit[] = []
    for (const row of rows) {
      const session = this.sessionsDao.getById(row.sessionId)
      if (!session || session.deletedAt !== null) continue
      const snippetRow = this.snippetStmt.get({ q: ftsQuery, sessionId: row.sessionId }) as
        | { snippet: string }
        | undefined
      hits.push({ ...session, snippet: snippetRow?.snippet ?? null })
    }
    return hits
  }
}
