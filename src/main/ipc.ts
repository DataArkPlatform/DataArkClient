/**
 * 数据层 IPC 处理器 —— 会话管理（M4）全部数据通道 + AI Agent 读取（M6）
 * + 垃圾箱/设置/导出/备份（M7）在此注册。
 *
 * 设计：
 * - DB 懒加载单例（getDefaultDbPath + migrate 幂等），首次调用才打开。
 * - 处理器只做「参数投影 → DAO 调用 → 结果投影」，不做重活（不阻塞主进程）。
 * - 错误以 throw 透出，renderer 侧经 ipcRenderer.invoke 收到 rejection。
 * - M6 读取在 worker 线程（scanner.worker，经 `?nodeWorker` 构建）内执行：
 *   主进程只负责 spawn / 透传进度 / 收尾 terminate，绝不在主线程跑 ingest；
 *   生命周期（并发锁/取消）统一收口到 services/scanService.ts。
 */
import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { AgentSource } from '../shared/unified-model'
import { AGENT_SOURCES } from '../shared/unified-model'
import {
  DATA_IPC,
  type BackupResult,
  type ConversationDetail,
  type ConversationListQuery,
  type ConversationListItem,
  type ConversationListResult,
  type ConversationSourceCount,
  type ConversationTimeRange,
  type ExportConversationRequest,
  type ExportResult,
  type GroupSummary,
  type ScanDetection,
  type ScanDoneCard,
  type ScanDonePayload,
  type ScannerRequest,
  type TrashItem,
  type UnavailableReason
} from '../shared/data-contract'
import { openDb, getDefaultDbPath } from './db/connection'
import { migrate } from './db/migrations'
import { createDaos, type DaoBundle } from './db/dao'
import type { SessionRow } from './db/dao/sessions.dao'
import { loadReader } from './readers/registry'
import { openRo } from './readers/infra/ro-sqlite'
import { resolveDbPath } from './readers/opencode'
import { cancelActiveIngest, isIngestRunning, runIngest } from './services/scanService'
import { exportConversationsToDir } from './services/export'
import { backupDbSnapshot, defaultBackupDir, maybeAutoBackup, resolveBackupDir } from './services/backup'
import { applySchedulerSettings } from './services/scheduler'
import { logger } from './logger'
import { renameSync } from 'node:fs'

let db: DatabaseType | null = null
let bundle: DaoBundle | null = null

function getDb(): DatabaseType {
  if (db === null) {
    const dbPath = getDefaultDbPath()
    try {
      db = openDb(dbPath)
      migrate(db)
    } catch (err) {
      /* 索引库损坏 → 隔离损坏文件后重建（派生层可随时重建，源数据不受影响）
       * Windows：必须先 close 失败连接——否则句柄占用导致 rename EBUSY，损坏文件原样残留 */
      try {
        db?.close()
      } catch {
        /* ignore */
      }
      db = null
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          renameSync(`${dbPath}${suffix}`, `${dbPath}.corrupt-${stamp}${suffix}`)
        } catch {
          /* 文件可能不存在 */
        }
      }
      logger.error(`索引库打开失败，已隔离重建: ${String(err)}`)
      db = openDb(dbPath)
      migrate(db)
    }
  }
  return db
}

function getDaos(): DaoBundle {
  if (bundle === null) bundle = createDaos(getDb())
  return bundle
}

/** 供 scheduler（main/index.ts 注入）等外部模块访问 DAO 单例 */
export function getDataDaos(): DaoBundle {
  return getDaos()
}

const DAY_MS = 86_400_000

