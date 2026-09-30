/**
 * CodexReader 单测 —— 临时目录按真实布局种子（sessions/YYYY/MM/DD/rollout-*.jsonl）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexReader, isHarnessInjected, sanitizeTitle } from '../index'

const SESSION_ID = '11111111-1111-1111-1111-111111111111'

/** 在临时 home 下写一份 rollout，返回其 session id */
function seedRollout(home: string, lines: unknown[], sessionId = SESSION_ID): void {
  const dir = join(home, 'sessions', '2026', '01', '02')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `rollout-2026-01-02T10-00-00-${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  )
}

async function readAll(reader: CodexReader): Promise<Array<{ role: string; blocks: unknown[] }>> {
  const refs = await reader.listSessions()
  const ref = refs[0]
  if (ref === undefined) throw new Error('missing ref')
  const out: Array<{ role: string; blocks: unknown[] }> = []
  for await (const m of reader.readSession(ref)) out.push({ role: m.role, blocks: m.blocks })
  return out
}

describe('CodexReader', () => {
  let home: string
  let dir: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-codex-'))
    dir = join(home, 'sessions', '2026', '01', '02')
    mkdirSync(dir, { recursive: true })

    const lines = [
      {
        timestamp: '2026-01-02T10:00:00.000Z',
        type: 'session_meta',
        payload: {
          session_id: SESSION_ID,
          id: SESSION_ID,
          timestamp: '2026-01-02T10:00:00.000Z',
          cwd: 'e:/demo/proj',
          originator: 'codex_cli_rs',
          cli_version: '0.42.0',
          source: 'cli'
        }
      },
      {
        timestamp: '2026-01-02T10:00:01.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修复登录' }] }
      },
      {
        timestamp: '2026-01-02T10:00:02.000Z',
        type: 'response_item',
        payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: '先看代码' }] }
      },
      {
        timestamp: '2026-01-02T10:00:03.000Z',
        type: 'response_item',
        payload: { type: 'function_call', name: 'read_file', arguments: '{"path":"a.ts"}', call_id: 'call_1' }
      },
      {
        timestamp: '2026-01-02T10:00:04.000Z',
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'call_1', output: 'file body' }
      },
      {
        timestamp: '2026-01-02T10:00:05.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已修复' }] }
      }
    ]
    writeFileSync(
      join(dir, `rollout-2026-01-02T10-00-00-${SESSION_ID}.jsonl`),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf8'
    )
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('isAvailable：sessions 下有 rollout 时可用', async () => {
    const r = new CodexReader(home)
    expect((await r.isAvailable()).available).toBe(true)
  })

  it('listSessions：session_meta 的 id/cwd/时间 + 首条 user 标题', async () => {
    const r = new CodexReader(home)
    const refs = await r.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe(SESSION_ID)
    expect(refs[0]?.titleHint).toBe('修复登录')
    expect(refs[0]?.directory).toBe('e:/demo/proj')
    expect(refs[0]?.startedAt).toBe(Date.parse('2026-01-02T10:00:00.000Z'))
    expect(refs[0]?.sizeHint).toBeGreaterThan(0)
  })

  it('readSession：user + 合并的 assistant（reasoning/tool_call/tool_result/text）', async () => {
    const r = new CodexReader(home)
    const refs = await r.listSessions()
    const ref = refs[0]
    if (ref === undefined) throw new Error('missing ref')
    const msgs = []
    for await (const m of r.readSession(ref)) msgs.push(m)

    expect(msgs).toHaveLength(2)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '修复登录' }])
    expect(msgs[1]?.blocks).toEqual([
      { type: 'reasoning', text: '先看代码' },
      { type: 'tool_call', tool: 'read_file', callId: 'call_1', state: '{"path":"a.ts"}' },
      { type: 'tool_result', callId: 'call_1', output: 'file body' },
      { type: 'text', text: '已修复' }
    ])
    expect(msgs[0]?.agentName).toBe('Codex')
  })
})

describe('CodexReader · 新版 event_msg（item_completed / TurnItem）', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-codex-new-'))
    seedRollout(home, [
      {
        timestamp: '2026-01-02T10:00:00.000Z',
        type: 'session_meta',
        payload: {
          session_id: SESSION_ID,
          cwd: '/Users/wuyue/proj/语料方舟前端页面',
          timestamp: '2026-01-02T10:00:00.000Z'
        }
      },
      {
        timestamp: '2026-01-02T10:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          turn_id: 't1',
          item: { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: '把 Windows 端迁移到 Mac' }] }
        }
      },
      {
        timestamp: '2026-01-02T10:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_started',
          item: { type: 'CommandExecution', id: 'c1', command: ['ls', '-la'], cwd: '/w', status: 'in_progress' }
        }
      },
      {
        timestamp: '2026-01-02T10:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          item: {
            type: 'CommandExecution',
            id: 'c1',
            command: ['ls', '-la'],
            cwd: '/w',
            status: 'completed',
            aggregated_output: 'total 0',
            exit_code: 0
          }
        }
      },
      {
        timestamp: '2026-01-02T10:00:04.000Z',
        type: 'event_msg',
        payload: { type: 'item_completed', item: { type: 'Reasoning', id: 'r1', summary_text: ['先看项目结构'] } }
      },
      {
        timestamp: '2026-01-02T10:00:05.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          item: { type: 'AgentMessage', id: 'a1', content: [{ type: 'Text', text: '这是完整的 Electron 项目。' }] }
        }
      },
      {
        timestamp: '2026-01-02T10:00:06.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          item: { type: 'FileChange', id: 'f1', changes: { 'src/a.ts': {} } }
        }
      }
    ])
  })

  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('标题取首条真实 user_message（非 harness 注入）', async () => {
    const refs = await new CodexReader(home).listSessions()
    expect(refs[0]?.titleHint).toBe('把 Windows 端迁移到 Mac')
    expect(refs[0]?.directory).toBe('/Users/wuyue/proj/语料方舟前端页面')
  })

  it('TurnItem → 统一块（started→completed 去重 + 命令/reasoning/agent/文件变更）', async () => {
    const msgs = await readAll(new CodexReader(home))
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '把 Windows 端迁移到 Mac' }])
    expect(msgs[1]?.blocks).toEqual([
      { type: 'tool_call', tool: 'shell', callId: 'c1', state: 'ls -la' },
      { type: 'tool_result', callId: 'c1', output: 'total 0\n\n(status: completed · exit: 0)' },
      { type: 'reasoning', text: '先看项目结构' },
      { type: 'text', text: '这是完整的 Electron 项目。' },
      { type: 'patch', files: ['src/a.ts'] }
    ])
  })
})

describe('CodexReader · 旧版 event_msg（legacy）', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-codex-legacy-'))
    seedRollout(home, [
      {
        timestamp: '2026-01-02T10:00:00.000Z',
        type: 'session_meta',
        payload: { session_id: SESSION_ID, cwd: '/w/proj', timestamp: '2026-01-02T10:00:00.000Z' }
      },
      {
        timestamp: '2026-01-02T10:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hello' }
      },
      {
        timestamp: '2026-01-02T10:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'agent_reasoning', text: 'thinking' }
      },
      {
        timestamp: '2026-01-02T10:00:03.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'hi there' }
      },
      {
        timestamp: '2026-01-02T10:00:04.000Z',
        type: 'event_msg',
        payload: { type: 'exec_command_begin', call_id: 'c1', command: ['echo', 'hi'], cwd: '/w' }
      },
      {
        timestamp: '2026-01-02T10:00:05.000Z',
        type: 'event_msg',
        payload: { type: 'exec_command_end', call_id: 'c1', stdout: 'hi', exit_code: 0 }
      }
    ])
  })

  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('legacy 事件映射为 user / reasoning / agent / 命令(配对)', async () => {
    const msgs = await readAll(new CodexReader(home))
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: 'hello' }])
    expect(msgs[1]?.blocks).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'hi there' },
      { type: 'tool_call', tool: 'shell', callId: 'c1', state: 'echo hi' },
      { type: 'tool_result', callId: 'c1', output: 'hi\n\n(exit: 0)' }
    ])
  })
})

describe('CodexReader · 无 event_msg 时回退 response_item 并过滤 harness 注入', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-codex-fallback-'))
    seedRollout(home, [
      {
        timestamp: '2026-01-02T10:00:00.000Z',
        type: 'session_meta',
        payload: {
          session_id: SESSION_ID,
          cwd: '/Users/wuyue/资源（软件）/这是ai coding/codeX/项目/语料方舟前端页面',
          timestamp: '2026-01-02T10:00:00.000Z'
        }
      },
      {
        timestamp: '2026-01-02T10:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: '<permissions instructions>\n</permissions instructions>' }]
        }
      },
      {
        timestamp: '2026-01-02T10:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>' }
          ]
        }
      },
      {
        timestamp: '2026-01-02T10:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '我先看一下当前项目的代码。' }]
        }
      }
    ])
  })

  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('developer/system 与 <environment_context> 不进入会话；标题回落 cwd 目录名', async () => {
    const reader = new CodexReader(home)
    const refs = await reader.listSessions()
    expect(refs[0]?.titleHint).toBe('语料方舟前端页面')

    const msgs = await readAll(reader)
    expect(msgs.map((m) => m.role)).toEqual(['assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '我先看一下当前项目的代码。' }])
  })
})

describe('codex 工具函数', () => {
  it('isHarnessInjected 识别 harness 包裹', () => {
    expect(isHarnessInjected('<environment_context>\n<cwd>/x</cwd>\n</environment_context>')).toBe(true)
    expect(isHarnessInjected('<permissions instructions>\n</permissions instructions>')).toBe(true)
    expect(isHarnessInjected('<user_instructions>hi</user_instructions>')).toBe(true)
    expect(isHarnessInjected('把 Windows 端迁移到 Mac')).toBe(false)
  })

  it('sanitizeTitle 单行化并限量', () => {
    expect(sanitizeTitle('<environment_context>\n  <cwd>/a/b</cwd>')).toBe('<environment_context> <cwd>/a/b</cwd>')
    expect(sanitizeTitle('# 标题')).toBe('标题')
    expect(sanitizeTitle('x'.repeat(200)).length).toBe(80)
  })
})
