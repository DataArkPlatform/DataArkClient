/**
 * Claude Code 适配器 —— 真实本地数据冒烟测试（本机 ~/.claude/transcripts）
 *
 * 由 describe.skipIf 守护：本机存在可用会话时才执行，其他环境自动跳过。
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { ClaudeCodeReader, resolveClaudeRoots } from '../index'

const reader = new ClaudeCodeReader()

describe('claude-code real data smoke', () => {
  it('候选根至少有一个存在（否则跳过）', () => {
    const roots = resolveClaudeRoots()
    expect(roots.length).toBeGreaterThan(0)
  })

  it.skipIf(!resolveClaudeRoots().some((r) => existsSync(r)))(
    'isAvailable 为 true 且可列出会话',
    async () => {
      const avail = await reader.isAvailable()
      expect(avail.available).toBe(true)
      const refs = await reader.listSessions()
      expect(refs.length).toBeGreaterThan(0)
      const withTitle = refs.filter((r) => (r.titleHint ?? '') !== '')
      expect(withTitle.length).toBeGreaterThan(0)
    }
  )

  it.skipIf(!resolveClaudeRoots().some((r) => existsSync(r)))(
    '最新会话可读且产出 user/assistant 消息',
    async () => {
      const refs = await reader.listSessions()
      const newest = [...refs].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      expect(newest).toBeDefined()
      let total = 0
      for await (const msg of reader.readSession(newest!)) {
        total += 1
        expect(msg.role).toMatch(/^(user|assistant)$/)
        if (total >= 5) break
      }
      expect(total).toBeGreaterThan(0)
    }
  )
})
