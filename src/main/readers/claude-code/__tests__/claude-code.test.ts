/**
 * ClaudeCodeReader 单测 —— fixture JSONL 驱动（本机无 Claude Code 数据）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeReader } from '../index'

function jsonl(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

describe('ClaudeCodeReader', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-claude-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function seedSession(): void {
    const slugDir = join(home, 'projects', 'C-Users-demo-proj')
    mkdirSync(slugDir, { recursive: true })
    const file = join(slugDir, 'sess-abc.jsonl')
    writeFileSync(
      file,
      jsonl([
        { type: 'summary', summary: '修复登录超时' },
        {
          type: 'user',
          sessionId: 'sess-abc',
          timestamp: '2026-08-01T10:00:00.000Z',
          message: { content: '帮我看看登录超时问题' }
        },
        {
          type: 'assistant',
          sessionId: 'sess-abc',
          timestamp: '2026-08-01T10:00:05.000Z',
          message: {
            model: 'claude-sonnet-4',
            content: [
              { type: 'thinking', thinking: '先检查会话配置' },
              { type: 'text', text: '好的，我来排查。' },
              { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.ts' } }
            ],
            usage: { input_tokens: 120, output_tokens: 45 }
          }
        },
        {
          type: 'user',
          sessionId: 'sess-abc',
          timestamp: '2026-08-01T10:00:06.000Z',
          isMeta: true,
          message: { content: 'meta 行应被跳过' }
        },
        {
          type: 'user',
          sessionId: 'sess-abc',
          timestamp: '2026-08-01T10:00:07.000Z',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'export const a = 1' }]
          }
        },
        { type: 'system', subtype: 'informational' }
      ])
    )
  }

  it('isAvailable：存在 JSONL 时可用', async () => {
    seedSession()
    const r = new ClaudeCodeReader(home)
    const avail = await r.isAvailable()
    expect(avail.available).toBe(true)
  })

  it('listSessions：summary 行作为 titleHint，mtime 作为高水位', async () => {
    seedSession()
    const r = new ClaudeCodeReader(home)
    const refs = await r.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe('sess-abc')
    expect(refs[0]?.titleHint).toBe('修复登录超时')
    expect(refs[0]?.updatedAt).toBeGreaterThan(0)
  })

  it('readSession：块映射正确且 meta/system/summary 跳过', async () => {
    seedSession()
    const r = new ClaudeCodeReader(home)
    const refs = await r.listSessions()
    const ref = refs[0]
    if (ref === undefined) throw new Error('missing ref')
    const msgs = []
    for await (const m of r.readSession(ref)) msgs.push(m)

    expect(msgs).toHaveLength(3)
    expect(msgs[0]?.role).toBe('user')
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '帮我看看登录超时问题' }])
    expect(msgs[1]?.role).toBe('assistant')
    expect(msgs[1]?.modelName).toBe('claude-sonnet-4')
    expect(msgs[1]?.tokensIn).toBe(120)
    expect(msgs[1]?.tokensOut).toBe(45)
    expect(msgs[1]?.blocks[0]).toEqual({ type: 'reasoning', text: '先检查会话配置' })
    expect(msgs[1]?.blocks[1]).toEqual({ type: 'text', text: '好的，我来排查。' })
    expect(msgs[1]?.blocks[2]).toEqual({
      type: 'tool_call',
      tool: 'Read',
      callId: 'tu_1',
      state: '{"file_path":"a.ts"}'
    })
    expect(msgs[2]?.blocks).toEqual([
      { type: 'tool_result', callId: 'tu_1', output: 'export const a = 1' }
    ])

    const stats = r.readSessionStats()
    expect(stats.sessionsRead).toBe(1)
    expect(stats.messagesYielded).toBe(3)
    expect(stats.skippedByType['summary']).toBe(1)
    expect(stats.skippedByType['system']).toBe(1)
    expect(stats.skippedByType['user']).toBe(3)
    expect(stats.skippedByType['assistant']).toBe(1)
  })
})

describe('ClaudeCodeReader · 多布局（transcripts 简化转录）', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-claude-tx-'))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  /** 本机实测形态：~/.claude/transcripts/ses_*.jsonl（user / tool_use / tool_result） */
  it('transcripts/ses_*.jsonl：user + 合并的 tool_use/tool_result，且不含 assistant 文本也能读', async () => {
    const dir = join(home, 'transcripts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'ses_0005d15e5ffe7gUV5ok3s3rTOy.jsonl'),
      jsonl([
        {
          type: 'user',
          timestamp: '2026-08-04T06:05:33.973Z',
          content: '<system-reminder>\n[IMPORTANT] 必须中文\n</system-reminder>\n\n开始进行模块三的开发'
        },
        {
          type: 'tool_use',
          timestamp: '2026-08-04T06:05:38.148Z',
          tool_name: 'read',
          tool_input: { filePath: 'E:\\proj' }
        },
        {
          type: 'tool_result',
          timestamp: '2026-08-04T06:05:38.156Z',
          tool_name: 'read',
          tool_output: { output: '<path>E:\\proj</path>' }
        }
      ])
    )

    const r = new ClaudeCodeReader(home)
    expect((await r.isAvailable()).available).toBe(true)
    const refs = await r.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe('ses_0005d15e5ffe7gUV5ok3s3rTOy')
    // 标题：剥离 <system-reminder> 后的首条用户输入
    expect(refs[0]?.titleHint).toBe('开始进行模块三的开发')

    const msgs = []
    for await (const m of r.readSession(refs[0]!)) msgs.push(m)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '开始进行模块三的开发' }])
    expect(msgs[1]?.blocks).toEqual([
      { type: 'tool_call', tool: 'read', callId: '', state: '{"filePath":"E:\\\\proj"}' },
      { type: 'tool_result', callId: '', output: '<path>E:\\proj</path>' }
    ])
  })

  it('标准格式的 <system-reminder> 被剥离、isSidechain 侧链被跳过', async () => {
    const slugDir = join(home, 'projects', 'p')
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(
      join(slugDir, 's1.jsonl'),
      jsonl([
        {
          type: 'user',
          timestamp: '2026-08-01T10:00:00.000Z',
          message: { content: '<system-reminder>注入</system-reminder>真正的问题' }
        },
        {
          type: 'assistant',
          timestamp: '2026-08-01T10:00:01.000Z',
          isSidechain: true,
          message: { content: [{ type: 'text', text: '子代理发言（应跳过）' }] }
        },
        {
          type: 'assistant',
          timestamp: '2026-08-01T10:00:02.000Z',
          message: { content: [{ type: 'text', text: '主线程回复' }] }
        }
      ])
    )

    const r = new ClaudeCodeReader(home)
    const refs = await r.listSessions()
    const msgs = []
    for await (const m of r.readSession(refs[0]!)) msgs.push(m)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '真正的问题' }])
    expect(msgs[1]?.blocks).toEqual([{ type: 'text', text: '主线程回复' }])
  })
})