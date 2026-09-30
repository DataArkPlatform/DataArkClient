/**
 * normalize —— RawMessage → Message 校验 / 坏块降级 / 时间戳归一化
 */
import { describe, expect, it } from 'vitest'
import type { RawMessage } from '../../../shared/unified-model'
import { normalizeMessage } from '../normalize'

describe('normalizeMessage', () => {
  it('合法消息通过校验并保持字段', () => {
    const raw: RawMessage = {
      sessionId: 'ses-1',
      seq: 3,
      role: 'assistant',
      agentName: 'opencode',
      modelName: 'deepseek-v4-flash',
      sentAt: 1_700_000_000_123,
      finishReason: 'stop',
      blocks: [
        { type: 'text', text: '你好' },
        { type: 'tool_call', tool: 'bash', callId: 'c1', state: '{"status":"pending"}' }
      ]
    }
    const message = normalizeMessage(raw)
    expect(message).not.toBeNull()
    expect(message?.role).toBe('assistant')
    expect(message?.modelName).toBe('deepseek-v4-flash')
    expect(message?.sentAt).toBe(1_700_000_000_123)
    expect(message?.blocks).toHaveLength(2)
  })

  it('未知块降级为空文本，不拒绝整条消息', () => {
    const warns: string[] = []
    const raw: RawMessage = {
      role: 'user',
      sentAt: 1_700_000_000_000,
      blocks: [
        { type: 'text', text: '保留内容' },
        { type: 'mystery-block', payload: 42 }
      ]
    }
    const message = normalizeMessage(raw, { warn: (m) => warns.push(m) })
    expect(message).not.toBeNull()
    expect(message?.blocks).toHaveLength(2)
    expect(message?.blocks[1]).toEqual({ type: 'text', text: '' })
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('mystery-block')
  })

  it('OpenCode 风格宽松块（callID/step-start/tool状态）可映射', () => {
    const raw: RawMessage = {
      role: 'assistant',
      sentAt: '2026-08-25T10:00:00.000Z',
      blocks: [
        { type: 'tool', tool: 'read', callID: 'prt_1', state: { status: 'completed', output: 'file text' } },
        { type: 'step-start', reason: 'thinking' },
        { type: 'step-finish' },
        { type: 'file', mime: 'text/plain', filename: 'a.ts' },
        { type: 'patch', hash: 'abc', files: ['b.ts'] }
      ]
    }
    const message = normalizeMessage(raw)
    expect(message?.blocks[0]).toMatchObject({ type: 'tool_call', tool: 'read', callId: 'prt_1' })
    expect(message?.blocks[1]).toEqual({ type: 'step_marker', phase: 'start' })
    expect(message?.blocks[2]).toEqual({ type: 'step_marker', phase: 'finish' })
    expect(message?.blocks[3]).toMatchObject({ type: 'file_ref', filename: 'a.ts' })
    expect(message?.blocks[4]).toMatchObject({ type: 'patch', hash: 'abc' })
  })

  it('ISO 字符串时间戳归一化为毫秒', () => {
    const raw: RawMessage = { role: 'user', sentAt: '2026-08-25T10:00:00.000Z', blocks: [] }
    const message = normalizeMessage(raw)
    expect(message?.sentAt).toBe(Date.parse('2026-08-25T10:00:00.000Z'))
  })

  it('非法角色 / 缺失时间戳 → null 并告警', () => {
    const warns: string[] = []
    const badRole = normalizeMessage({ role: 'developer', sentAt: 1 } as unknown as RawMessage, {
      warn: (m) => warns.push(m)
    })
    expect(badRole).toBeNull()
    const noTime = normalizeMessage({ role: 'user' } as RawMessage, { warn: (m) => warns.push(m) })
    expect(noTime).toBeNull()
    expect(warns.length).toBe(2)
  })

  it('未知字段被剥离', () => {
    const raw = {
      role: 'user',
      sentAt: 1_700_000_000_000,
      blocks: [],
      secret: 'should-be-dropped'
    }
    const message = normalizeMessage(raw as unknown as RawMessage)
    expect('secret' in (message ?? {})).toBe(false)
  })
})
