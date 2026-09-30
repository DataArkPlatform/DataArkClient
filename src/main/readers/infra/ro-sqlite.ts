/**
 * 只读 SQLite 基建 —— 外部数据源（OpenCode 等）只读访问
 *
 * 策略（architecture.md 安全边界）：
 * 1. 优先 SQLITE_OPEN_READONLY 直读（better-sqlite3 以 readonly + fileMustExist 打开，
 *    实测可读 WAL 未 checkpoint 数据；注意 better-sqlite3 不支持 file: URI 模式）
 * 2. 直读失败（锁冲突 / 文件缺失等）→ 重试
 * 3. 仍失败 → db + wal + shm 三件套快照复制到临时目录，读副本
 *
 * 绝不写源文件；关闭时如为快照副本会自动清理临时目录。
 */
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

export interface RoDatabase {
  db: DatabaseType
  /** 是否在快照副本上打开 */
  isSnapshot: boolean
  sourcePath: string
  close(): void
}

export interface OpenRoOptions {
  /** 直读失败后的重试次数（默认 2，之后走快照兜底） */
  retries?: number
  retryDelayMs?: number
  /** 快照临时目录；缺省 os.tmpdir() 下自动生成 */
  tmpDir?: string
  onRetry?: (attempt: number, error: unknown) => void
}

/** 尝试只读打开；失败返回 undefined（不抛错） */
export function tryOpenRo(dbPath: string): DatabaseType | undefined {
  try {
    return new Database(dbPath, {
      readonly: true,
      fileMustExist: true
    })
  } catch {
    return undefined
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeSnapshotDir(baseDir?: string): string {
  const root = baseDir ?? join(tmpdir(), 'dataark-ro')
  mkdirSync(root, { recursive: true })
  return join(root, randomUUID())
}

/** 复制 db(+wal+shm) 到目标目录，返回副本的 db 路径 */
export function snapshotCopy(dbPath: string, targetDir: string): string {
  mkdirSync(targetDir, { recursive: true })
  const name = basename(dbPath)
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbPath + suffix
    if (existsSync(src)) {
      copyFileSync(src, join(targetDir, name + suffix))
    }
  }
  return join(targetDir, name)
}

/** 只读打开：直读(可重试) → 快照副本兜底 */
export async function openRo(dbPath: string, options: OpenRoOptions = {}): Promise<RoDatabase> {
  const retries = options.retries ?? 2
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const direct = tryOpenRo(dbPath)
    if (direct) {
      return {
        db: direct,
        isSnapshot: false,
        sourcePath: dbPath,
        close: () => closeRo(direct)
      }
    }
    if (attempt < retries) {
      options.onRetry?.(attempt + 1, new Error(`read-only open failed (attempt ${attempt + 1})`))
      await delay(options.retryDelayMs ?? 100)
    }
  }

  // 兜底：三件套快照后读副本
  const snapshotDir = makeSnapshotDir(options.tmpDir)
  let snapshotPath: string
  try {
    snapshotPath = snapshotCopy(dbPath, snapshotDir)
  } catch (error) {
    rmSync(snapshotDir, { recursive: true, force: true })
    throw new Error(
      `快照复制失败: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
  const db = tryOpenRo(snapshotPath)
  if (!db) {
    rmSync(snapshotDir, { recursive: true, force: true })
    throw new Error(`无法只读打开 "${dbPath}"（直读与快照副本均失败）`)
  }
  return {
    db,
    isSnapshot: true,
    sourcePath: dbPath,
    close: () => {
      closeRo(db)
      rmSync(snapshotDir, { recursive: true, force: true })
    }
  }
}

export function closeRo(db: DatabaseType): void {
  if (db.open) db.close()
}
