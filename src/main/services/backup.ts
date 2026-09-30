/**
 * backup.ts —— 索引库快照备份（M7）
 *
 * 备份策略（与源数据读取无关，备份的是本地派生索引库 dataark.db）：
 * - 目标目录来自设置 'autoBackup.dir'（缺省 %USERPROFILE%\Documents\DataArtBackups）。
 * - 拷贝 db + wal + shm 三件套（WAL 模式下 wal 含未 checkpoint 数据），
 *   命名 dataark-backup-YYYYMMDD-HHmmss.db(+wal/shm)。
 * - maybeAutoBackup() 供「每次读取完成后」自动触发：未开启自动备份时静默跳过。
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BackupResult } from '../../shared/data-contract'
import type { DaoBundle } from '../db/dao'
import { getDefaultDbPath } from '../db/connection'

/** 默认备份目录（%USERPROFILE%\Documents\DataArtBackups） */
export function defaultBackupDir(): string {
  return join(homedir(), 'Documents', 'DataArtBackups')
}

/** 读取 'autoBackup.dir'（未设置时用默认目录） */
export function resolveBackupDir(settings: DaoBundle['settings']): string {
  const raw = settings.get('autoBackup.dir')
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : defaultBackupDir()
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 拷贝当前索引库快照到指定目录。
 * 返回备份 .db 文件路径与字节数；拷贝失败抛出异常（由调用方 toast）。
 */
export function backupDbSnapshot(
  settings: DaoBundle['settings'],
  targetDir = resolveBackupDir(settings)
): BackupResult {
  const dbPath = getDefaultDbPath()
  if (!existsSync(dbPath)) {
    throw new Error(`索引库不存在，无法备份: ${dbPath}`)
  }
  mkdirSync(targetDir, { recursive: true })
  const name = `dataark-backup-${timestamp()}.db`
  const targetDb = join(targetDir, name)
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbPath + suffix
    if (existsSync(src)) {
      copyFileSync(src, targetDb + suffix)
    }
  }
  return { file: targetDb, size: statSync(targetDb).size }
}

/**
 * 读取完成后自动备份：'autoBackup.enabled' 为 true 时执行快照备份。
 * 失败仅 console.warn（不打断主流程）；返回备份结果或 null（未开启）。
 */
export function maybeAutoBackup(daos: DaoBundle): BackupResult | null {
  const enabled = daos.settings.get('autoBackup.enabled') === true
  if (!enabled) return null
  try {
    return backupDbSnapshot(daos.settings)
  } catch (error) {
    console.warn(
      '[backup] 自动备份失败',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
