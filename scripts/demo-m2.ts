/**
 * M2 数据层核心演示 —— 运行方式：npx tsx scripts/demo-m2.ts
 *
 * 验证链路：
 *  1. 迁移全新临时库
 *  2. ingest 3 条 mock 会话（走完整管线：discover → diff → read → normalize → hooks → index）
 *  3. FTS 中文查询 "异步编程" 命中正确会话
 *  4. 增量重扫：零重复
 *  5. 软删除 + 恢复
 *
 * 全程只使用 os.tmpdir()，不触碰任何真实用户目录。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RawMessage, RawSessionRef } from '../src/shared/unified-model'
import type { ReaderAdapter } from '../src/main/readers/types'
import { openDb } from '../src/main/db/connection'
import { migrate } from '../src/main/db/migrations'
import { createDaos } from '../src/main/db/dao'
import { ingestSource } from '../src/main/pipeline/ingest'

interface MockConversation {
  extId: string
  title: string
  updatedAt: number
  messages: RawMessage[]
}

function buildMockData(): MockConversation[] {
  const base = Date.now() - 3 * 24 * 60 * 60 * 1000
  const mk = (role: 'user' | 'assistant', text: string): RawMessage => ({
    role,
    sentAt: base,
    blocks: [{ type: 'text', text }]
  })
  return [
    {
      extId: 'mock-session-1',
      title: 'Python 异步编程实战',
      updatedAt: base + 1000,
      messages: [
        mk('user', '请讲解 Python 异步编程最佳实践'),
        mk('assistant', '推荐 asyncio + async/await，配合 uvloop 与任务调度。'),
        {
          role: 'assistant',
          sentAt: base,
          blocks: [
            { type: 'tool_call', tool: 'read', callId: 'c1', state: '{"status":"completed"}' },
            { type: 'step_marker', phase: 'start' },
            { type: 'step_marker', phase: 'finish' }
          ]
        }
      ]
    },
    {
      extId: 'mock-session-2',
      title: 'React 性能优化',
      updatedAt: base + 2000,
      messages: [
        mk('user', 'React 组件性能优化指南有哪些要点'),
        mk('assistant', '注意 memo、useMemo 与列表 key。')
      ]
    },
    {
      extId: 'mock-session-3',
      title: 'SQLite FTS5 检索设计',
      updatedAt: base + 3000,
      messages: [
        mk('user', 'SQLite FTS5 全文检索怎么做中文分词'),
        mk('assistant', 'trigram 分词器是内置最优解。')
      ]
    }
  ]
}

function makeDemoReader(conversations: MockConversation[]): ReaderAdapter {
  return {
    source: 'opencode',
    isAvailable: async () => ({ available: true, detail: 'mock' }),
    listSessions: async () =>
      conversations.map((c) => ({
        source: 'opencode',
        extId: c.extId,
        updatedAt: c.updatedAt,
        titleHint: c.title
      })),
    async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
      const conversation = conversations.find((c) => c.extId === ref.extId)
      if (!conversation) return
      for (const message of conversation.messages) yield message
    }
  }
}

let passed = 0
let failed = 0
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.error(`  ✘ ${name}`, detail !== undefined ? `(${JSON.stringify(detail)})` : '')
  }
}

async function main(): Promise<void> {
  console.log('语料方舟 DataArt · M2 数据层核心演示\n')

  // 1) 迁移全新临时库
  const dir = mkdtempSync(join(tmpdir(), 'dataark-demo-'))
  const dbPath = join(dir, 'dataark.db')
  const db = openDb(dbPath)
  migrate(db)
  console.log(`[1] 迁移完成: ${dbPath}`)
  check('schema_migrations 版本为 1', (() => {
    const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>
    return rows.length === 1 && rows[0]?.version === 1
  })())

  // 2) ingest 3 条 mock 会话
  const conversations = buildMockData()
  const reader = makeDemoReader(conversations)
  const daos = createDaos(db)

  const first = await ingestSource(reader, db, {
    onProgress: (p) => {
      if (p.phase === 'reading' && p.extId) {
        console.log(`  读取会话 ${p.extId} (${p.current}/${p.total})`)
      }
    }
  })
  console.log(`[2] 首次 ingest 完成: 新增=${first.scannedNew} 更新=${first.scannedUpdated} 跳过=${first.skipped} 错误=${first.errors.length}`)
  check('3 条会话全部入库', first.scannedNew === 3 && first.errors.length === 0)
  check('消息总数 = 7', (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c === 7)

  // 3) FTS 中文查询
  console.log('[3] FTS 中文查询 "异步编程"')
  const hits = daos.messages.searchSessions('异步编程')
  check('命中 1 个会话', hits.length === 1)
  check('命中 mock-session-1（Python 异步编程实战）', hits[0]?.extId === 'mock-session-1')
  check(`snippet 含关键词: "${hits[0]?.snippet}"`, (hits[0]?.snippet ?? '').includes('异步编程'))
  const unrelated = daos.messages.searchSessions('性能优化')
  check('"性能优化" 命中 mock-session-2', unrelated[0]?.extId === 'mock-session-2')

  // 4) 增量重扫：零重复
  const second = await ingestSource(reader, db)
  console.log(`[4] 增量重扫完成: 新增=${second.scannedNew} 更新=${second.scannedUpdated} 跳过=${second.skipped} 错误=${second.errors.length}`)
  check('重扫全部跳过（零重复）', second.skipped === 3 && second.scannedNew === 0)
  check('消息总数仍为 7', (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c === 7)
  check('会话总数仍为 3', daos.sessions.listSessions().length === 3)

  // 5) 软删除 + 恢复
  console.log('[5] 软删除 + 恢复')
  const target = daos.sessions.getByExtId('opencode', 'mock-session-2')
  if (target) {
    daos.trash.softDeleteSessions([target.id])
    const inTrash = daos.trash.list()
    check('软删除后进入回收站', inTrash.length === 1 && inTrash[0]?.extId === 'mock-session-2')
    check('普通列表不再出现', daos.sessions.listSessions().length === 2)
    const restored = daos.trash.restoreSessions([target.id])
    check('恢复成功', restored === 1)
    check('恢复后回到列表', daos.sessions.listSessions().length === 3)
  } else {
    check('找到目标会话', false)
  }

  db.close()
  rmSync(dir, { recursive: true, force: true })

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

void main()
