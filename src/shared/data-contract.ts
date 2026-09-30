/**
 * 数据层 IPC 通道契约 —— 与 window 相关 IPC（见 ipc-contract.ts）分离。
 *
 * 本文件只声明类型与通道名，不包含任何 ipcMain 注册。
 * ipcMain.handle 接线见 src/main/ipc.ts；preload 暴露见 src/preload/index.ts。
 */
import type { AgentSource, ContentBlock } from './unified-model'

/** 数据层 IPC 通道名（renderer ⇄ main，经 preload 白名单暴露） */
export const DATA_IPC = {
  /** 数据源探测（renderer → main）：payload 无 → ScanDetection[] */
  scanDetect: 'data:scan:detect',
  /** 发起扫描（renderer → main）：payload = ScannerRequest */
  scanStart: 'data:scan:start',
  /** 取消扫描（renderer → main）：payload 无；worker 被 terminate，renderer 侧收到 scanError('cancelled') */
  scanCancel: 'data:scan:cancel',
  /** 扫描进度（main → renderer）：payload = ScanProgress */
  scanProgress: 'data:scan:progress',
  /** 扫描结果（main → renderer）：payload = ScanDonePayload */
  scanResult: 'data:scan:result',
  /** 扫描失败/取消（main → renderer）：payload = { error: string }；error === 'cancelled' 表示用户取消 */
  scanError: 'data:scan:error',

  /* ---- M4 · 会话管理 ---- */
  /** 会话列表（renderer → main）：payload = ConversationListQuery */
  conversationsList: 'data:conversations:list',
  /** 会话详情（renderer → main）：payload = { id } */
  conversationsGet: 'data:conversations:get',
  /** 收藏/取消收藏（renderer → main）：payload = { id, starred } */
  conversationsSetStarred: 'data:conversations:setStarred',
  /** 软删除（移入垃圾箱）（renderer → main）：payload = { ids: string[] } */
  conversationsSoftDelete: 'data:conversations:softDelete',
  /** 各数据源会话计数（renderer → main）：payload 无 → ConversationSourceCount[] */
  conversationsSources: 'data:conversations:sources',

  /* ---- M4 · 分组 ---- */
  groupsList: 'data:groups:list',
  groupsCreate: 'data:groups:create',
  groupsRename: 'data:groups:rename',
  groupsRemove: 'data:groups:remove',
  /** 会话移入/移出分组（groupId = null 表示移出） */
  groupsAssign: 'data:groups:assign',

  /* ---- M7 · 垃圾箱 ---- */
  /** 垃圾箱列表（renderer → main）：payload 无 → TrashItem[] */
  trashList: 'data:trash:list',
  /** 恢复软删除会话（renderer → main）：payload = { ids: string[] } → { count } */
  trashRestore: 'data:trash:restore',
  /** 彻底删除指定会话（renderer → main）：payload = { ids: string[] } → { count } */
  trashPurge: 'data:trash:purge',
  /** 清空回收站（renderer → main）：payload 无 → { count } */
  trashEmpty: 'data:trash:empty',

  /* ---- M7 · 设置 ---- */
  /** 读取 JSON 设置（renderer → main）：payload = { key } → unknown（JSON 解析值） */
  settingsGet: 'data:settings:get',
  /** 写入 JSON 设置（renderer → main）：payload = { key, value } → void */
  settingsSet: 'data:settings:set',

  /* ---- M7 · 导出 / 备份 / 系统信息 ---- */
  /** 批量导出会话到目录（renderer → main）：payload = ExportConversationRequest → ExportResult | null（用户取消） */
  exportConversations: 'data:export:conversations',
  /** 选择备份目录（renderer → main）：payload 无 → string | null */
  backupDirPick: 'data:backup:dirPick',
  /** 立即备份索引库快照（renderer → main）：payload 无 → BackupResult */
  backupRun: 'data:backup:run',
  /** 应用版本号：renderer → main，payload → string */
  appVersion: 'data:system:appVersion',
  /** 在系统文件管理器中定位文件：payload = string（完整文件路径） */
  openInFolder: 'data:system:open-in-folder',
  /** 分组成员列表：payload = { groupId: string } → ConversationListItem[] */
  groupsMembers: 'data:groups:members'
} as const

/** 时间范围筛选 */
export type ConversationTimeRange = 'all' | 'today' | '7d' | '30d'

/** conversations:list 请求参数 */
export interface ConversationListQuery {
  /** 全文检索关键词（标题 LIKE + 内容 FTS5），空串/缺省返回全量 */
  query?: string
  /** 按 updatedAt 时间范围过滤 */
  timeRange?: ConversationTimeRange
  /** 只看收藏 */
  starredOnly?: boolean
  /** 只看某分组；null = 只看未分组；缺省 = 不过滤 */
  groupId?: string | null
  /** 只看指定数据源；缺省 = 不过滤 */
  source?: AgentSource
  offset?: number
  limit?: number
}

