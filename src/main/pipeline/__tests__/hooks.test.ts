/**
 * hooks —— 钩子链顺序 / redact 占位 / 拦截丢弃
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../../shared/unified-model'
import { applyHooks, listHooks, registerHook, resetHooks, type HookContext } from '../hooks'

function sampleMessage(seq = 0): Message {
  return {
    sessionId: 'ses-1',
    seq,
    role: 'user',
    sentAt: 1_700_000_000_000,
    blocks: [{ type: 'text', text: 'hello' }]
  }
}

const ctx: HookContext = { source: 'opencode', sessionId: 'ses-1', seq: 0 }

describe('hooks', () => {
  it('默认钩子链为 [redact, standardize]，恒等透传不改变消息', () => {
    resetHooks()
    expect(listHooks()).toEqual(['redact', 'standardize'])
    const message = sampleMessage()
    const result = applyHooks(message, ctx)
    expect(result).toBe(message) // redact 占位：同一实例透传
    expect(result?.blocks).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('redact 占位钩子确实收到消息', () => {
    resetHooks()
    const received: Message[] = []
    const unregister = registerHook({
      name: 'redact-spy',
      transformMessage: (msg) => {
        received.push(msg)
        return msg
      }
    })
    try {
      const message = sampleMessage()
      applyHooks(message, ctx)
      expect(received).toHaveLength(1)
      expect(received[0]).toBe(message)
    } finally {
      unregister()
    }
  })

  it('钩子按注册顺序依次执行', () => {
    resetHooks()
    const order: string[] = []
    const a = registerHook({
      name: 'a',
      transformMessage: (msg) => {
        order.push('a')
        return { ...msg, agentName: 'a' }
      }
    })
    const b = registerHook({
      name: 'b',
      transformMessage: (msg) => {
        order.push('b')
        return msg
      }
    })
    try {
      const result = applyHooks(sampleMessage(), ctx)
      expect(order).toEqual(['a', 'b'])
      // a 的变换对 b 可见（链式传递）
      expect(result?.agentName).toBe('a')
    } finally {
      a()
      b()
    }
  })

  it('钩子返回 null 时整条消息被丢弃', () => {
    resetHooks()
    const unregister = registerHook({
      name: 'dropper',
      transformMessage: () => null
    })
    try {
      const result = applyHooks(sampleMessage(), ctx)
      expect(result).toBeNull()
    } finally {
      unregister()
    }
  })

  it('registerHook 返回的注销函数生效', () => {
    resetHooks()
    const unregister = registerHook({ name: 'temp' })
    expect(listHooks()).toEqual(['redact', 'standardize', 'temp'])
    unregister()
    expect(listHooks()).toEqual(['redact', 'standardize'])
  })
})
