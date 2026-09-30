/**
 * ReaderAdapter —— 新增 Agent 只需实现此接口
 * 扩展点约定：新 Agent = src/main/readers/<agent>/ 目录 + registry 注册
 */
import type { AgentSource, RawMessage, RawSessionRef } from '../../shared/unified-model'
import type { UnavailableReason } from '../../shared/data-contract'

export interface ReaderAvailability {
  available: boolean
  /** 不可用原因 / 可用时的数据路径说明 */
  detail?: string
  /** 不可用原因分类（available=false 时有值） */
  unavailableReason?: UnavailableReason
}

export interface ReaderAdapter {
  readonly source: AgentSource
  /** 探测安装/数据目录（只读，不写任何源文件） */
  isAvailable(): Promise<ReaderAvailability>
  /** 列会话引用（含 updatedAt 用于增量 diff） */
  listSessions(): Promise<RawSessionRef[]>
  /** 流式读取单个会话，防大会话爆内存 */
  readSession(ref: RawSessionRef): AsyncIterable<RawMessage>
}