/** 时间范围 → 起始毫秒；'all' 返回 null */
function timeRangeSince(range: ConversationTimeRange | undefined, now = Date.now()): number | null {
  switch (range) {
    case 'today': {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    case '7d':
      return now - 7 * DAY_MS
    case '30d':
      return now - 30 * DAY_MS
    default:
      return null
  }
}

function toListItem(row: SessionRow): ConversationListItem {
  return {
    id: row.id,
    title: row.title ?? '',
    source: row.source as AgentSource,
    directory: row.directory,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    msgCount: row.msgCount,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    cost: row.cost,
    starred: row.starred === 1,
    groupId: row.groupId,
    parentExtId: row.parentExtId
  }
}

/**
 * 会话列表。
 * - 无 query：sessions 表全量条件过滤（未删除/分组/星标）+ 时间范围内存过滤。
 * - 有 query：FTS5 内容命中 ∪ 标题 LIKE 命中（去重后统一按更新时间倒序展示）。
 */
function listConversations(query: ConversationListQuery): ConversationListResult {
  const { sessions, messages } = getDaos()
  const keyword = query.query?.trim() ?? ''
  const groupId = query.groupId
  const starredOnly = query.starredOnly === true
  const source = query.source
  const offset = Math.min(Math.max(0, query.offset ?? 0), MAX_OFFSET)
  const limit = Math.min(Math.max(0, query.limit ?? 200), MAX_LIMIT)
  const since = timeRangeSince(query.timeRange)

  let rows: SessionRow[]
  if (keyword.length > 0) {
    const ftsHits = messages.searchSessions(keyword)
    const titleRows = sessions.listSessions({ groupId, starredOnly, source })
    const lower = keyword.toLowerCase()
    const seen = new Set<string>()
    const merged: SessionRow[] = []
    for (const hit of ftsHits) {
      if (starredOnly && hit.starred !== 1) continue
      if (groupId !== undefined && hit.groupId !== (groupId ?? null)) continue
      if (source !== undefined && hit.source !== source) continue
      if (!seen.has(hit.id)) {
        seen.add(hit.id)
        merged.push(hit)
      }
    }
    for (const row of titleRows) {
      if (!seen.has(row.id) && (row.title ?? '').toLowerCase().includes(lower)) {
        seen.add(row.id)
        merged.push(row)
      }
    }
    rows = merged
  } else {
    rows = sessions.listSessions({ groupId, starredOnly, source })
  }

  if (since !== null) rows = rows.filter((r) => (r.updatedAt ?? 0) >= since)
  rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  const total = rows.length
  const items = rows.slice(offset, offset + limit).map(toListItem)
  return { total, items }
}

/** 各数据源未删除会话计数（会话管理「按 Agent 筛选」胶囊） */
function listConversationSources(): ConversationSourceCount[] {
  return getDaos()
    .sessions.countBySource()
    .map((r) => ({ source: r.source as AgentSource, count: r.count }))
}

function getConversation(id: string): ConversationDetail | null {
  const { sessions, messages } = getDaos()
  const row = sessions.getById(id)
  if (!row) return null
  const msgs = messages.getMessages(id)
  return {
    ...toListItem(row),
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      sentAt: m.sentAt,
      agentName: m.agentName,
      modelName: m.modelName,
      blocks: m.blocks
    }))
  }
}

function setStarred(id: string, starred: boolean): void {
  const changed = getDaos().sessions.setStarred(id, starred)
  if (changed === 0) throw new Error(`会话不存在: ${id}`)
}

function softDelete(ids: readonly string[]): { count: number } {
  const count = getDaos().trash.softDeleteSessions(ids)
  return { count }
}

function listGroups(): GroupSummary[] {
  return getDaos()
    .groups.list()
    .map((g) => ({ id: g.id, name: g.name, count: g.sessionCount }))
}

function createGroup(name: string): GroupSummary {
  const trimmed = name.trim()
  const finalName = trimmed.length > 0 ? trimmed : '未命名分组'
  const id = getDaos().groups.createGroup(finalName)
  return { id, name: finalName, count: 0 }
}

function renameGroup(id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('分组名称不能为空')
  const changed = getDaos().groups.renameGroup(id, trimmed)
  if (changed === 0) throw new Error(`分组不存在: ${id}`)
}

function removeGroup(id: string): void {
  getDaos().groups.deleteGroup(id)
}

function assignGroup(sessionIds: readonly string[], groupId: string | null): void {
  if (sessionIds.length === 0) return
  const { sessions, groups } = getDaos()
  if (groupId !== null && groups.get(groupId) === undefined) {
    throw new Error(`分组不存在: ${groupId}`)
  }
  const tx = getDb().transaction((ids: readonly string[]) => {
    for (const id of ids) sessions.moveToGroup(id, groupId)
  })
  tx(sessionIds)
}

/* ============================================================
   M6 · AI Agent 读取 —— 探测 + worker 生命周期
   （worker 生命周期/并发锁在 services/scanService.ts，此处只做事件透传）
   ============================================================ */

/** 发起扫描的窗口 webContents（进度/结果事件投递目标） */
let activeSender: WebContents | null = null

