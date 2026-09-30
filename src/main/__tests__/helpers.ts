/**
 * 测试共享工具 —— 临时库 + Mock 适配器
 * 所有测试只使用 os.tmpdir() 临时目录，绝不触碰真实用户目录。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as DatabaseType } from 'better-sqlite3'
import { openDb } from '../db/connection'
import { migrate } from '../db/migrations'
import type { RawMessage, RawSessionRef } from '../../shared/unified-model'
import type { ReaderAdapter } from '../readers/types'

export interface TempDb {
  dir: string
  path: string
  db: DatabaseType
  close(): void
}

/** 创建已迁移的空临时索引库 */
export function createTempDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'dataark-test-'))
  const path = join(dir, 'dataark.db')
  const db = openDb(path)
  migrate(db)
  return {
    dir,
    path,
    db,
    close() {
      if (db.open) db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export interface MockConversation {
  extId: string
  title?: string
  directory?: string
  parentExtId?: string
  startedAt?: number
  updatedAt: number
  messages: RawMessage[]
}

/** 基于 MockConversation 列表构造 ReaderAdapter */
export function makeMockReader(conversations: MockConversation[]): ReaderAdapter {
  const toRef = (c: MockConversation): RawSessionRef => ({
    source: 'opencode',
    extId: c.extId,
    updatedAt: c.updatedAt,
    ...(c.title !== undefined ? { titleHint: c.title } : {}),
    ...(c.directory !== undefined ? { directory: c.directory } : {}),
    ...(c.parentExtId !== undefined ? { parentExtId: c.parentExtId } : {}),
    ...(c.startedAt !== undefined ? { startedAt: c.startedAt } : {})
  })
  return {
    source: 'opencode',
    isAvailable: async () => ({ available: true, detail: 'mock' }),
    // 每次调用即时生成引用，保证测试中修改 conversations 后可见（增量语义）
    listSessions: async () => conversations.map(toRef),
    async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
      const conversation = conversations.find((c) => c.extId === ref.extId)
      if (!conversation) return
      for (const message of conversation.messages) {
        yield message
      }
    }
  }
}
