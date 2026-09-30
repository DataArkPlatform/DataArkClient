/**
 * 统一会话数据模型 —— 所有 Agent 数据源归一化到此模型
 *
 * 这是 main / preload / renderer 三端共享的唯一事实源：
 * - 适配器输出经 zod 校验后变成这里定义的 Message / Session
 * - renderer 只消费这里的类型，永远不感知各 Agent 的私有格式
 *
 * 安全注意：这里的 schema 用于防御性校验外部数据源（只读），
 * 不代表数据源侧的写入结构。外部数据源永不写入。
 */
import { z } from 'zod'
import { AGENT_SOURCES } from './agents'

/** 支持的 Agent 数据源 —— 唯一定义见 shared/agents.ts（统一配置源） */
export { AGENT_SOURCES }

export const AgentSourceSchema = z.enum(AGENT_SOURCES)
export type AgentSource = z.infer<typeof AgentSourceSchema>

/** 消息角色 */
export const RoleSchema = z.enum(['user', 'assistant', 'system'])
export type Role = z.infer<typeof RoleSchema>

/** 会话 —— 幂等去重键为 (source, extId) */
export const SessionSchema = z.object({
  /** 内部 UUID（数据方舟自己的 id，与源系统无关） */
  id: z.string(),
  source: AgentSourceSchema,
  /** 源系统 id（ses_xxx / uuid...），与 source 组成幂等键 */
  extId: z.string(),
  title: z.string().optional(),
  /** 源系统项目/工作区 id（如 OpenCode project_id） */
  projectId: z.string().optional(),
  directory: z.string().optional(),
  /** 父会话 extId（子 Agent 会话层级） */
  parentExtId: z.string().optional(),
  /** 毫秒时间戳 */
  startedAt: z.number(),
  updatedAt: z.number(),
  msgCount: z.number(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  cost: z.number().optional()
})
export type Session = z.infer<typeof SessionSchema>

/** 内容块 —— 8 类判别联合 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    tool: z.string(),
    callId: z.string(),
    /** 工具调用状态（JSON 字符串） */
    state: z.string()
  }),
  z.object({
    type: z.literal('tool_result'),
    callId: z.string(),
    output: z.string()
  }),
  z.object({
    type: z.literal('patch'),
    hash: z.string().optional(),
    files: z.array(z.string())
  }),
  z.object({
    type: z.literal('file_ref'),
    mime: z.string().optional(),
    filename: z.string()
  }),
  z.object({
    type: z.literal('step_marker'),
    phase: z.enum(['start', 'finish'])
  }),
  z.object({
    type: z.literal('compaction'),
    summary: z.string().optional()
  })
])
export type ContentBlock = z.infer<typeof ContentBlockSchema>

/** 统一消息 */
export const MessageSchema = z.object({
  sessionId: z.string(),
  /** 会话内序号，从 0 递增 */
  seq: z.number(),
  role: RoleSchema,
  agentName: z.string().optional(),
  modelName: z.string().optional(),
  provider: z.string().optional(),
  /** 毫秒时间戳 */
  sentAt: z.number(),
  finishReason: z.string().optional(),
  blocks: z.array(ContentBlockSchema)
})
export type Message = z.infer<typeof MessageSchema>

/**
 * 源会话引用 —— 适配器 listSessions() 的产物，仅用于增量 diff 与流式读取。
 * source + extId 是幂等去重键；updatedAt 用于 read_state 高水位比较。
 *
 * 注：directory / parentExtId / startedAt 为可选补充字段，
 * 由适配器在拥有时顺手携带（如 OpenCode 的 session 表字段），
 * 会被 ingest 落入 sessions 表；缺失时为 undefined。
 */
export const RawSessionRefSchema = z.object({
  source: AgentSourceSchema,
  extId: z.string(),
  /** 毫秒时间戳，与 read_state.high_water 比较决定是否重读 */
  updatedAt: z.number(),
  titleHint: z.string().optional(),
  /** 源数据体积提示（如 JSONL 文件字节数），用于进度展示 */
  sizeHint: z.number().optional(),
  directory: z.string().optional(),
  parentExtId: z.string().optional(),
  startedAt: z.number().optional()
})
export type RawSessionRef = z.infer<typeof RawSessionRefSchema>

/**
 * 原始消息（归一化前宽松形状）—— 适配器 readSession() 流式产出。
 * 允许 sentAt 为字符串（ISO / 数字字符串），normalize 阶段统一转毫秒。
 * tokensIn / tokensOut / cost 供 ingest 汇总到会话级统计。
 */
export const RawMessageSchema = z.object({
  sessionId: z.string().optional(),
  seq: z.number().optional(),
  role: RoleSchema,
  agentName: z.string().optional(),
  modelName: z.string().optional(),
  provider: z.string().optional(),
  sentAt: z.union([z.number(), z.string()]).optional(),
  finishReason: z.string().optional(),
  /** 宽松块列表：未知形状的块会被 normalize 降级而非整条丢弃 */
  blocks: z.array(z.unknown()).default([]),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  cost: z.number().optional()
})
export type RawMessage = z.infer<typeof RawMessageSchema>

/** 时间戳归一化：number(ms) 或可解析的字符串(ISO/数字) → ms；无法解析返回 undefined */
export function coerceTimestamp(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) return asNumber
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 消息的 FTS 索引文本：把各内容块拼成一段可检索的纯文本 */
/** 单块进 FTS 的文本上限：巨型工具输出（100KB+）的尾部对检索价值趋零，
 * 却会让 trigram 索引写入量爆炸（实测占首扫写库耗时大头）。超出部分不参与全文检索。 */
const MAX_BLOCK_SEARCH_CHARS = 4096

export function blockSearchText(blocks: ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        parts.push(block.text)
        break
      case 'tool_call':
        parts.push(block.tool, block.state.slice(0, MAX_BLOCK_SEARCH_CHARS))
        break
      case 'tool_result':
        parts.push(block.output.slice(0, MAX_BLOCK_SEARCH_CHARS))
        break
      case 'patch':
        parts.push(...block.files)
        break
      case 'file_ref':
        parts.push(block.filename)
        break
      case 'step_marker':
        break
      case 'compaction':
        if (block.summary !== undefined) parts.push(block.summary)
        break
    }
  }
  return parts.join('\n')
}
