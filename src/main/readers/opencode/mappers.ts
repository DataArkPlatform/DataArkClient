/**
 * OpenCode part.data → 统一 ContentBlock 映射（8 类，见调研报告映射表）
 *
 * 映射表（实测 part.data.type）：
 *   text        → { type:'text', text }
 *   reasoning   → { type:'reasoning', text }
 *   tool        → { type:'tool_call', tool, callId, state(status/output) }
 *   patch       → { type:'patch', hash?, files[] }
 *   file        → { type:'file_ref', mime?, filename }
 *   step-start  → { type:'step_marker', phase:'start' }
 *   step-finish → { type:'step_marker', phase:'finish' }
 *   compaction  → { type:'compaction', summary? }
 * 其余类型返回 null（由调用方丢弃）
 */
import type { ContentBlock } from '../../../shared/unified-model'

/** part.data.type 已知 8 类（mapPartToBlock 的判别分支全集） */
export const KNOWN_PART_TYPES = new Set([
  'text',
  'reasoning',
  'tool',
  'patch',
  'file',
  'step-start',
  'step-finish',
  'compaction'
])

/** 提取 part.data.type；缺失/非字符串时归一为 '<missing>'（供统计与对账） */
export function partTypeOf(data: Record<string, unknown>): string {
  return typeof data['type'] === 'string' ? (data['type'] as string) : '<missing>'
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

export function mapPartToBlock(data: Record<string, unknown>): ContentBlock | null {
  const type = typeof data['type'] === 'string' ? (data['type'] as string) : ''
  switch (type) {
    case 'text':
      return { type: 'text', text: stringOf(data['text']) }
    case 'reasoning':
      return { type: 'reasoning', text: stringOf(data['text']) }
    case 'tool': {
      const state = data['state']
      const stateText = state === undefined ? '' : typeof state === 'string' ? state : JSON.stringify(state)
      return {
        type: 'tool_call',
        tool: stringOf(data['tool']),
        callId: stringOf(data['callID'] ?? data['callId']),
        state: stateText
      }
    }
    case 'patch': {
      const files = Array.isArray(data['files']) ? data['files'].map(String) : []
      const hash = typeof data['hash'] === 'string' ? data['hash'] : undefined
      return { type: 'patch', ...(hash !== undefined ? { hash } : {}), files }
    }
    case 'file': {
      const mime = typeof data['mime'] === 'string' ? data['mime'] : undefined
      return { type: 'file_ref', ...(mime !== undefined ? { mime } : {}), filename: stringOf(data['filename'] ?? data['name']) }
    }
    case 'step-start':
      return { type: 'step_marker', phase: 'start' }
    case 'step-finish':
      return { type: 'step_marker', phase: 'finish' }
    case 'compaction': {
      const summary = typeof data['summary'] === 'string' ? data['summary'] : undefined
      return { type: 'compaction', ...(summary !== undefined ? { summary } : {}) }
    }
    default:
      return null
  }
}
