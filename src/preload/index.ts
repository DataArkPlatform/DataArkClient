import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type WindowApi } from '../shared/ipc-contract'
import {
  DATA_IPC,
  type DataApi,
  type ExportConversationRequest,
  type ScanDonePayload,
  type ScanProgress
} from '../shared/data-contract'

/** 订阅 main → renderer 推送事件，返回取消订阅函数 */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const dataApi: DataApi = {
  listConversations: (query) => ipcRenderer.invoke(DATA_IPC.conversationsList, query),
  listConversationSources: () => ipcRenderer.invoke(DATA_IPC.conversationsSources),
  getConversation: (id) => ipcRenderer.invoke(DATA_IPC.conversationsGet, id),
  setStarred: (id, starred) => ipcRenderer.invoke(DATA_IPC.conversationsSetStarred, id, starred),
  softDelete: (ids) => ipcRenderer.invoke(DATA_IPC.conversationsSoftDelete, ids),
  listGroups: () => ipcRenderer.invoke(DATA_IPC.groupsList),
  createGroup: (name) => ipcRenderer.invoke(DATA_IPC.groupsCreate, name),
  renameGroup: (id, name) => ipcRenderer.invoke(DATA_IPC.groupsRename, id, name),
  removeGroup: (id) => ipcRenderer.invoke(DATA_IPC.groupsRemove, id),
  assignGroup: (sessionIds, groupId) =>
    ipcRenderer.invoke(DATA_IPC.groupsAssign, sessionIds, groupId),
  listGroupMembers: (groupId) => ipcRenderer.invoke(DATA_IPC.groupsMembers, groupId),

  /* ---- M6 · AI Agent 读取 ---- */
  detectSources: () => ipcRenderer.invoke(DATA_IPC.scanDetect),
  startScan: (source) => ipcRenderer.invoke(DATA_IPC.scanStart, { cmd: 'ingest', source }),
  cancelScan: () => ipcRenderer.invoke(DATA_IPC.scanCancel),
  onScanProgress: (cb) => subscribe<ScanProgress>(DATA_IPC.scanProgress, cb),
  onScanResult: (cb) => subscribe<ScanDonePayload>(DATA_IPC.scanResult, cb),
  onScanError: (cb) => subscribe<{ error: string }>(DATA_IPC.scanError, cb),

  /* ---- M7 · 垃圾箱 ---- */
  listTrash: () => ipcRenderer.invoke(DATA_IPC.trashList),
  restoreTrash: (ids) => ipcRenderer.invoke(DATA_IPC.trashRestore, ids),
  purgeTrash: (ids) => ipcRenderer.invoke(DATA_IPC.trashPurge, ids),
  emptyTrash: () => ipcRenderer.invoke(DATA_IPC.trashEmpty),

  /* ---- M7 · 设置 ---- */
  getSetting: (key) => ipcRenderer.invoke(DATA_IPC.settingsGet, key),
  setSetting: (key, value) => ipcRenderer.invoke(DATA_IPC.settingsSet, key, value),

  /* ---- M7 · 导出 / 备份 / 系统 ---- */
  exportConversations: (req: ExportConversationRequest) =>
    ipcRenderer.invoke(DATA_IPC.exportConversations, req),
  openInFolder: (path) => ipcRenderer.invoke(DATA_IPC.openInFolder, path),
  pickBackupDir: () => ipcRenderer.invoke(DATA_IPC.backupDirPick),
  runBackup: () => ipcRenderer.invoke(DATA_IPC.backupRun),
  appVersion: () => ipcRenderer.invoke(DATA_IPC.appVersion)
}

const api: WindowApi = {
  minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
  isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
  onMaximizedChange: (cb) => subscribe<boolean>(IPC.windowMaximizedChanged, cb),
  close: () => ipcRenderer.invoke(IPC.windowClose),
  ping: () => ipcRenderer.invoke(IPC.ping),
  data: dataApi
}

contextBridge.exposeInMainWorld('api', api)
