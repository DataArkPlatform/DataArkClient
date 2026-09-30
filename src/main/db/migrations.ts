/**
 * 编号迁移脚本框架 —— 单库按版本号顺序应用，幂等
 *
 * 迁移 SQL 的权威来源是 src/main/db/migrations/NNN_name.sql 文件；
 * 当运行环境拿不到文件（如 electron-vite 打包后 out/ 未携带 .sql）时，
 * 回退到内嵌迁移清单（内容与文件保持一致）。
 */
import type { Database as DatabaseType } from 'better-sqlite3'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Migration {
  version: number
  name: string
  sql: string
}

export interface MigrateOptions {
  /** 迁移脚本目录（默认 src/main/db/migrations） */
  migrationsDir?: string
}

/** 内嵌迁移清单（与 migrations/*.sql 内容一致，供打包后无文件环境使用） */
const EMBEDDED_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  ext_id        TEXT NOT NULL,
  title         TEXT,
  directory     TEXT,
  parent_ext_id TEXT,
  started_at    INTEGER,
  updated_at    INTEGER,
  msg_count     INTEGER DEFAULT 0,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cost          REAL,
  starred       INTEGER DEFAULT 0,
  group_id      TEXT,
  deleted_at    INTEGER,
  UNIQUE (source, ext_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL,
  sent_at       INTEGER,
  agent_name    TEXT,
  model_name    TEXT,
  provider      TEXT,
  finish_reason TEXT,
  blocks        TEXT NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS read_state (
  source     TEXT NOT NULL,
  ext_id     TEXT NOT NULL,
  high_water INTEGER NOT NULL DEFAULT 0,
  scanned_at INTEGER,
  PRIMARY KEY (source, ext_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5 (
  text,
  tokenize = 'trigram'
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions (updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages (session_id, seq);
`
  }
]

// CJS 打包产物里 import.meta.url 为空，须回退 __dirname（Node CJS 全局）；
// ESM（vitest/tsx）下 __dirname 不存在，用 import.meta.url。
const moduleDir =
  typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
const FALLBACK_DIR = join(moduleDir, 'migrations')

/** 载入迁移清单：优先读文件目录，目录缺失时回退内嵌清单 */
export function listMigrations(migrationsDir?: string): Migration[] {
  const dir = migrationsDir ?? FALLBACK_DIR
  if (existsSync(dir)) {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    const fromFiles: Migration[] = []
    for (const file of files) {
      const match = /^(\d+)_(.+)\.sql$/.exec(file)
      if (!match) continue
      fromFiles.push({
        version: Number(match[1]),
        name: match[2],
        sql: readFileSync(join(dir, file), 'utf8')
      })
    }
    if (fromFiles.length > 0) return fromFiles
  }
  return EMBEDDED_MIGRATIONS
}

/** 将未应用的迁移按版本顺序应用；重复调用为幂等 */
export function migrate(db: DatabaseType, options: MigrateOptions = {}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => row.version
    )
  )
  const pending = listMigrations(options.migrationsDir).filter((m) => !applied.has(m.version))
  if (pending.length === 0) return

  const apply = db.transaction(() => {
    const insert = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    )
    // 事务内重检：主进程与 worker 线程可能并发 migrate（BEGIN IMMEDIATE 串行化后，
    // 后到者在此看到已应用集合并跳过，避免 schema_migrations UNIQUE 冲突）
    const current = new Set<number>(
      (
        db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>
      ).map((row) => row.version)
    )
    for (const migration of pending) {
      if (current.has(migration.version)) continue
      db.exec(migration.sql)
      insert.run(migration.version, migration.name, Date.now())
    }
  })
  apply.immediate()
}

/** 当前已应用的迁移版本列表 */
export function appliedMigrations(db: DatabaseType): number[] {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
    version: number
  }>
  return rows.map((row) => row.version)
}
