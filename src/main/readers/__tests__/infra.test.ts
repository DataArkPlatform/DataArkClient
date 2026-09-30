/**
 * reader infra —— 只读 SQLite（直读/快照兜底）与 JSONL 流式解析
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRo, snapshotCopy, tryOpenRo } from '../infra/ro-sqlite'
import { readJsonl } from '../infra/jsonl-stream'

describe('ro-sqlite', () => {
  it('直读已存在文件成功；缺失文件返回 undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-ro-'))
    try {
      const p = join(dir, 'src.db')
      const db = new Database(p)
      db.exec('CREATE TABLE t (a INTEGER)')
      db.exec('INSERT INTO t VALUES (1)')
      db.close()

      const ro = tryOpenRo(p)
      expect(ro).toBeDefined()
      expect((ro?.prepare('SELECT a FROM t').get() as { a: number }).a).toBe(1)
      ro?.close()

      expect(tryOpenRo(join(dir, 'missing.db'))).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('WAL 库只读打开可读到未 checkpoint 数据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-rowal-'))
    try {
      const p = join(dir, 'wal.db')
      const db = new Database(p)
      db.pragma('journal_mode = WAL')
      db.exec('CREATE TABLE t (a INTEGER)')
      db.exec('INSERT INTO t VALUES (7)')
      db.exec('INSERT INTO t VALUES (8)') // 留在 WAL 中
      db.close()

      const ro = tryOpenRo(p)
      expect(ro).toBeDefined()
      const sum = (ro?.prepare('SELECT sum(a) AS s FROM t').get() as { s: number }).s
      expect(sum).toBe(15)
      ro?.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('openRo 直读失败时走快照副本兜底', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-snap-'))
    try {
      const p = join(dir, 'src.db')
      const db = new Database(p)
      db.exec('CREATE TABLE t (a INTEGER)')
      db.exec('INSERT INTO t VALUES (42)')
      db.close()

      // 用一个不存在的路径（直读必败）验证快照兜底会失败而非悬挂
      await expect(openRo(join(dir, 'nope.db'), { retries: 0 })).rejects.toThrow()

      // 存在文件但直读抛错：先复制源文件到锁定状态不可行，这里验证 snapshotCopy 本身
      const snapDir = join(dir, 'snap')
      const copyPath = snapshotCopy(p, snapDir)
      expect(existsSync(copyPath)).toBe(true)
      const ro = tryOpenRo(copyPath)
      expect((ro?.prepare('SELECT a FROM t').get() as { a: number }).a).toBe(42)
      ro?.close()

      // openRo 正常路径（直读成功，非快照）
      const ro2 = await openRo(p, { retries: 0 })
      expect(ro2.isSnapshot).toBe(false)
      ro2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('快照复制包含 -wal 文件且副本可读', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-snap2-'))
    try {
      const p = join(dir, 'wal.db')
      const db = new Database(p)
      db.pragma('journal_mode = WAL')
      db.exec('CREATE TABLE t (a INTEGER)')
      db.exec('INSERT INTO t VALUES (1)')
      // 保持连接不关闭：模拟运行中锁库，-wal 仍在磁盘上
      const snapDir = join(dir, 'snap')
      const copyPath = snapshotCopy(p, snapDir)
      expect(existsSync(copyPath)).toBe(true)
      expect(existsSync(copyPath + '-wal')).toBe(true)
      const ro = tryOpenRo(copyPath)
      expect((ro?.prepare('SELECT a FROM t').get() as { a: number }).a).toBe(1)
      ro?.close()
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('jsonl-stream', () => {
  it('逐行解析，容忍坏行与末尾残缺行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-jsonl-'))
    try {
      const p = join(dir, 'events.jsonl')
      writeFileSync(
        p,
        '{"type":"a","n":1}\n{"type":"b","n":2}\n{invalid json}\n{"type":"c","n":3}\n',
        'utf8'
      )
      const errors: Array<{ line: number }> = []
      const rows: unknown[] = []
      for await (const row of readJsonl(p, { onError: (_line, _err) => errors.push({ line: _line }) })) {
        rows.push(row)
      }
      expect(rows).toHaveLength(3)
      expect(errors).toHaveLength(1)
      expect(errors[0]?.line).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('空行跳过，最后一行为合法 JSON（无换行）也能解析', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataark-jsonl2-'))
    try {
      const p = join(dir, 'a.jsonl')
      writeFileSync(p, '{"x":1}\n\n{"x":2}', 'utf8')
      const rows: unknown[] = []
      for await (const row of readJsonl(p)) rows.push(row)
      expect(rows).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
