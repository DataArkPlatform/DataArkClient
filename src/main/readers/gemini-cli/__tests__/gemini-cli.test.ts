/**
 * GeminiCliReader 单测 —— 临时目录按真实布局种子
 * （projects.json + tmp/<slug>/chats/session-*.jsonl）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GeminiCliReader } from '../index'

describe('GeminiCliReader', () => {
  let home: string
  let chats: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-gemini-'))
    chats = join(home, 'tmp', 'demo', 'chats')
    mkdirSync(chats, { recursive: true })
    writeFileSync(
      join(home, 'projects.json'),
      JSON.stringify({ projects: { 'e:/demo': 'demo' } }),
      'utf8'
    )

    const records = [
      {
        sessionId: 'g-1',
        projectHash: 'abc',
        startTime: '2026-01-02T10:00:00.000Z',
        lastUpdated: '2026-01-02T10:00:05.000Z',
        summary: '修复登录',
        kind: 'main'
      },
      {
        id: 'm1',
        timestamp: '2026-01-02T10:00:01.000Z',
        type: 'user',
        content: [{ text: '修复登录' }]
      },
      {
        id: 'm2',
        timestamp: '2026-01-02T10:00:02.000Z',
        type: 'gemini',
        content: [{ text: '好的' }],
        model: 'gemini-2.5-pro',
        tokens: { input: 10, output: 5, total: 15 },
        thoughts: [{ subject: '规划', description: '看代码' }],
        toolCalls: [
          {
            id: 'call-1',
            name: 'read_file',
            args: { path: 'a.ts' },
            status: 'success',
            result: [{ functionResponse: { response: { output: 'body' } } }]
          }
        ]
      },
      { $set: { lastUpdated: '2026-01-02T10:00:09.000Z' } }
    ]
    writeFileSync(
      join(chats, 'session-2026-01-02T10-00-abcd1234.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8'
    )
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('isAvailable：tmp 下有会话时可用', async () => {
    const r = new GeminiCliReader(home)
    expect((await r.isAvailable()).available).toBe(true)
  })

  it('listSessions：summary 标题 + projects.json 项目路径 + $set 覆盖 updatedAt', async () => {
    const r = new GeminiCliReader(home)
    const refs = await r.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe('g-1')
    expect(refs[0]?.titleHint).toBe('修复登录')
    expect(refs[0]?.directory).toBe('e:/demo')
    expect(refs[0]?.startedAt).toBe(Date.parse('2026-01-02T10:00:00.000Z'))
    expect(refs[0]?.updatedAt).toBe(Date.parse('2026-01-02T10:00:09.000Z'))
  })

  it('readSession：user + gemini（text/thoughts/toolCalls→call+result）', async () => {
    const r = new GeminiCliReader(home)
    const refs = await r.listSessions()
    const ref = refs[0]
    if (ref === undefined) throw new Error('missing ref')
    const msgs = []
    for await (const m of r.readSession(ref)) msgs.push(m)

    expect(msgs).toHaveLength(2)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '修复登录' }])
    expect(msgs[1]?.blocks[0]).toEqual({ type: 'text', text: '好的' })
    expect(msgs[1]?.blocks[1]).toEqual({ type: 'reasoning', text: '规划：看代码' })
    expect(msgs[1]?.blocks[2]).toEqual({
      type: 'tool_call',
      tool: 'read_file',
      callId: 'call-1',
      state: '{"args":{"path":"a.ts"},"status":"success"}'
    })
    expect(msgs[1]?.blocks[3]).toEqual({
      type: 'tool_result',
      callId: 'call-1',
      output: '{"response":{"output":"body"}}'
    })
    expect(msgs[1]?.modelName).toBe('gemini-2.5-pro')
    expect(msgs[1]?.tokensIn).toBe(10)
    expect(msgs[1]?.tokensOut).toBe(5)
    expect(msgs[0]?.agentName).toBe('Gemini CLI')
  })
})
