/**
 * IPC 通道契约 —— main / preload / renderer 三端共享的唯一事实源
 */
import type { DataApi } from './data-contract'

export const IPC = {
  /** 窗口控制 */
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  /** 查询当前最大化状态（renderer 挂载时取初值） */
  windowIsMaximized: 'window:is-maximized',
  /** 最大化状态变更推送（main → renderer，boolean） */
  windowMaximizedChanged: 'window:maximized-changed',
  windowClose: 'window:close',
  /** 系统探活 */
  ping: 'system:ping'
} as const

/** preload 暴露给 renderer 的 API 形状（window.api.*） */
export interface WindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  /** 订阅最大化状态变更，返回取消订阅函数 */
  onMaximizedChange(cb: (maximized: boolean) => void): () => void
  close(): Promise<void>
  ping(): Promise<string>
  /** 数据层 API（window.api.data.*），通道契约见 data-contract.ts */
  data: DataApi
}
