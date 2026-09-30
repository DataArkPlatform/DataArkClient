/**
 * DAO 层 —— upsert 用户字段保留 / FTS 中文检索 / 回收站按龄清除
 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { ContentBlock, Message, Session } from '../../../shared/unified-model'
import { createTempDb } from '../../__tests__/helpers'
import { createDaos } from '../dao'

function makeSession(extId: string, title?: string): Session {
  return {
    id: randomUUID(),
    source: 'opencode',
    extId,
    title,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    msgCount: 0
  }
}

function makeMessage(sessionId: string, seq: number, text: string, role: 'user' | 'assistant' = 'user'): Message {
  const blocks: ContentBlock[] = [{ type: 'text', text }]
  return {
    sessionId,
    seq,
    role,
    sentAt: 1_700_000_000_000 + seq,
    blocks
  }
}

describe('sessions.dao', () => {
  it('upsert 冲突时保留用户字段（starred/group_id/deleted_at）与原 id', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const session = makeSession('ses-1', '旧标题')
      const firstId = daos.sessions.upsertSession(session)

      const groupId = daos.groups.createGroup('工作')
      daos.sessions.moveToGroup(firstId, groupId)
      daos.sessions.setStarred(firstId, true)
      daos.trash.softDeleteSessions([firstId], 1_700_000_000_111)

      // 再次 upsert 同一 (source, extId)，内容更新
      const updated: Session = { ...session, title: '新标题', msgCount: 9, updatedAt: 1_800_000_000_000 }
      const secondId = daos.sessions.upsertSession(updated)

      expect(secondId).toBe(firstId) // 幂等键复用原 id
      const row = daos.sessions.getById(firstId)
      expect(row?.title).toBe('新标题')
      expect(row?.msgCount).toBe(9)
      expect(row?.starred).toBe(1) // 用户字段保留
      expect(row?.groupId).toBe(groupId)
      expect(row?.deletedAt).toBe(1_700_000_000_111)
      expect(row?.source).toBe('opencode')
    } finally {
      temp.close()
    }
  })

  it('listSessions 过滤（未删除/星标/分组）', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const s1 = daos.sessions.upsertSession(makeSession('s1', 'A'))
      const s2 = daos.sessions.upsertSession(makeSession('s2', 'B'))
      const groupId = daos.groups.createGroup('g1')
      daos.sessions.setStarred(s1, true)
      daos.sessions.moveToGroup(s2, groupId)
      daos.trash.softDeleteSessions([s1], 1)

      expect(daos.sessions.listSessions().map((r) => r.extId)).toEqual(['s2'])
      expect(daos.sessions.listSessions({ starredOnly: true }).map((r) => r.extId)).toEqual([])
      expect(daos.sessions.listSessions({ groupId }).map((r) => r.extId)).toEqual(['s2'])
      expect(daos.sessions.listSessions({ includeDeleted: true }).length).toBe(2)
    } finally {
      temp.close()
    }
  })
})

describe('messages.dao + FTS（中文 trigram 检索）', () => {
  it("检索 '异步编程' 命中含 'Python 异步编程最佳实践' 的会话并带 snippet", () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const sessionId = daos.sessions.upsertSession(makeSession('fts-1', '异步教程'))
      const otherId = daos.sessions.upsertSession(makeSession('fts-2', 'React 组件'))

      const messages = [
        makeMessage(sessionId, 0, '请讲解 Python 异步编程最佳实践', 'user'),
        makeMessage(sessionId, 1, '使用 asyncio 与 async/await。', 'assistant'),
        makeMessage(otherId, 0, 'React 组件性能优化指南', 'user')
      ]
      daos.messages.replaceMessages(sessionId, messages.filter((m) => m.sessionId === sessionId))
      daos.messages.replaceMessages(otherId, messages.filter((m) => m.sessionId === otherId))

      const hits = daos.messages.searchSessions('异步编程')
      expect(hits).toHaveLength(1)
      expect(hits[0]?.extId).toBe('fts-1')
      expect(hits[0]?.title).toBe('异步教程')
      expect(hits[0]?.snippet).toContain('异步编程')

      const msgHits = daos.messages.searchMessages('异步编程')
      expect(msgHits).toHaveLength(1)
      expect(msgHits[0]?.message.seq).toBe(0)

      // 限定会话搜索（查询需 ≥3 字符才能生成 trigram）
      const scoped = daos.messages.searchMessages('性能优化', { sessionId: otherId })
      expect(scoped.map((h) => h.message.seq)).toEqual([0])
    } finally {
      temp.close()
    }
  })

  it('replaceMessages 会话级重建后消息与 FTS 同步', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const sessionId = daos.sessions.upsertSession(makeSession('fts-3'))
      daos.messages.replaceMessages(sessionId, [makeMessage(sessionId, 0, '第一版 异步编程'), makeMessage(sessionId, 1, '中间消息')])
      expect(daos.messages.countMessages(sessionId)).toBe(2)
      expect(daos.messages.searchSessions('异步编程')).toHaveLength(1)

      // 整会话替换：老 FTS 行必须被清掉
      daos.messages.replaceMessages(sessionId, [makeMessage(sessionId, 0, '完全重写的内容')])
      expect(daos.messages.countMessages(sessionId)).toBe(1)
      expect(daos.messages.searchSessions('异步编程')).toHaveLength(0)
      expect(daos.messages.searchSessions('完全重写')).toHaveLength(1)
    } finally {
      temp.close()
    }
  })
})

describe('trash.dao', () => {
  it('软删除 / 恢复 / 按龄彻底清除', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const old = daos.sessions.upsertSession(makeSession('trash-old'))
      const recent = daos.sessions.upsertSession(makeSession('trash-recent'))
      const keep = daos.sessions.upsertSession(makeSession('trash-keep'))
      daos.messages.replaceMessages(old, [makeMessage(old, 0, '异步编程 old')])

      const now = Date.now()
      daos.trash.softDeleteSessions([old], now - 2 * 60 * 60 * 1000) // 2 小时前删除
      daos.trash.softDeleteSessions([recent], now - 10 * 60 * 1000) // 10 分钟前删除

      expect(daos.trash.list().map((r) => r.extId).sort()).toEqual(['trash-old', 'trash-recent'])

      // 清除 1 小时以前删除的 → 只清 old
      const purged = daos.trash.purgeDeleted(60 * 60 * 1000, now)
      expect(purged).toBe(1)
      expect(daos.sessions.getById(old)).toBeUndefined()
      expect(daos.trash.list().map((r) => r.extId)).toEqual(['trash-recent'])

      // 恢复后回到列表，且 FTS 行已随清除移除（不会再命中已删除会话）
      expect(daos.messages.searchSessions('异步编程')).toHaveLength(0)
      expect(daos.sessions.getById(keep)).not.toBeUndefined()
      daos.trash.restoreSessions([recent])
      expect(daos.sessions.listSessions().map((r) => r.extId).sort()).toEqual(['trash-keep', 'trash-recent'])
    } finally {
      temp.close()
    }
  })

  it('purgeDeleted 连 FTS 一并清理', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const id = daos.sessions.upsertSession(makeSession('purge-1'))
      daos.messages.replaceMessages(id, [makeMessage(id, 0, '异步编程 purge')])
      daos.trash.softDeleteSessions([id], Date.now() - 24 * 60 * 60 * 1000)
      daos.trash.purgeDeleted(60 * 60 * 1000)
      // 清理后 FTS 中不应残留孤儿行
      const orphans = temp.db
        .prepare('SELECT COUNT(*) AS c FROM fts_messages')
        .get() as { c: number }
      expect(orphans.c).toBe(0)
    } finally {
      temp.close()
    }
  })
})

describe('settings.dao & read_state.dao & groups.dao', () => {
  it('settings JSON 读写', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      expect(daos.settings.get('theme')).toBeUndefined()
      daos.settings.set('theme', { mode: 'dark' })
      daos.settings.set('interval', 30)
      expect(daos.settings.get('theme')).toEqual({ mode: 'dark' })
      expect(daos.settings.get('interval')).toBe(30)
      expect(daos.settings.getAll()).toEqual({ theme: { mode: 'dark' }, interval: 30 })
    } finally {
      temp.close()
    }
  })

  it('read_state 高水位 upsert 与查询', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      expect(daos.readState.get('opencode', 's1')).toBeUndefined()
      daos.readState.set('opencode', 's1', 100)
      expect(daos.readState.get('opencode', 's1')?.highWater).toBe(100)
      daos.readState.set('opencode', 's1', 200)
      expect(daos.readState.get('opencode', 's1')?.highWater).toBe(200)
      expect(daos.readState.list('opencode')).toHaveLength(1)
      daos.readState.remove('opencode', 's1')
      expect(daos.readState.get('opencode', 's1')).toBeUndefined()
    } finally {
      temp.close()
    }
  })

  it('groups 增删改与会话计数', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const g1 = daos.groups.createGroup('项目 A')
      const g2 = daos.groups.createGroup('项目 B')
      const s1 = daos.sessions.upsertSession(makeSession('g-s1'))
      const s2 = daos.sessions.upsertSession(makeSession('g-s2'))
      daos.sessions.moveToGroup(s1, g1)
      daos.sessions.moveToGroup(s2, g1)

      const groups = daos.groups.list()
      expect(groups.find((g) => g.id === g1)?.sessionCount).toBe(2)
      expect(groups.find((g) => g.id === g2)?.sessionCount).toBe(0)

      daos.groups.renameGroup(g1, '项目 A2')
      expect(daos.groups.get(g1)?.name).toBe('项目 A2')

      daos.groups.deleteGroup(g1)
      expect(daos.groups.get(g1)).toBeUndefined()
      // 组内会话回到未分组
      expect(daos.sessions.listSessions({ groupId: null })).toHaveLength(2)
    } finally {
      temp.close()
    }
  })

  it('listSessions 按数据源过滤 + countBySource 计数（排除已软删除）', () => {
    const temp = createTempDb()
    try {
      const daos = createDaos(temp.db)
      const oc1 = daos.sessions.upsertSession({ ...makeSession('oc-1'), source: 'opencode' })
      daos.sessions.upsertSession({ ...makeSession('oc-2'), source: 'opencode' })
      daos.sessions.upsertSession({ ...makeSession('cp-1'), source: 'copilot' })
      const qd = daos.sessions.upsertSession({ ...makeSession('qd-1'), source: 'qoder' })
      daos.trash.softDeleteSessions([qd], 1_700_000_000_111)

      // 按源过滤
      expect(daos.sessions.listSessions({ source: 'opencode' })).toHaveLength(2)
      expect(daos.sessions.listSessions({ source: 'copilot' })).toHaveLength(1)
      expect(daos.sessions.listSessions({ source: 'claude-code' })).toHaveLength(0)

      // 计数：已软删除的 qoder 不计入
      const counts = new Map(daos.sessions.countBySource().map((r) => [r.source, r.count]))
      expect(counts.get('opencode')).toBe(2)
      expect(counts.get('copilot')).toBe(1)
      expect(counts.get('qoder')).toBeUndefined()

      // 过滤 + 星标叠加：oc1 加星后仅返回 1 条
      daos.sessions.setStarred(oc1, true)
      expect(daos.sessions.listSessions({ source: 'opencode', starredOnly: true })).toHaveLength(1)
    } finally {
      temp.close()
    }
  })
})
