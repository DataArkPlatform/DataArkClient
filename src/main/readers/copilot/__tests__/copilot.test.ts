/**
 * CopilotReader 单测 —— 临时 SQLite 依真实 schema 建表种子
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CopilotReader } from '../index'

describe('CopilotReader', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'da-copilot-'))
    dbPath = join(dir, 'session-store.db')
    const db = new Database(dbPath)
    db.exec(
      'CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT, summary TEXT, agent_name TEXT, agent_description TEXT, created_at TEXT, updated_at TEXT);' +
        'CREATE TABLE turns (id INTEGER PRIMARY KEY, session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);'
    )
    db.prepare('INSERT INTO sessions VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, ?, ?)').run(
      'sid-1',
      'e:\\demo\\proj',
      'vscode',
      '修复导出功能',
      'GitHub Copilot Chat',
      '2026-08-01T08:00:00.000Z',
      '2026-08-01T09:00:00.000Z'
    )
    const turn = db.prepare(
      'INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)'
    )
    turn.run('sid-1', 0, '怎么导出会话？', '点击导出按钮即可。', '2026-08-01T08:01:00.000Z')
    turn.run('sid-1', 1, '支持哪些格式？', '支持 JSON 与 Markdown。', '2026-08-01T08:02:00.000Z')
    db.close()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('isAvailable：sessions/turns 表齐备时可用', async () => {
    const r = new CopilotReader(dbPath)
    expect((await r.isAvailable()).available).toBe(true)
  })

  it('listSessions：summary/cwd/时间戳映射', async () => {
    const r = new CopilotReader(dbPath)
    const refs = await r.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe('sid-1')
    expect(refs[0]?.titleHint).toBe('修复导出功能')
    expect(refs[0]?.directory).toBe('e:\\demo\\proj')
    expect(refs[0]?.updatedAt).toBe(Date.parse('2026-08-01T09:00:00.000Z'))
    expect(refs[0]?.startedAt).toBe(Date.parse('2026-08-01T08:00:00.000Z'))
  })

  it('readSession：每 turn 产出 user+assistant 两条文本消息', async () => {
    const r = new CopilotReader(dbPath)
    const refs = await r.listSessions()
    const ref = refs[0]
    if (ref === undefined) throw new Error('missing ref')
    const msgs = []
    for await (const m of r.readSession(ref)) msgs.push(m)
    expect(msgs).toHaveLength(4)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '怎么导出会话？' }])
    expect(msgs[3]?.blocks).toEqual([{ type: 'text', text: '支持 JSON 与 Markdown。' }])
    expect(msgs[1]?.agentName).toBe('GitHub Copilot Chat')

    const stats = r.readSessionStats()
    expect(stats.turnsSeen).toBe(2)
    expect(stats.messagesYielded).toBe(4)
    expect(stats.sessionsRead).toBe(1)
  })
})