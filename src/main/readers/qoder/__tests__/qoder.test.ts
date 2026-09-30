/**
 * QoderReader 单测 —— 临时目录按真实布局种子（cli/projects/*.session.execution.jsonl + -session.json）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QoderReader } from '../index'

const SESSION_ID = 'task-abc123.session.execution'

describe('QoderReader', () => {
  let home: string
  let dir: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-qoder-'))
    dir = join(home, 'SharedClientCache', 'cli', 'projects')
    mkdirSync(dir, { recursive: true })

    const records = [
      {
        id: 'm1',
        role: 'user',
        session_id: SESSION_ID,
        parts: [{ type: 'text', data: { type: 'text', text: '帮我修复登录 bug' } }],
        model: 'auto',
        created_at: 1700000000000,
        provider: 'qoder',
        is_meta: false
      },
      {
        id: 'm2',
        role: 'assistant',
        session_id: SESSION_ID,
        parts: [
          { type: 'reasoning', data: { thinking: '先看代码' } },
          { type: 'text', data: { type: 'text', text: '好的，我来看看' } },
          { type: 'tool_call', data: { id: 'call_1', name: 'read_file', input: { path: 'a.ts' }, finished: true } }
        ],
        model: 'auto',
        created_at: 1700000001000,
        provider: 'qoder',
        is_meta: false
      },
      {
        id: 'm3',
        role: 'tool',
        session_id: SESSION_ID,
        parts: [
          { type: 'tool_result', data: { tool_use_id: 'call_1', name: 'read_file', content: 'file content here' } }
        ],
        created_at: 1700000002000,
        is_meta: false
      },
      {
        id: 'm4',
        role: 'assistant',
        session_id: SESSION_ID,
        parts: [
          { type: 'text', data: { type: 'text', text: '已修复' } },
          { type: 'finish', data: { reason: 'end_turn', time: 0 } }
        ],
        model: 'auto',
        created_at: 1700000003000,
        is_meta: false
      }
    ]
    writeFileSync(
      join(dir, `${SESSION_ID}.jsonl`),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8'
    )
    writeFileSync(
      join(dir, `${SESSION_ID}-session.json`),
      JSON.stringify({
        id: SESSION_ID,
        title: '修复登录 bug',
        created_at: 1700000000000,
        updated_at: 1700000003000,
        working_dir: 'e:/demo/proj'
      }),
      'utf8'
    )
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('isAvailable：projects 下有会话 JSONL 时可用', async () => {
    const r = new QoderReader(home)
    expect((await r.isAvailable()).available).toBe(true)
  })

  it('listSessions：元数据 title/working_dir/时间映射', async () => {
    const r = new QoderReader(home)
    const refs = await r.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe(SESSION_ID)
    expect(refs[0]?.titleHint).toBe('修复登录 bug')
    expect(refs[0]?.directory).toBe('e:/demo/proj')
    expect(refs[0]?.updatedAt).toBe(1700000003000)
    expect(refs[0]?.startedAt).toBe(1700000000000)
    expect(refs[0]?.sizeHint).toBeGreaterThan(0)
  })

  it('readSession：user/assistant 映射，tool_result 合并进前条 assistant', async () => {
    const r = new QoderReader(home)
    const refs = await r.listSessions()
    const ref = refs[0]
    if (ref === undefined) throw new Error('missing ref')
    const msgs = []
    for await (const m of r.readSession(ref)) msgs.push(m)

    expect(msgs).toHaveLength(3)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '帮我修复登录 bug' }])
    // 第二条：reasoning + text + tool_call，并合并了 tool 记录的 tool_result
    expect(msgs[1]?.blocks).toEqual([
      { type: 'reasoning', text: '先看代码' },
      { type: 'text', text: '好的，我来看看' },
      { type: 'tool_call', tool: 'read_file', callId: 'call_1', state: '{"input":{"path":"a.ts"},"finished":true}' },
      { type: 'tool_result', callId: 'call_1', output: 'file content here' }
    ])
    // 第三条：文本 + finishReason
    expect(msgs[2]?.blocks).toEqual([{ type: 'text', text: '已修复' }])
    expect(msgs[2]?.finishReason).toBe('end_turn')
    expect(msgs[0]?.agentName).toBe('Qoder')
  })
})

/** 会话记录种子（Qoder 原生形态） */
function qoderRecords(sessionId: string, prompt: string): string {
  return (
    [
      {
        id: 'm1',
        role: 'user',
        session_id: sessionId,
        parts: [{ type: 'text', data: { text: prompt } }],
        created_at: 1700000000000,
        is_meta: false
      },
      {
        id: 'm2',
        role: 'assistant',
        session_id: sessionId,
        parts: [{ type: 'text', data: { text: '好的' } }],
        created_at: 1700000001000,
        is_meta: false
      }
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  )
}

describe('QoderReader · 多布局发现（不依赖固定路径）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'da-qoder-layout-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('官方 CLI 布局：projects/<项目>/<session-id>.jsonl + <session-id>-session.json', async () => {
    const id = 'c4db9988-1478-4cec-968a-dd4aa079cff1'
    const dir = join(root, 'projects', '-Users-levi-tmp')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.jsonl`), qoderRecords(id, 'qodercli 的 session 保存在哪'), 'utf8')
    // CLI 元数据：workdir（非 working_dir）、无 title、无 updated_at → 标题/时间需兜底
    writeFileSync(
      join(dir, `${id}-session.json`),
      JSON.stringify({ id, created_at: 1773731404924, workdir: '/Users/levi/tmp', msg_count: 2 }),
      'utf8'
    )

    const refs = await new QoderReader(root).listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe(id)
    expect(refs[0]?.directory).toBe('/Users/levi/tmp') // workdir 别名被识别
    expect(refs[0]?.titleHint).toBe('qodercli 的 session 保存在哪') // 无 title → 首条用户消息
    expect(refs[0]?.startedAt).toBe(1773731404924)
  })

  it('未知归档布局：<root>/<日期>/<短哈希>/<session>.jsonl 也能被发现', async () => {
    const id = '0d399faf'
    const dir = join(root, '2026-09-17', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.jsonl`), qoderRecords(id, '帮我看看这个前端页面'), 'utf8')

    const reader = new QoderReader(root)
    expect((await reader.isAvailable()).available).toBe(true)
    const refs = await reader.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe(id)
    expect(refs[0]?.titleHint).toBe('帮我看看这个前端页面')
  })

  it('按内容特征排除其它 Agent 的 JSONL（Codex rollout 不被当作 Qoder 会话）', async () => {
    const dir = join(root, 'SharedClientCache', 'cli', 'projects')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'task-real.session.execution.jsonl'), qoderRecords('task-real', '真实会话'), 'utf8')
    writeFileSync(
      join(dir, 'rollout-2026-01-02T10-00-00-abc.jsonl'),
      JSON.stringify({
        timestamp: '2026-01-02T10:00:00.000Z',
        type: 'session_meta',
        payload: { session_id: 'abc', cwd: '/x' }
      }) + '\n',
      'utf8'
    )

    const refs = await new QoderReader(root).listSessions()
    expect(refs.map((r) => r.extId)).toEqual(['task-real.session.execution'])
  })

  it('兼容通用 content 形态（{role, content:[{type,text}]}）', async () => {
    const dir = join(root, 'projects', 'demo')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'sess-1.jsonl'),
      [
        JSON.stringify({ role: 'user', content: [{ type: 'text', text: '你好' }] }),
        JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: '在的' }] })
      ].join('\n') + '\n',
      'utf8'
    )

    const reader = new QoderReader(root)
    const refs = await reader.listSessions()
    const ref = refs[0]
    if (ref === undefined) throw new Error('missing ref')
    const roles: string[] = []
    for await (const m of reader.readSession(ref)) roles.push(m.role)
    expect(roles).toEqual(['user', 'assistant'])
  })
})
