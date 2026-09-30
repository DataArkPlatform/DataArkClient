/**
 * better-sqlite3 连接层 —— WAL / 外键 / busy_timeout
 *
 * 设计约束：
 * - 不直接依赖 electron（懒加载），保证单元测试 / 演示脚本在纯 Node 下可运行
 * - 默认库位置为 app.getPath('userData')/dataark.db，可用 DATAARK_DB_PATH 环境变量覆盖
 */
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export interface OpenDbOptions {
  /** 锁冲突等待毫秒数（默认 3000） */
  busyTimeoutMs?: number
}

/** 打开（或创建）索引库，并按项目约定设置 PRAGMA */
export function openDb(dbPath: string, options: OpenDbOptions = {}): DatabaseType {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  // WAL + synchronous=NORMAL 是 SQLite 官方推荐的性能组合：提交不再逐笔 fsync，
  // 掉电最多丢失最近事务、库永不损坏 —— 对可随时重建的派生索引层完全可接受。
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 3000}`)
  return db
}

/** 解析默认索引库路径（测试/脚本可传入显式路径绕开本函数） */
export function getDefaultDbPath(): string {
  const envPath = process.env['DATAARK_DB_PATH']
  if (envPath) return envPath
  const app = loadElectronApp()
  if (app) return join(app.getPath('userData'), 'dataark.db')
  // 非 Electron 主进程环境（worker/测试/演示）不应落到 cwd 兜底：
  // 打包应用从快捷方式启动时 cwd 常为 System32（不可写），静默写错位置比显式失败更糟。
  // 生产链路必须由主进程解析路径后显式下发（见 scanService/scheduler）。
  throw new Error(
    '无法解析索引库路径：当前线程不可用 electron.app，且未设置 DATAARK_DB_PATH。' +
      '请由主进程解析 dbPath 后显式传入。'
  )
}

interface ElectronApp {
  getPath(name: string): string
}

/**
 * 懒加载 electron.app —— 在纯 Node（vitest / tsx / worker）下
 * require('electron') 只会得到二进制路径字符串，因此必须运行时探测并容错。
 */
function loadElectronApp(): ElectronApp | undefined {
  try {
    const electron = require_('electron') as unknown
    if (electron !== null && typeof electron === 'object' && 'app' in electron) {
      const app = (electron as { app?: { getPath(name: string): string } }).app
      if (app && typeof app.getPath === 'function') return app
    }
  } catch {
    // 不在 Electron 进程内
  }
  return undefined
}

// CJS 打包产物里 import.meta.url 为空，须回退 __filename（Node CJS 全局）；
// ESM（vitest/tsx/electron-vite ESM）下 __filename 不存在，用 import.meta.url。
const require_ = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
