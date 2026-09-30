/**
 * scheduler.ts —— 定时任务（M7）
 *
 * 职责（后台定时）：
 * 1. 回收站自动清理：每 10 分钟 purgeDeleted(24h)，响应式：启动时执行一次。
 * 2. 自动读取：'autoRead.enabled' 开启时按 'autoRead.intervalHours' 起 worker 线程
 *    （与手动扫描同管线 → 天然增量）；范围取 'autoRead.sources' 勾选 ∩ 实际可用
 *    （未配置过 = 默认全部可用源；配置为空数组 = 用户显式关闭范围 → 跳过）。
 *    完成后按 'autoRead.notify' 且新增 >0 弹系统通知；开启 'autoBackup.enabled' 则顺手备份。
 *
 * 配置变更即生效：settingsSet('autoRead.*') 处理器会调用 applySchedulerSettings()。
 */
import { Notification } from 'electron'
import type { DaoBundle } from '../db/dao'
import type { AgentSource } from '../../shared/unified-model'
import { AGENT_SOURCES } from '../../shared/unified-model'
import { getDefaultDbPath } from '../db/connection'
import { loadReader } from '../readers/registry'
import { isIngestRunning, runIngest } from './scanService'
import { maybeAutoBackup } from './backup'

/** 回收站保留窗口（24h） */
const TRASH_RETENTION_MS = 24 * 60 * 60 * 1000
/** 回收站自动清理间隔 */
const TRASH_CLEANUP_INTERVAL_MS = 10 * 60 * 1000
/** 自动读取最小周期（15 分钟，防误配 0/负数） */
const MIN_READ_INTERVAL_MS = 15 * 60 * 1000

let daosRef: (() => DaoBundle) | null = null
let cleanupTimer: NodeJS.Timeout | null = null
let readTimer: NodeJS.Timeout | null = null
let autoReading = false

/** 启动执行一次清理 + 按需打印（默认静默，>0 时 console.info） */
function runTrashCleanup(): void {
  const daos = daosRef?.()
  if (daos === undefined) return
  try {
    const count = daos.trash.purgeDeleted(TRASH_RETENTION_MS)
    if (count > 0) console.info(`[scheduler] 回收站自动清理 ${count} 条过期会话`)
  } catch (error) {
    console.warn(
      '[scheduler] 回收站自动清理失败',
      error instanceof Error ? error.message : String(error)
    )
  }
}

/**
 * 解析本次自动读取的源范围：'autoRead.sources' 勾选 ∩ 实际可用。
 * - 设置不存在（从未配置）：默认全部可用源
 * - 设置为空数组：用户显式清空 → 返回 []（本次跳过）
 */
async function resolveAutoReadSources(daos: DaoBundle): Promise<AgentSource[]> {
  const configured = daos.settings.get('autoRead.sources')
  let wanted: AgentSource[]
  if (configured === undefined) {
    wanted = [...AGENT_SOURCES]
  } else if (Array.isArray(configured)) {
    wanted = configured.filter(
      (s): s is AgentSource => typeof s === 'string' && (AGENT_SOURCES as readonly string[]).includes(s)
    )
    if (wanted.length === 0) return []
  } else {
    return []
  }
  const available: AgentSource[] = []
  for (const source of wanted) {
    const loadResult = await loadReader(source)
    if (loadResult === undefined || 'unavailableReason' in loadResult) continue
    const reader = loadResult
    if ((await reader.isAvailable()).available) available.push(source)
  }
  return available
}

/** 执行自动读取：逐源 worker ingest（增量）+ 可选通知 + 自动备份 */
async function runAutoRead(): Promise<void> {
  if (autoReading || isIngestRunning()) return // 与手动扫描互斥，避免并行
  autoReading = true
  try {
    const daos = daosRef?.()
    if (daos === undefined) return
    const sources = await resolveAutoReadSources(daos)
    if (sources.length === 0) return
    let totalNew = 0
    for (const source of sources) {
      if (isIngestRunning()) break
      const payload = await runIngest({
        source,
        // 显式传索引库 userData 路径（worker 拿不到 electron.app）
        dbPath: getDefaultDbPath()
      })
      if (payload.ok) {
        totalNew += payload.report.scannedNew
      } else {
        console.warn(`[scheduler] 自动读取失败(${source}):`, payload.error)
      }
    }
    const daosAfter = daosRef?.()
    if (daosAfter !== undefined) {
      if (totalNew > 0) {
        const notify = daosAfter.settings.get('autoRead.notify') !== false
        if (notify) {
          new Notification({
            title: '语料方舟',
            body: `自动读取完成：新增 ${totalNew} 条会话`
          }).show()
        }
      }
      maybeAutoBackup(daosAfter)
    }
  } catch (error) {
    console.warn(
      '[scheduler] 自动读取失败',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    autoReading = false
  }
}

/**
 * 应用定时器（设置变更/启动时调用）：
 * 关闭 → 清定时器；开启 → 按 intervalHours 重设（≥15 分钟下限）。
 */
export function applySchedulerSettings(): void {
  if (daosRef === null) return
  if (readTimer !== null) {
    clearInterval(readTimer)
    readTimer = null
  }
  const settings = daosRef().settings
  const enabled = settings.get('autoRead.enabled') === true
  if (!enabled) return
  const rawHours = settings.get('autoRead.intervalHours')
  const hours = typeof rawHours === 'number' && Number.isFinite(rawHours) ? rawHours : 4
  const intervalMs = Math.max(hours * 60 * 60 * 1000, MIN_READ_INTERVAL_MS)
  readTimer = setInterval(() => void runAutoRead(), intervalMs)
}

/** 启动定时器（应用 ready 时调用一次，daosRef 由 main 注入） */
export function initScheduler(getDaos: () => DaoBundle): void {
  daosRef = getDaos
  // 回收站：启动清一次 + 每 10 分钟巡检
  runTrashCleanup()
  cleanupTimer = setInterval(runTrashCleanup, TRASH_CLEANUP_INTERVAL_MS)
  // 自动读取：按设置排程
  applySchedulerSettings()
}

/** 停止全部定时器（应用退出时调用） */
export function stopScheduler(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  if (readTimer !== null) {
    clearInterval(readTimer)
    readTimer = null
  }
  daosRef = null
}