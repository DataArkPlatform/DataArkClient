/**
 * DeepSeekHarnessReader 单测 —— 临时目录按真实布局种子
 * （sessions/<projectDir>/<sessionDir>/session.vN.jsonl[.zstd]，zstd 为拼接帧）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { DeepSeekHarnessReader } from '../index'

const HEADER =
  '{"type":"session","version":3,"id":"sess-1","createdAt":1700000000000,"cwd":"/work/proj","isSeeded":false}'
const USER =
  '{"type":"user/message","seq":0,"time":1700000001000,"data":{"message":{"role":"user","content":[{"type":"text","text":"修复登录"}]}}}'
const ASSISTANT =
  '{"type":"assistant/message","seq":1,"time":1700000002000,"data":{"message":{"role":"assistant","content":[{"type":"reasoning","text":"先看代码"},{"type":"text","text":"好的"},{"type":"tool-call","id":"call_1","name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}],"source":{"kind":"model","provider":"deepseek","model":"deepseek-v4-flash"}},"usage":{"inputTokens":100,"outputTokens":20}}}'
const TOOL =
  '{"type":"tool/result","seq":2,"time":1700000003000,"data":{"message":{"role":"user","content":[{"type":"tool-result","toolCallId":"call_1","content":[{"type":"text","text":"file list"}],"isError":false}]}}}'
const TITLE = '{"type":"session/title","seq":3,"time":1700000004000,"data":{"title":"登录修复会话"}}'

describe('DeepSeekHarnessReader', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'da-dsh-'))
    const zstdDir = join(home, 'sessions', '--work-proj--', 'sess-1')
    mkdirSync(zstdDir, { recursive: true })
    const frame = (s: string): Buffer => zstdCompressSync(Buffer.from(s))
    // 拼接帧：首帧仅 header，其后每帧一个 append 批次
    writeFileSync(
      join(zstdDir, 'session.v3.jsonl.zstd'),
      Buffer.concat([frame(HEADER + '\n'), frame(USER + '\n' + ASSISTANT + '\n'), frame(TOOL + '\n' + TITLE + '\n')])
    )
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('isAvailable：sessions 下有日志时可用', async () => {
    const r = new DeepSeekHarnessReader(home)
    expect((await r.isAvailable()).available).toBe(true)
  })

  it('listSessions：header id/cwd/createdAt + session/title 标题 + 末事件 updatedAt', async () => {
    const r = new DeepSeekHarnessReader(home)
    const refs = await r.listSessions()
    expect(refs).toHaveLength(1)
    expect(refs[0]?.extId).toBe('sess-1')
    expect(refs[0]?.titleHint).toBe('登录修复会话')
    expect(refs[0]?.directory).toBe('/work/proj')
    expect(refs[0]?.startedAt).toBe(1700000000000)
    expect(refs[0]?.updatedAt).toBe(1700000004000)
    expect(refs[0]?.sizeHint).toBeGreaterThan(0)
  })

  it('readSession：解压拼接帧并映射 user/assistant/tool-result', async () => {
    const r = new DeepSeekHarnessReader(home)
    const refs = await r.listSessions()
    const ref = refs[0]
    if (ref === undefined) throw new Error('missing ref')
    const msgs = []
    for await (const m of r.readSession(ref)) msgs.push(m)

    expect(msgs).toHaveLength(3)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(msgs[0]?.blocks).toEqual([{ type: 'text', text: '修复登录' }])
    expect(msgs[1]?.blocks).toEqual([
      { type: 'reasoning', text: '先看代码' },
      { type: 'text', text: '好的' },
      { type: 'tool_call', tool: 'bash', callId: 'call_1', state: '{"command":"ls"}' }
    ])
    expect(msgs[1]?.modelName).toBe('deepseek-v4-flash')
    expect(msgs[1]?.tokensIn).toBe(100)
    expect(msgs[1]?.tokensOut).toBe(20)
    expect(msgs[2]?.blocks).toEqual([{ type: 'tool_result', callId: 'call_1', output: 'file list' }])
    expect(msgs[0]?.agentName).toBe('DeepSeek Harness')
  })
})
