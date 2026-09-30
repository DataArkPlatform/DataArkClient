/**
 * ingest 管线 —— 增量无重复 / 更新 / 单会话错误隔离 / 钩子注入 / 进度
 */
import { describe, expect, it } from 'vitest'
import type { RawMessage } from '../../../shared/unified-model'
import { createTempDb, makeMockReader, type MockConversation } from '../../__tests__/helpers'
import { ingestSource } from '../ingest'
import { createDaos } from '../../db/dao'
import { listHooks, resetHooks } from '../hooks'

function buildConversations(): MockConversation[] {
  const base = 1_700_000_000_000
  const mk = (role: 'user' | 'assistant', text: string, offset = 0): RawMessage => ({
    role,
    sentAt: base + offset,
    blocks: [{ type: 'text', text }]
  })
  return [
    {
      extId: 'mock-a',
      title: '异步编程实战',
      startedAt: base,
      updatedAt: base + 1,
      messages: [mk('user', '请讲解 Python 异步编程最佳实践', 0), mk('assistant', '使用 asyncio。', 1)]
    },
    {
      extId: 'mock-b',
      title: 'React 优化',
      startedAt: base,
      updatedAt: base + 2,
      messages: [mk('user', 'React 组件性能优化指南', 0)]
    },
    {
      extId: 'mock-c',
      title: '数据库设计',
      startedAt: base,
      updatedAt: base + 3,
      messages: [mk('user', 'SQLite FTS5 全文检索设计', 0), mk('assistant', 'trigram 分词。', 1)]
    }
  ]
}

describe('ingestSource', () => {
  it('首次扫描全部入库，二次扫描零重复', async () => {
    const temp = createTempDb()
    try {
      const reader = makeMockReader(buildConversations())
      const first = await ingestSource(reader, temp.db)
      expect(first.scannedNew).toBe(3)
      expect(first.scannedUpdated).toBe(0)
      expect(first.skipped).toBe(0)
      expect(first.errors).toEqual([])

      const daos = createDaos(temp.db)
      expect(daos.sessions.listSessions()).toHaveLength(3)
      expect(temp.db.prepare('SELECT COUNT(*) AS c FROM messages').get()).toEqual({ c: 5 })
      expect(daos.readState.list('opencode')).toHaveLength(3)

      // 二次扫描：全部命中高水位 → skipped
      const second = await ingestSource(reader, temp.db)
      expect(second.scannedNew).toBe(0)
      expect(second.scannedUpdated).toBe(0)
      expect(second.skipped).toBe(3)
      expect(temp.db.prepare('SELECT COUNT(*) AS c FROM messages').get()).toEqual({ c: 5 })
      expect(daos.sessions.listSessions()).toHaveLength(3)
    } finally {
      temp.close()
    }
  })

  it('高水位变更 → 仅重读更新会话并替换其消息', async () => {
    const temp = createTempDb()
    try {
      const conversations = buildConversations()
      const reader = makeMockReader(conversations)
      await ingestSource(reader, temp.db)

      // 会话 A 更新（新增一条消息 + 标题变化）
      conversations[0]!.updatedAt = 1_800_000_000_000
      conversations[0]!.title = '异步编程实战 v2'
      conversations[0]!.messages.push({
        role: 'assistant',
        sentAt: 1_800_000_000_000,
        blocks: [{ type: 'text', text: '补充：事件循环' }]
      })

      const report = await ingestSource(reader, temp.db)
      expect(report.scannedNew).toBe(0)
      expect(report.scannedUpdated).toBe(1)
      expect(report.skipped).toBe(2)

      const daos = createDaos(temp.db)
      expect(daos.sessions.getByExtId('opencode', 'mock-a')?.title).toBe('异步编程实战 v2')
      expect(temp.db.prepare('SELECT COUNT(*) AS c FROM messages').get()).toEqual({ c: 6 })
      // 更新后消息数正确且无重复 seq
      const rows = temp.db
        .prepare('SELECT session_id, seq FROM messages ORDER BY session_id, seq')
        .all() as Array<{ session_id: string; seq: number }>
      const seen = new Set<string>()
      for (const r of rows) {
        const key = `${r.session_id}:${r.seq}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    } finally {
      temp.close()
    }
  })

  it('单会话读取失败只记录错误，不阻断其余会话', async () => {
    const temp = createTempDb()
    try {
      const conversations = buildConversations()
      const reader = makeMockReader(conversations)
      const original = reader.readSession.bind(reader)
      reader.readSession = async function* (ref) {
        if (ref.extId === 'mock-b') throw new Error('损坏的数据')
        yield* original(ref)
      }

      const report = await ingestSource(reader, temp.db)
      expect(report.scannedNew).toBe(2)
      expect(report.errors).toHaveLength(1)
      expect(report.errors[0]).toMatchObject({ extId: 'mock-b' })
      const daos = createDaos(temp.db)
      expect(daos.sessions.getByExtId('opencode', 'mock-b')).toBeUndefined()
      expect(daos.sessions.getByExtId('opencode', 'mock-a')).not.toBeUndefined()
    } finally {
      temp.close()
    }
  })

  it('附加钩子在管线内生效（改名/过滤），且结束后不残留', async () => {
    resetHooks()
    const temp = createTempDb()
    try {
      const reader = makeMockReader(buildConversations())
      const report = await ingestSource(reader, temp.db, {
        hooks: [
          {
            name: 'rename-user',
            transformMessage: (msg) =>
              msg.role === 'user' ? { ...msg, agentName: 'human' } : msg
          }
        ]
      })
      expect(report.scannedNew).toBe(3)
      // 钩子效果写入库中：user 消息带上了 agentName='human'
      const daos = createDaos(temp.db)
      const sessions = daos.sessions.listSessions()
      const userMessages = sessions.flatMap((s) =>
        daos.messages.getMessages(s.id).filter((m) => m.role === 'user')
      )
      expect(userMessages).toHaveLength(3)
      expect(userMessages.every((m) => m.agentName === 'human')).toBe(true)
      // ingest 结束后钩子链恢复内置状态
      expect(listHooks()).toEqual(['redact', 'standardize'])
    } finally {
      temp.close()
    }
  })

  it('progress 事件按 discover → reading → done 顺序触发', async () => {
    const temp = createTempDb()
    try {
      const reader = makeMockReader(buildConversations())
      const phases: string[] = []
      const report = await ingestSource(reader, temp.db, {
        onProgress: (p) => phases.push(p.phase)
      })
      expect(report.scannedNew).toBe(3)
      expect(phases[0]).toBe('discover')
      expect(phases[phases.length - 1]).toBe('done')
      expect(phases.filter((p) => p === 'reading')).toHaveLength(3)
    } finally {
      temp.close()
    }
  })
})
