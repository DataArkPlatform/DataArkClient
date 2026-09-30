/**
 * AI Agent 读取页共享类型 —— 三态向导的状态与进度日志。
 */
import type { AgentSource } from '../../../../shared/unified-model'
import type { ScanDetection } from '../../../../shared/data-contract'

/** 向导三态：待读取 → 读取中 → 读取完成 */
export type ScanPhase = 'idle' | 'running' | 'done'

/** 单数据源日志行状态（AI Agent-2 状态点三态） */
export type SourceLogStatus = 'pending' | 'active' | 'done'

/** 单数据源读取日志（每平台一行） */
export interface SourceLog {
  source: AgentSource
  status: SourceLogStatus
  /** 已处理会话数（reading 阶段实时 / done 阶段最终值） */
  count: number
  /** 本次读取总会话数 */
  total: number
  /** 该数据源读取耗时（ms，done 后有意义） */
  elapsedMs: number
}

/** 探测阶段的结果摘要（供面板消费） */
export interface DetectionSummary {
  detections: ScanDetection[]
  /** 可用数据源数量 */
  sourceCount: number
  /** 可用数据源会话总数 */
  totalSessions: number
}

/** 面板公共 props */
export interface ScanPanelProps {
  summary: DetectionSummary
  logs: SourceLog[]
  /** 已完成平台数 */
  doneSources: number
  /** 待读取平台总数（= 可用数据源数） */
  totalSources: number
  /** 进度条百分比 0-100 */
  progressPct: number
  /** 已读取会话数 */
  processedCount: number
  /** 读取耗时（秒） */
  elapsedSec: number
  /** 首帧骨架是否已替换为真实日志 */
  logsRevealed: boolean
  onStart: () => void
  onCancel: () => void
  onViewAll: () => void
  onRescan: () => void
}
