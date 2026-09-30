/**
 * opencode 适配器 —— 基于临时源库（V1 schema）验证探测/列表/流式读取
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpencodeReader } from '../index'
import { mapPartToBlock } from '../mappers'
import { detectSchemaVersion } from '../schema-detect'

/** 构造一个 V1 schema 的假 opencode.db */
function makeFakeOpenCodeDb(dir: string): string {
  const p = join(dir, 'opencode.db')
  const db = new Database(p)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, directory TEXT,
      title TEXT, cost REAL, time_created INTEGER, time_updated INTEGER, time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT
    );
  `)
  db.prepare(
    `INSERT INTO session (id, project_id, parent_id, slug, directory, title, cost, time_created, time_updated, time_archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run('ses_001', 'prj_1', null, 'my-proj', 'C:\\work\\proj', 'Python 异步编程实战', 0.12, 1_700_000_000_000, 1_700_000_000_100)

  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`
  ).run(
    'msg_1',
    'ses_001',
    1_700_000_000_000,
    1_700_000_000_001,
    JSON.stringify({ role: 'user', modelID: 'deepseek-v4-flash', providerID: 'deepseek', time: { created: 1_700_000_000_000 } })
  )
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`
  ).run(
    'msg_2',
    'ses_001',
    1_700_000_000_010,
    1_700_000_000_011,
    JSON.stringify({
      role: 'assistant',
      agent: 'opencode',
      modelID: 'deepseek-v4-flash',
      providerID: 'deepseek',
      cost: 0.12,
      tokens: { input: 100, output: 200 },
      time: { created: 1_700_000_000_010 },
      finish: 'stop'
    })
  )
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run(
    'prt_1', 'msg_2', 'ses_001', 1_700_000_000_011,
    JSON.stringify({ type: 'reasoning', text: '先分析需求' })
  )
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run(
    'prt_2', 'msg_2', 'ses_001', 1_700_000_000_012,
    JSON.stringify({ type: 'tool', tool: 'bash', callID: 'c_1', state: { status: 'completed', output: 'ok' } })
  )
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run(
    'prt_3', 'msg_2', 'ses_001', 1_700_000_000_013,
    JSON.stringify({ type: 'text', text: 'Python 异步编程最佳实践如下' })
  )
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run(
    'prt_4', 'msg_2', 'ses_001', 1_700_000_000_014,
    JSON.stringify({ type: 'step-start' })
  )
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run(
    'prt_5', 'msg_2', 'ses_001', 1_700_000_000_015,
    JSON.stringify({ type: 'step-finish' })
  )
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run(
    'prt_6', 'msg_2', 'ses_001', 1_700_000_000_016,
    JSON.stringify({ type: 'file', mime: 'text/plain', filename: 'main.py' })
  )
  // 归档会话不应出现在列表
  db.prepare(
    `INSERT INTO session (id, project_id, parent_id, slug, directory, title, cost, time_created, time_updated, time_archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('ses_archived', 'prj_1', null, 'old', null, '已归档', 0, 1_700_000_000_000, 1_700_000_000_000, 1_700_000_000_999)
  db.close()
  return p
}

describe('opencode mapper', () => {
  it('8 类 part → ContentBlock 映射', () => {
    expect(mapPartToBlock({ type: 'text', text: 'hi' })).toEqual({ type: 'text', text: 'hi' })
    expect(mapPartToBlock({ type: 'reasoning', text: 'r' })).toEqual({ type: 'reasoning', text: 'r' })
    expect(mapPartToBlock({ type: 'tool', tool: 'bash', callID: 'c1', state: { status: 'done' } })).toEqual({
      type: 'tool_call',
      tool: 'bash',
      callId: 'c1',
      state: '{"status":"done"}'
    })
    expect(mapPartToBlock({ type: 'patch', hash: 'h1', files: ['a.ts'] })).toEqual({
      type: 'patch',
      hash: 'h1',
      files: ['a.ts']
    })
    expect(mapPartToBlock({ type: 'file', mime: 'text/plain', filename: 'b.ts' })).toEqual({
      type: 'file_ref',
      mime: 'text/plain',
      filename: 'b.ts'
    })
    expect(mapPartToBlock({ type: 'step-start' })).toEqual({ type: 'step_marker', phase: 'start' })
    expect(mapPartToBlock({ type: 'step-finish' })).toEqual({ type: 'step_marker', phase: 'finish' })
    expect(mapPartToBlock({ type: 'compaction', summary: '压缩摘要' })).toEqual({ type: 'compaction', summary: '压缩摘要' })
    expect(mapPartToBlock({ type: 'unknown-thing' })).toBeNull()
  })
})

describe('opencode adapter（V1 源库）', () => {
  it('schema 探测识别 V1；含 session_message 表时识别 V2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-oc-'))
    try {
      const p = makeFakeOpenCodeDb(dir)
      const ro = new Database(p, { readonly: true })
      try {
        expect(detectSchemaVersion(ro)).toBe('v1')
      } finally {
        ro.close()
      }
      // 模拟真实 V2 布局：session_message 为活表（含 V2 列且有数据），message/part 为空壳。
      // 注：仅「存在 session_message 表」不等于 V2 —— 本机 1.18.x 实测该表存在但为空
      //（见 schema-detect.ts 头注释），故探测须看列形状与行数。
      const rw = new Database(p)
      rw.exec(`
        CREATE TABLE session_message (
          id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
          time_created INTEGER, time_updated INTEGER, data TEXT
        );
        INSERT INTO session_message (id, session_id, type, seq, time_created, data)
          VALUES ('sm_1', 'ses_001', 'message', 0, 1700000000000, '{"role":"user"}');
        DELETE FROM message;
        DELETE FROM part;
      `)
      rw.close()
      const ro2 = new Database(p, { readonly: true })
      try {
        expect(detectSchemaVersion(ro2)).toBe('v2')
      } finally {
        ro2.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('isAvailable / listSessions / readSession 端到端', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-oc2-'))
    try {
      const p = makeFakeOpenCodeDb(dir)
      const reader = new OpencodeReader(p)

      const avail = await reader.isAvailable()
      expect(avail.available).toBe(true)

      const refs = await reader.listSessions()
      expect(refs).toHaveLength(1) // 归档会话被过滤
      expect(refs[0]).toMatchObject({ extId: 'ses_001', source: 'opencode' })
      expect(refs[0]?.titleHint).toBe('Python 异步编程实战')
      expect(refs[0]?.directory).toBe('C:\\work\\proj')
      expect(refs[0]?.parentExtId).toBeUndefined()

      const messages: Array<Record<string, unknown>> = []
      for await (const m of reader.readSession(refs[0]!)) {
        messages.push(m as Record<string, unknown>)
      }
      expect(messages).toHaveLength(2) // user + assistant（仅这两类角色）

      const user = messages[0]!
      expect(user['role']).toBe('user')
      expect(user['modelName']).toBe('deepseek-v4-flash')

      const assistant = messages[1]!
      expect(assistant['role']).toBe('assistant')
      expect(assistant['agentName']).toBe('opencode')
      expect(assistant['tokensIn']).toBe(100)
      expect(assistant['tokensOut']).toBe(200)
      expect(assistant['cost']).toBe(0.12)
      expect(assistant['finishReason']).toBe('stop')
      const blocks = assistant['blocks'] as Array<Record<string, unknown>>
      expect(blocks).toHaveLength(6)
      expect(blocks[0]).toMatchObject({ type: 'reasoning', text: '先分析需求' })
      expect(blocks[1]).toMatchObject({ type: 'tool_call', tool: 'bash', callId: 'c_1' })
      expect(blocks[2]).toMatchObject({ type: 'text', text: 'Python 异步编程最佳实践如下' })
      expect(blocks[3]).toEqual({ type: 'step_marker', phase: 'start' })
      expect(blocks[4]).toEqual({ type: 'step_marker', phase: 'finish' })
      expect(blocks[5]).toMatchObject({ type: 'file_ref', filename: 'main.py' })

      // 不存在的源库
      const missing = new OpencodeReader(join(dir, 'nope.db'))
      expect((await missing.isAvailable()).available).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