/** 会话列表行（列表页最小投影） */
export interface ConversationListItem {
  id: string
  title: string
  source: AgentSource
  directory: string | null
  startedAt: number | null
  updatedAt: number | null
  msgCount: number
  tokensIn: number | null
  tokensOut: number | null
  cost: number | null
  starred: boolean
  groupId: string | null
  parentExtId?: string | null
}

export interface ConversationListResult {
  total: number
  items: ConversationListItem[]
}

/** 数据源会话计数（会话管理「按 Agent 筛选」胶囊） */
export interface ConversationSourceCount {
  source: AgentSource
  count: number
}

/** 会话内消息（详情页最小投影，M5 扩展） */
export interface ConversationMessage {
  id: number
  role: string
  sentAt: number | null
  agentName: string | null
  modelName: string | null
  blocks: ContentBlock[]
}

export interface ConversationDetail extends ConversationListItem {
  messages: ConversationMessage[]
}

/** 分组摘要（侧栏分组树） */
export interface GroupSummary {
  id: string
  name: string
  /** 组内未删除会话数 */
  count: number
}

/* ============================================================
   M7 · 垃圾箱 / 设置 / 导出 / 备份
   ============================================================ */

/** 垃圾箱行（24h 保留倒计时投影） */
export interface TrashItem {
  id: string
  title: string
  source: AgentSource
  directory: string | null
  msgCount: number
  /** 软删除时间戳（ms） */
  deletedAt: number
  /** 自动清除时间戳（ms）= deletedAt + 24h */
  purgeAt: number
}

/** 批量导出请求 */
export interface ExportConversationRequest {
  ids: string[]
  format: 'json' | 'markdown'
  /** true = 免对话框，直接写入备份目录（批量「备份」按钮）；缺省弹目录选择（「导出」） */
  toBackupDir?: boolean
}

/** 批量导出结果（写入目标目录后返回） */
export interface ExportResult {
  /** 目标目录（用户在系统对话框中选择 / 备份目录） */
  dir: string
  /** 成功写入的文件数 */
  written: number
  /** 失败/跳过的会话数 */
  failed: number
  /** 首个成功写入文件的完整路径（供「打开文件夹」直达；全失败时缺省） */
  firstFile?: string
}

/** 备份结果（立即备份按钮 / 自动备份触发） */
export interface BackupResult {
  /** 备份 .db 文件完整路径 */
  file: string
  /** .db 文件字节数 */
  size: number
}

/**
 * preload 暴露给 renderer 的数据层 API（window.api.data.*）。
 * 全部为 Promise 式调用；错误经 ipcRenderer.invoke 以 rejection 透出。
 * 订阅类方法（onScan*）返回取消订阅函数。
 */
export interface DataApi {
  listConversations(query: ConversationListQuery): Promise<ConversationListResult>
  /** 各数据源未删除会话计数（供「按 Agent 筛选」渲染胶囊与数量） */
  listConversationSources(): Promise<ConversationSourceCount[]>
  getConversation(id: string): Promise<ConversationDetail | null>
  setStarred(id: string, starred: boolean): Promise<void>
  softDelete(ids: string[]): Promise<{ count: number }>
  listGroups(): Promise<GroupSummary[]>
  createGroup(name: string): Promise<GroupSummary>
  renameGroup(id: string, name: string): Promise<void>
  removeGroup(id: string): Promise<void>
  assignGroup(sessionIds: string[], groupId: string | null): Promise<void>

  /* ---- M7 · 垃圾箱 ---- */
  /** 垃圾箱全量列表（按删除时间倒序） */
  listTrash(): Promise<TrashItem[]>
  /** 恢复软删除会话 */
  restoreTrash(ids: string[]): Promise<{ count: number }>
  /** 彻底删除指定会话（级联删消息 + FTS） */
  purgeTrash(ids: string[]): Promise<{ count: number }>
  /** 清空回收站全部会话 */
  emptyTrash(): Promise<{ count: number }>

  /* ---- M7 · 设置 ---- */
  /** 读取 JSON 设置（不存在返回 undefined） */
  getSetting(key: string): Promise<unknown>
  /** 写入 JSON 设置 */
  setSetting(key: string, value: unknown): Promise<void>

