/**
 * OpenCode 适配器 —— 真实本地数据库冒烟测试（本机 V1 布局）
 *
 * 由 describe.skipIf(!existsSync(realDbPath)) 守护：
 * - 本机存在 C:\Users\<user>\.local\share\opencode\opencode.db 时才会真正执行；
 * - 其他环境（CI / 无数据机器）自动跳过，不影响 npm test。
 *
 * 只读约束：仅经 infra/ro-sqlite.ts 打开真实库；句柄在 finally 中确定性关闭。
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { openRo } from '../../infra/ro-sqlite'
import { OpencodeReader, resolveDbPath } from '../index'

const realDbPath = resolveDbPath()
const hasRealDb = existsSync(realDbPath)

describe.skipIf(!hasRealDb)('opencode real DB smoke', () => {
  it('isAvailable 为 true（真实库可只读打开）', async () => {
    const reader = new OpencodeReader()
    const avail = await reader.isAvailable()
    expect(avail.available).toBe(true)
  })

  it('listSessions 数量 === 源库未归档 session 数', async () => {
    const ro = await openRo(realDbPath)
    try {
      const srcCount = (
        ro.db.prepare('SELECT COUNT(*) AS c FROM session WHERE time_archived IS NULL').get() as {
          c: number
        }
      ).c
      const refs = await new OpencodeReader().listSessions()
      expect(refs).toHaveLength(srcCount)
      expect(refs.length).toBeGreaterThan(0)
    } finally {
      ro.close()
    }
  })

  it('最新会话可完整往返：title/directory 非空，且至少 1 条 user 消息', async () => {
    const reader = new OpencodeReader()
    const refs = await reader.listSessions()
    expect(refs.length).toBeGreaterThan(0)
    const newest = [...refs].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    expect(newest).toBeDefined()
    expect(newest!.titleHint ?? '').not.toBe('')
    expect(newest!.directory ?? '').not.toBe('')

    let total = 0
    let userMessages = 0
    for await (const msg of reader.readSession(newest!)) {
      total += 1
      if (msg.role === 'user') userMessages += 1
      // 内容块形状应由统一模型兜底：message 至少可被 normalize 接受（role 合法）
      expect(msg.role).toMatch(/^(user|assistant)$/)
    }
    expect(total).toBeGreaterThan(0)
    expect(userMessages).toBeGreaterThanOrEqual(1)
  })
})
