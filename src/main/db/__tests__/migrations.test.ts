/**
 * migrations —— 幂等性 + 表结构完整性
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../connection'
import { appliedMigrations, listMigrations, migrate } from '../migrations'
import { createTempDb } from '../../__tests__/helpers'

const REQUIRED_TABLES = [
  'sessions',
  'messages',
  'groups',
  'read_state',
  'settings',
  'fts_messages',
  'schema_migrations'
]

function tableNames(db: ReturnType<typeof openDb>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

describe('migrations', () => {
  it('迁移清单可载入且版本连续从 1 开始', () => {
    const migrations = listMigrations()
    expect(migrations.length).toBeGreaterThanOrEqual(1)
    expect(migrations[0]?.version).toBe(1)
    for (let i = 1; i < migrations.length; i += 1) {
      expect(migrations[i]?.version).toBe((migrations[i - 1]?.version ?? 0) + 1)
    }
  })

  it('首次迁移建齐全部表', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-mig-'))
    try {
      const db = openDb(join(dir, 'fresh.db'))
      migrate(db)
      const tables = tableNames(db)
      for (const required of REQUIRED_TABLES) {
        expect(tables).toContain(required)
      }
      expect(appliedMigrations(db)).toEqual([1])
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('重复迁移幂等（运行两次无副作用）', () => {
    const temp = createTempDb()
    try {
      expect(() => migrate(temp.db)).not.toThrow()
      expect(() => migrate(temp.db)).not.toThrow()
      expect(appliedMigrations(temp.db)).toEqual([1])
    } finally {
      temp.close()
    }
  })

  it('外键与索引存在', () => {
    const temp = createTempDb()
    try {
      const fk = temp.db
        .prepare('PRAGMA foreign_key_list(messages)')
        .all() as Array<{ table: string; from: string; to: string }>
      expect(fk.some((row) => row.table === 'sessions' && row.to === 'id')).toBe(true)

      const indexes = temp.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('sessions','messages')")
        .all() as Array<{ name: string }>
      const names = indexes.map((r) => r.name)
      expect(names).toContain('idx_sessions_updated_at')
      expect(names).toContain('idx_messages_session_seq')
      // FTS5 影子表存在（确认虚拟表真实创建）
      const tables = tableNames(temp.db)
      expect(tables).toContain('fts_messages_data')
    } finally {
      temp.close()
    }
  })
})
