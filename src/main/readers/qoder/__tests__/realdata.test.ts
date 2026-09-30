/**
 * Qoder 适配器 —— 真实本地数据冒烟测试（本机 %APPDATA%\QoderCN）
 *
 * 由 describe.skipIf 守护：本机存在 cli/projects 时才执行，其他环境自动跳过。
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { QoderReader, resolveQoderHome } from '../index'

const home = resolveQoderHome()
const projectsDir = join(home, 'SharedClientCache', 'cli', 'projects')
const hasRealData = existsSync(projectsDir)

describe.skipIf(!hasRealData)('qoder real data smoke', () => {
  it('isAvailable 为 true（本机存在 CLI 会话）', async () => {
    const reader = new QoderReader()
    const avail = await reader.isAvailable()
    expect(avail.available).toBe(true)
  })

  it('listSessions 非空且元数据（title/directory）完整', async () => {
    const refs = await new QoderReader().listSessions()
    expect(refs.length).toBeGreaterThan(0)
    const newest = [...refs].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    expect(newest).toBeDefined()
    expect(newest!.titleHint ?? '').not.toBe('')
    expect(newest!.directory ?? '').not.toBe('')
  })

  it('最新会话可完整往返：≥1 条 user 消息，含 assistant 文本块', async () => {
    const reader = new QoderReader()
    const refs = await reader.listSessions()
    const newest = [...refs].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    expect(newest).toBeDefined()

    let total = 0
    let userMessages = 0
    let assistantText = 0
    for await (const msg of reader.readSession(newest!)) {
      total += 1
      if (msg.role === 'user') userMessages += 1
      if (
        msg.role === 'assistant' &&
        msg.blocks.some((b) => (b as { type?: string }).type === 'text')
      ) {
        assistantText += 1
      }
      expect(msg.role).toMatch(/^(user|assistant)$/)
    }
    expect(total).toBeGreaterThan(0)
    expect(userMessages).toBeGreaterThanOrEqual(1)
    expect(assistantText).toBeGreaterThanOrEqual(1)
  })
})