  /* ---- M7 · 导出 / 备份 / 系统 ---- */
  /** 批量导出会话（用户在系统对话框选择目标目录；取消返回 null） */
  exportConversations(req: ExportConversationRequest): Promise<ExportResult | null>
  /** 在系统文件管理器中定位并高亮指定文件 */
  openInFolder(path: string): Promise<void>
  /** 指定分组的成员会话（未删除），按更新时间倒序 */
  listGroupMembers(groupId: string): Promise<ConversationListItem[]>
  /** 选择备份目录（系统对话框）；取消返回 null */
  pickBackupDir(): Promise<string | null>
  /** 立即备份索引库快照到配置的备份目录 */
  runBackup(): Promise<BackupResult>
  /** 应用版本号（package.json / 安装包版本） */
  appVersion(): Promise<string>

  /* ---- M6 · AI Agent 读取 ---- */
  /** 探测全部数据源可用性；仅已注册的读取器有真实结果，其余 available=false */
  detectSources(): Promise<ScanDetection[]>
  /** 发起真实 ingest（worker 线程内执行）；进度/结果经 onScan* 事件推送 */
  startScan(source: AgentSource): Promise<void>
  /** 取消进行中的读取（worker.terminate），renderer 侧收到 scanError('cancelled') */
  cancelScan(): Promise<void>
  /** 订阅进度事件（main → renderer），返回取消订阅函数 */
  onScanProgress(cb: (event: ScanProgress) => void): () => void
  /** 订阅完成事件（main → renderer），返回取消订阅函数 */
  onScanResult(cb: (payload: ScanDonePayload) => void): () => void
  /** 订阅失败/取消事件（main → renderer），返回取消订阅函数 */
  onScanError(cb: (payload: { error: string }) => void): () => void
}

/** 扫描/读取进度事件 */
export interface ScanProgress {
  phase: 'discover' | 'reading' | 'done'
  source: AgentSource
  /** 已处理会话数 */
  current: number
  /** 本次扫描总会话数（discover 完成后才有意义） */
  total: number
  /** 当前处理的会话 extId（reading 阶段） */
  extId?: string
  /** 人类可读说明（如发现 N 个会话） */
  message?: string
  /** 已读数据量（字节，按会话 sizeHint 累计）；有值时为真实数据量进度 */
  weightCurrent?: number
  /** 本次待读数据总量（字节，非跳过会话 sizeHint 之和）；有值时进度条以字节量加权 */
  weightTotal?: number
}

/** 一次 ingest 的汇总报告 */
export interface IngestReport {
  /** 新发现并入库的会话数 */
  scannedNew: number
  /** 高水位之上发生变更、重新入库的会话数 */
  scannedUpdated: number
  /** 高水位未变、直接跳过的会话数 */
  skipped: number
  /** 单会话级别的处理错误（不阻断整体） */
  errors: Array<{ extId: string; message: string }>
}

/** 不可用原因 */
export type UnavailableReason =
  | 'not_implemented'
  | 'no_data'
  | 'access_denied'
  | 'corrupted'
  /** 探测过程中抛出异常（路径/权限/损坏之外的意外错误） */
  | 'detect_error'

/** 数据源探测结果（detect 阶段，AI Agent-1） */
export interface ScanDetection {
  source: AgentSource
  available: boolean
  /** 可用时的数据路径说明 / 不可用原因分类 */
  detail?: string
  /** 不可用原因分类（available=false 时有值） */
  unavailableReason?: UnavailableReason
  /** 源库会话条数（仅已注册且可用数据源有值，cheap COUNT，非全部源） */
  sessionCount?: number
}

/** 结果网格卡片（完成态展示本次新入库会话，AI Agent-3） */
export interface ScanDoneCard {
  /** 内部会话 id（可跳转） */
  id: string
  title: string
  source: AgentSource
  /** 源系统 extId */
  extId: string
  msgCount: number
}

/** 扫描完成事件负载（main → renderer） */
export interface ScanDonePayload {
  source: AgentSource
  report: IngestReport
  /** 本次新入库会话的源 extId（worker 按 read_state 前后差集得出） */
  newExtIds: string[]
  /** 结果网格卡片（按 updatedAt 倒序，最多 12 张） */
  cards: ScanDoneCard[]
}

/** worker 线程收到的任务请求 */
export interface ScannerRequest {
  cmd: 'ingest'
  source: AgentSource
  /** 索引库路径；缺省用主进程默认位置（getDefaultDbPath） */
  dbPath?: string
}

/** worker 线程的最终应答 */
export type ScannerResponse =
  | { ok: true; report: IngestReport; newExtIds: string[] }
  | { ok: false; error: string }

/**
 * worker ⇄ parent 端口消息协议：
 * - worker → parent：若干 ScanProgress 进度事件，最终一条 ScannerResponse（ok:true 或 ok:false）
 * - parent → worker：一条 ScannerRequest
 */
export type ScannerPortMessage =
  | { type: 'progress'; payload: ScanProgress }
  | { type: 'result'; payload: ScannerResponse }
