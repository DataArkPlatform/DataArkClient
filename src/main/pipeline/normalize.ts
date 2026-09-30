/**
 * 归一化 —— 适配器输出的 RawMessage → 统一 Message
 *
 * 原则（架构.md 安全边界）：
 * - 一切外部数据用 zod 防御性校验，未知字段剥离
 * - 时间戳统一为毫秒数字（ISO / 数字字符串自动转换）
 * - 单个坏块降级为 { type:'text', text:'' } 并告警，绝不整条丢弃
 * - 整条消息无法归一化（角色非法 / 时间戳缺失）时返回 null 并告警
 */
import type { ContentBlock, Message, RawMessage, Role } from '../../shared/unified-model'
import { coerceTimestamp, MessageSchema, RawMessageSchema } from '../../shared/unified-model'

export interface NormalizeOptions {
  /** 消息归属的会话内部 id（适配器原始消息可能不携带） */
  sessionId?: string
  /** 告警回调（降级 / 丢弃时的原因） */
  warn?: (message: string) => void
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

/** 宽松块 → 统一 ContentBlock；无法识别/非法时降级为空文本块 */
function mapBlock(raw: unknown, warn: (message: string) => void): ContentBlock {
  if (raw === null || typeof raw !== 'object') {
    warn('块不是对象，已降级为空文本')
    return { type: 'text', text: '' }
  }
  const block = raw as Record<string, unknown>
  const type = typeof block['type'] === 'string' ? (block['type'] as string) : ''

  switch (type) {
    case 'text':
      return { type: 'text', text: textOf(block['text']) }
    case 'reasoning':
      return { type: 'reasoning', text: textOf(block['text']) }
    case 'tool':
    case 'tool_call': {
      const state = block['state'] ?? block['output'] ?? block['status']
      return {
        type: 'tool_call',
        tool: textOf(block['tool'] ?? block['name']),
        callId: textOf(block['callId'] ?? block['callID'] ?? block['call_id']),
        state: typeof state === 'string' ? state : JSON.stringify(state)
      }
    }
    case 'tool_result': {
      return {
        type: 'tool_result',
        callId: textOf(block['callId'] ?? block['callID'] ?? block['call_id']),
        output: textOf(block['output'] ?? block['text'])
      }
    }
    case 'patch': {
      const files = Array.isArray(block['files']) ? block['files'].map(String) : []
      const hash = typeof block['hash'] === 'string' ? block['hash'] : undefined
      return { type: 'patch', ...(hash !== undefined ? { hash } : {}), files }
    }
    case 'file':
    case 'file_ref': {
      const mime = typeof block['mime'] === 'string' ? block['mime'] : undefined
      return { type: 'file_ref', ...(mime !== undefined ? { mime } : {}), filename: textOf(block['filename'] ?? block['name']) }
    }
    case 'step-start':
      return { type: 'step_marker', phase: 'start' }
    case 'step-finish':
      return { type: 'step_marker', phase: 'finish' }
    case 'step_marker': {
      const phase = block['phase'] === 'finish' ? 'finish' : 'start'
      return { type: 'step_marker', phase }
    }
    case 'compaction': {
      const summary = typeof block['summary'] === 'string' ? block['summary'] : undefined
      return { type: 'compaction', ...(summary !== undefined ? { summary } : {}) }
    }
    default: {
      warn(`未知块类型 "${type || '<缺失>'}"，已降级为空文本`)
      return { type: 'text', text: '' }
    }
  }
}

/** RawMessage → Message；无法归一化返回 null（并告警） */
export function normalizeMessage(raw: RawMessage, options: NormalizeOptions = {}): Message | null {
  const warn = options.warn ?? ((): void => {})
  const parsed = RawMessageSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues[0]
    warn(`消息校验失败（${detail.path.join('.') || '<root>'}: ${detail.message}），已丢弃`)
    return null
  }
  const data = parsed.data

  const sentAt = coerceTimestamp(data.sentAt)
  if (sentAt === undefined) {
    warn(`消息缺少有效 sentAt，已丢弃`)
    return null
  }

  const blocks = data.blocks.map((b) => mapBlock(b, warn))
  const result: Message = {
    sessionId: data.sessionId ?? options.sessionId ?? '',
    seq: data.seq ?? 0,
    role: data.role as Role,
    sentAt,
    ...(data.agentName !== undefined ? { agentName: data.agentName } : {}),
    ...(data.modelName !== undefined ? { modelName: data.modelName } : {}),
    ...(data.provider !== undefined ? { provider: data.provider } : {}),
    ...(data.finishReason !== undefined ? { finishReason: data.finishReason } : {}),
    blocks
  }

  const validated = MessageSchema.safeParse(result)
  if (!validated.success) {
    warn('归一化结果未通过 Message 校验，已丢弃')
    return null
  }
  return validated.data
}