/** 探测全部数据源可用性；未注册的读取器（后续里程碑适配）统一置为不可用 */
async function detectSources(): Promise<ScanDetection[]> {
  const results: ScanDetection[] = []
  for (const source of AGENT_SOURCES) {
    // 单源探测异常不得中断整体（否则一个坏源会让整面板空白 → 表现为「识别不到某些平台」）
    try {
      const loadResult = await loadReader(source)
      // 未注册的读取器：返回 not_implemented
      if (loadResult === undefined) {
        results.push({ source, available: false, unavailableReason: 'not_implemented' })
        continue
      }
      // 注册器返回 unavailableReason 说明该源已注册但不可用
      if ('unavailableReason' in loadResult) {
        results.push({ source, available: false, unavailableReason: loadResult.unavailableReason })
        continue
      }
      const reader = loadResult as { isAvailable: () => Promise<{ available: boolean; detail?: string; unavailableReason?: UnavailableReason }>; listSessions: () => Promise<unknown[]> }
      const availability = await reader.isAvailable()
      let sessionCount: number | undefined
      if (availability.available) {
        if (source === 'opencode') {
          // opencode 用专用 COUNT 查询（比全量 list 更省）
          sessionCount = await countOpencodeSessions()
        } else {
          // 其余源：listSessions 即会话清单（copilot 单表查询 / claude-code 目录窥探，均可承受）
          sessionCount = (await reader.listSessions()).length
        }
      }
      results.push({
        source,
        available: availability.available,
        ...(availability.detail !== undefined ? { detail: availability.detail } : {}),
        ...(availability.unavailableReason !== undefined ? { unavailableReason: availability.unavailableReason } : {}),
        ...(sessionCount !== undefined ? { sessionCount } : {})
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`探测数据源失败(${source}): ${message}`)
      results.push({ source, available: false, unavailableReason: 'detect_error', detail: message })
    }
  }
  return results
}

/** opencode 源库会话数（cheap COUNT，仅用于探测摘要；失败静默返回 undefined） */
async function countOpencodeSessions(): Promise<number | undefined> {
  try {
    const ro = await openRo(resolveDbPath())
    try {
      const { hasTable } = await import('./readers/opencode/schema-detect')
      if (!hasTable(ro.db, 'session')) return undefined
      const row = ro.db
        .prepare('SELECT COUNT(*) AS c FROM session WHERE time_archived IS NULL')
        .get() as { c: number }
      return row.c
    } finally {
      ro.close()
    }
  } catch {
    return undefined
  }
}

/** 由新入库 extId 回查 sessions，构造结果网格卡片（按 updatedAt 倒序，最多 12 张） */
function buildResultCards(source: AgentSource, newExtIds: string[], limit = 12): ScanDoneCard[] {
  if (newExtIds.length === 0) return []
  const db = getDb()
  const picked: Array<ScanDoneCard & { updatedAt: number }> = []
  // IN 子句按 500 分块，规避 SQLite 绑定变量上限
  for (let i = 0; i < newExtIds.length; i += 500) {
    const chunk = newExtIds.slice(i, i + 500)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT id, ext_id AS extId, title, msg_count AS msgCount, source, updated_at AS updatedAt
         FROM sessions WHERE source = ? AND ext_id IN (${placeholders})`
      )
      .all(source, ...chunk) as Array<{
      id: string
      extId: string
      title: string | null
      msgCount: number
      source: string
      updatedAt: number | null
    }>
    for (const row of rows) {
      picked.push({
        id: row.id,
        title: row.title ?? '',
        source: row.source as AgentSource,
        extId: row.extId,
        msgCount: row.msgCount,
        updatedAt: row.updatedAt ?? 0
      })
    }
  }
  picked.sort((a, b) => b.updatedAt - a.updatedAt)
  return picked.slice(0, limit).map(({ updatedAt: _updatedAt, ...card }) => card)
}

/**
 * 启动读取：spawn worker（scanner.worker 作为独立 rollup input 打包为
 * out/main/workers/scanner.worker.js；ingest 全程在 worker 线程执行）。
 * 返回 void —— 实际进度/结果经 onScan* 事件推送；同刻有任务则拒绝。
 */
function startScan(event: IpcMainInvokeEvent, request: ScannerRequest): void {
  if (isIngestRunning()) {
    throw new Error('已有读取任务进行中')
  }
  const sender = event.sender
  activeSender = sender
  void runIngest({
    source: request.source,
    // 主进程解析 userData 路径后显式下发（worker 内拿不到 electron.app）
    dbPath: getDefaultDbPath(),
    onProgress: (progress) => sender.send(DATA_IPC.scanProgress, progress)
  }).then((payload) => {
    activeSender = null
    if (payload.ok) {
      const done: ScanDonePayload = {
        source: request.source,
        report: payload.report,
        newExtIds: payload.newExtIds,
        cards: buildResultCards(request.source, payload.newExtIds)
      }
      sender.send(DATA_IPC.scanResult, done)
      // M7：手动读取完成后按设置自动备份索引库快照
      maybeAutoBackup(getDaos())
    } else if (payload.error !== 'cancelled') {
      // 用户取消已由 cancelScan 直接发送 scanError('cancelled')，此处忽略
      sender.send(DATA_IPC.scanError, { error: payload.error })
    }
  })
}

/** 取消读取：terminate worker 并通知 renderer（scanError('cancelled')） */
function cancelScan(): void {
  const sender = activeSender
  activeSender = null
  if (cancelActiveIngest() && sender !== null) {
    sender.send(DATA_IPC.scanError, { error: 'cancelled' })
  }
}

/* ============================================================
   M7 · 垃圾箱 / 设置 / 导出 / 备份
   ============================================================ */

/** 垃圾箱行投影：purgeAt = deletedAt + 24h */
function toTrashItem(row: SessionRow): TrashItem {
  const deletedAt = row.deletedAt ?? Date.now()
  return {
    id: row.id,
    title: row.title ?? '',
    source: row.source as AgentSource,
    directory: row.directory,
    msgCount: row.msgCount,
    deletedAt,
    purgeAt: deletedAt + DAY_MS
  }
}

function listTrash(): TrashItem[] {
  return getDaos()
    .trash.list()
    .map(toTrashItem)
}

function restoreTrash(ids: readonly string[]): { count: number } {
  return { count: getDaos().trash.restoreSessions(ids) }
}

function purgeTrash(ids: readonly string[]): { count: number } {
  return { count: getDaos().trash.purgeByIds(ids) }
}

function emptyTrash(): { count: number } {
  // purgeDeleted(0)：cutoff = now，删除全部已软删除会话
  return { count: getDaos().trash.purgeDeleted(0) }
}

/** 批量导出：toBackupDir=true 免对话框直写备份目录；否则弹目录选择，用户取消返回 null */
async function exportConversationsHandler(
  req: ExportConversationRequest
): Promise<ExportResult | null> {
  assertIds(req.ids)
  let outDir: string
  if (req.toBackupDir === true) {
    outDir = resolveBackupDir(getDaos().settings)
  } else {
    const picked = dialog.showOpenDialogSync({
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked === undefined || picked.length === 0) return null
    outDir = picked[0]
  }
  return exportConversationsToDir(getDb(), req.ids, req.format, outDir)
}

/** 选择备份目录（系统对话框） */
function pickBackupDir(): string | null {
  const picked = dialog.showOpenDialogSync({
    properties: ['openDirectory', 'createDirectory']
  })
  if (picked === undefined || picked.length === 0) return null
  return picked[0]
}

/** 立即备份索引库快照到配置的备份目录（读取进行中拒绝——防撕裂快照） */
function backupRunHandler(): BackupResult {
  if (isIngestRunning()) throw new Error('读取进行中，请稍后再备份')
  return backupDbSnapshot(getDaos().settings)
}

/** 读取 JSON 设置；autoBackup.dir 未设置时回落到默认备份目录 */
function getSettingHandler(key: string): unknown {
  const value = getDaos().settings.get(key)
  if (value === undefined && key === 'autoBackup.dir') return defaultBackupDir()
  return value
}

/** 应用版本号：npm 运行环境读 npm_package_version，打包后读 app.getVersion() */
function appVersionHandler(): string {
  return process.env['npm_package_version'] ?? app.getVersion()
}

/* ============================================================
   IPC 入参防御（渲染层不可信：防失控数组/越界分页/任意键写入）
   ============================================================ */

const MAX_IDS = 10_000
const MAX_LIMIT = 1_000
const MAX_OFFSET = 10_000_000

/**
 * 已知设置键白名单 —— renderer 侧 setSetting 仅允许写这些键（其余键一律拒绝，防越权写入）。
 * 新增设置项时必须同步登记，否则写入会静默失败（渲染层 catch 吞掉错误）。
 * 当前消费方：SettingsPage（autoBackup.* / autoRead.*）、OnboardingPage（onboarding.completed）。
 */
const SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'autoBackup.enabled',
  'autoBackup.dir',
  'autoRead.enabled',
  'autoRead.intervalHours',
  'autoRead.notify',
  'autoRead.sources',
  'onboarding.completed'
])

function assertIds(ids: readonly unknown[]): asserts ids is string[] {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_IDS ||
    !ids.every((v) => typeof v === 'string')
  ) {
    throw new Error(`非法的会话 ID 列表（上限 ${MAX_IDS} 条）`)
  }
}

/** 注册全部数据层 IPC（应用启动时调用一次） */
export function registerDataIpc(): void {
  ipcMain.handle(DATA_IPC.conversationsList, (_e, query: ConversationListQuery) =>
    listConversations(query)
  )
  ipcMain.handle(DATA_IPC.conversationsGet, (_e, id: string) => getConversation(id))
  ipcMain.handle(DATA_IPC.conversationsSources, () => listConversationSources())
  ipcMain.handle(DATA_IPC.conversationsSetStarred, (_e, id: string, starred: boolean) =>
    setStarred(id, starred)
  )
  ipcMain.handle(
    DATA_IPC.conversationsSoftDelete,
    (_e, ids: string[]) => {
      assertIds(ids)
      return softDelete(ids)
    }
  )
  ipcMain.handle(DATA_IPC.groupsList, () => listGroups())
  ipcMain.handle(DATA_IPC.groupsCreate, (_e, name: string) => createGroup(name))
  ipcMain.handle(DATA_IPC.groupsRename, (_e, id: string, name: string) => renameGroup(id, name))
  ipcMain.handle(DATA_IPC.groupsRemove, (_e, id: string) => removeGroup(id))
  ipcMain.handle(DATA_IPC.groupsAssign, (_e, sessionIds: string[], groupId: string | null) => {
    assertIds(sessionIds)
    return assignGroup(sessionIds, groupId)
  })
  ipcMain.handle(DATA_IPC.groupsMembers, (_e, groupId: string) =>
    listConversations({ groupId, limit: MAX_IDS }).items
  )

  /* ---- M6 · AI Agent 读取 ---- */
  ipcMain.handle(DATA_IPC.scanDetect, () => detectSources())
  ipcMain.handle(DATA_IPC.scanStart, (event, request: ScannerRequest) => startScan(event, request))
  ipcMain.handle(DATA_IPC.scanCancel, () => cancelScan())

  /* ---- M7 · 垃圾箱 ---- */
  ipcMain.handle(DATA_IPC.trashList, () => listTrash())
  ipcMain.handle(DATA_IPC.trashRestore, (_e, ids: string[]) => {
    assertIds(ids)
    return restoreTrash(ids)
  })
  ipcMain.handle(DATA_IPC.trashPurge, (_e, ids: string[]) => {
    assertIds(ids)
    return purgeTrash(ids)
  })
  ipcMain.handle(DATA_IPC.trashEmpty, () => emptyTrash())

  /* ---- M7 · 设置 ---- */
  ipcMain.handle(DATA_IPC.settingsGet, (_e, key: string) => getSettingHandler(key))
  ipcMain.handle(DATA_IPC.settingsSet, (_e, key: string, value: unknown) => {
    if (!SETTINGS_KEYS.has(key)) throw new Error(`未知的设置项: ${key}`)
    getDaos().settings.set(key, value)
    // 自动读取相关设置变更即时生效（重排定时器）
    if (key.startsWith('autoRead')) applySchedulerSettings()
  })

  /* ---- M7 · 导出 / 备份 / 系统 ---- */
  ipcMain.handle(DATA_IPC.exportConversations, (_e, req: ExportConversationRequest) =>
    exportConversationsHandler(req)
  )
  ipcMain.handle(DATA_IPC.backupDirPick, () => pickBackupDir())
  ipcMain.handle(DATA_IPC.backupRun, () => backupRunHandler())
  ipcMain.handle(DATA_IPC.openInFolder, (_e, path: string) => {
    if (typeof path !== 'string' || path.length === 0 || !existsSync(path)) {
      throw new Error('文件不存在或已被移动')
    }
    shell.showItemInFolder(path)
  })
  ipcMain.handle(DATA_IPC.appVersion, () => appVersionHandler())
}
