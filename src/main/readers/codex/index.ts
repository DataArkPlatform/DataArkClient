/**
 * Codex CLI 适配器 —— openai/codex 本地会话（rollout JSONL）。
 *
 * 数据位置：<CODEX_HOME|~>/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl
 *   - 亦兼容旧版扁平 sessions/rollout-*.jsonl 与 archived_sessions/
 *   - .jsonl.zst 压缩文件暂不解析（无 zstd 依赖）
 *
 * 行结构（RolloutItemWire）：{ timestamp: RFC3339, type, payload }
 *   type ∈ session_meta | response_item | event_msg | compacted | turn_context | …
 *
 * ★ 展示口径：对齐 Codex 客户端会话框
 *   Codex rollout 有两条平行流：
 *   1) response_item —— 模型的**原始 I/O**（Responses API items）：包含 harness 注入的
 *      developer/system 指令与 <environment_context> / <user_instructions> 等上下文。
 *      这是模型上下文回放用的，**不是**会话内容。
 *   2) event_msg    —— **UI 事件流**，Codex 客户端会话框渲染的就是它：
 *        · 新版：item_started / item_completed（payload.item = TurnItem）
 *        · 旧版：user_message / agent_message / agent_reasoning /
 *                exec_command_begin·end / patch_apply_begin·end /
 *                mcp_tool_call_begin·end / web_search_begin·end / context_compacted
 *   读取前先廉价探测文件是否含 UI 事件：有则**只认 event_msg**（完全对齐客户端）；
 *   没有（更老的 rollout）才回退 response_item，并过滤 harness 注入内容。
 *
 * 容错：字段名同时接受 snake_case / camelCase；TurnItem 与 UserInput 的 tag 同时接受
 *   PascalCase 与 snake_case（不同 Codex 版本序列化大小写不同）。
 *
 * 合并策略：同一轮次内 assistant 侧条目（agent 文本 / reasoning / 工具调用 / 文件变更）
 *   合并为一条消息，遇 user 消息或文件尾冲刷——与客户端「一轮一个回复块」观感一致。
 *   同一 item id 的 item_started → item_completed 整体替换，避免重复。
 *
 * 增量依据：文件 mtime（rollout 无独立 updated 字段）。
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  coerceTimestamp,
  type ContentBlock,
  type RawMessage,
  type RawSessionRef
} from '../../../shared/unified-model'
import type { ReaderAdapter, ReaderAvailability } from '../types'
import { readJsonl } from '../infra/jsonl-stream'

type Rec = Record<string, unknown>

/** 解析 Codex 根目录（CODEX_HOME 覆盖默认；默认 ~/.codex） */
export function resolveCodexHome(): string {
  const env = process.env['CODEX_HOME']
  return env !== undefined && env !== '' ? env : join(homedir(), '.codex')
}

/* ============================================================
   通用取值工具（snake_case / camelCase 双兼容）
   ============================================================ */

function asRec(value: unknown): Rec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Rec)
    : undefined
}

function pickStr(rec: Rec, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

function pickNum(rec: Rec, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

function pickStrArr(rec: Rec, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = rec[k]
    if (Array.isArray(v)) {
      const out: string[] = []
      for (const item of v) if (typeof item === 'string') out.push(item)
      if (out.length > 0) return out
    }
  }
  return []
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v !== undefined && v.trim() !== '') return v
  }
  return undefined
}

/** 任意 content 形态（字符串 / [{text}] / [{type,text}] / UserInput[]）→ 纯文本 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item)
        continue
      }
      const rec = asRec(item)
      if (rec === undefined) continue
      const text = rec['text']
      if (typeof text === 'string') parts.push(text)
    }
    return parts.join('\n')
  }
  const rec = asRec(content)
  if (rec !== undefined && typeof rec['text'] === 'string') return rec['text']
  return ''
}

/** 工具输出（可能是字符串 / IO 数组 / {type,...} 联合）→ 纯文本 */
function outputToText(output: unknown): string {
  const direct = contentToText(output)
  return direct.trim() !== '' ? direct : stringify(output)
}

/** 跨平台取路径末段 */
function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/* ============================================================
   harness 注入内容识别 —— 不属于「会话」，Codex 客户端不展示
   ============================================================ */

const INJECTED_PREFIXES = [
  '<environment_context',
  '<permissions instructions',
  '<user_instructions',
  '<turn_context',
  '<system-reminder',
  '<system_reminder',
  '<hook_prompt',
  '<environment>',
  '<workspace_roots',
  '<ide_context',
  '<editor_context'
]

const INJECTED_ROOTS = new Set([
  'environment_context',
  'user_instructions',
  'turn_context',
  'system-reminder',
  'system_reminder',
  'hook_prompt',
  'environment',
  'ide_context',
  'editor_context',
  'workspace_roots'
])

/** 是否为 harness 注入的上下文/指令（非用户真实输入） */
export function isHarnessInjected(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  const lower = trimmed.toLowerCase()
  for (const prefix of INJECTED_PREFIXES) {
    if (lower.startsWith(prefix)) return true
  }
  const match = /^<([a-z_][\w-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>\s*$/.exec(lower)
  return match !== null && match[1] !== undefined && INJECTED_ROOTS.has(match[1])
}

/** 标题单行化：折叠空白、去 markdown 标题符、限量（防撑破导出 H1） */
export function sanitizeTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').replace(/^[#>\s]+/, '').trim()
  return oneLine.length > 80 ? oneLine.slice(0, 80) : oneLine
}

/* ============================================================
   TurnItem（新版 item_started / item_completed）
   ============================================================ */

function reasoningBlocks(item: Rec): ContentBlock[] {
  const out: ContentBlock[] = []
  const texts = [
    ...pickStrArr(item, 'summary_text', 'summaryText'),
    ...pickStrArr(item, 'raw_content', 'rawContent')
  ]
  for (const text of texts) {
    if (text.trim() !== '') out.push({ type: 'reasoning', text })
  }
  return out
}

function commandExecutionBlocks(item: Rec): ContentBlock[] {
  const callId = pickStr(item, 'id', 'call_id', 'callId') ?? ''
  const command = pickStrArr(item, 'command').join(' ') || stringify(item['command'])
  const blocks: ContentBlock[] = [{ type: 'tool_call', tool: 'shell', callId, state: command }]
  const output =
    firstNonEmpty([
      pickStr(item, 'aggregated_output', 'aggregatedOutput'),
      pickStr(item, 'formatted_output', 'formattedOutput'),
      [pickStr(item, 'stdout'), pickStr(item, 'stderr')]
        .filter((v) => v !== undefined && v !== '')
        .join('\n')
    ]) ?? ''
  const status = pickStr(item, 'status')
  const exitCode = pickNum(item, 'exit_code', 'exitCode')
  const meta = [
    status !== undefined && status !== '' ? `status: ${status}` : '',
    exitCode !== undefined ? `exit: ${exitCode}` : ''
  ]
    .filter((v) => v !== '')
    .join(' · ')
  const body = [output, meta !== '' ? `(${meta})` : ''].filter((v) => v !== '').join('\n\n')
  blocks.push({ type: 'tool_result', callId, output: body })
  return blocks
}

function fileChangeBlocks(item: Rec): ContentBlock[] {
  const files: string[] = []
  const changes = item['changes'] ?? item['files']
  if (Array.isArray(changes)) {
    for (const entry of changes) {
      if (typeof entry === 'string') files.push(entry)
      else {
        const rec = asRec(entry)
        const path = rec !== undefined ? pickStr(rec, 'path', 'filename') : undefined
        if (path !== undefined) files.push(path)
      }
    }
  } else {
    const rec = asRec(changes)
    if (rec !== undefined) files.push(...Object.keys(rec))
  }
  if (files.length > 0) return [{ type: 'patch', files }]
  const status = pickStr(item, 'status')
  return status !== undefined ? [{ type: 'text', text: `文件变更（${status}）` }] : []
}

function mcpToolCallBlocks(item: Rec): ContentBlock[] {
  const callId = pickStr(item, 'id', 'call_id', 'callId') ?? ''
  const server = pickStr(item, 'server', 'server_name', 'serverName') ?? ''
  const tool = pickStr(item, 'tool', 'name') ?? ''
  const name = [server, tool].filter((v) => v !== '').join('.') || 'mcp'
  const blocks: ContentBlock[] = [
    { type: 'tool_call', tool: name, callId, state: stringify(item['arguments']) }
  ]
  const result = asRec(item['result'])
  const body = firstNonEmpty([
    result !== undefined ? contentToText(result['content']) : undefined,
    result !== undefined
      ? stringify(result['structured_content'] ?? result['structuredContent'])
      : undefined,
    pickStr(item, 'error')
  ])
  if (body !== undefined && body.trim() !== '') {
    blocks.push({ type: 'tool_result', callId, output: body })
  }
  return blocks
}

/** TurnItem → 统一块列表（未知类型安全跳过） */
function turnItemToBlocks(item: Rec): ContentBlock[] {
  const tag = pickStr(item, 'type') ?? ''
  switch (tag) {
    case 'UserMessage':
    case 'user_message': {
      const text = contentToText(item['content'] ?? item['message'])
      return text.trim() === '' || isHarnessInjected(text) ? [] : [{ type: 'text', text }]
    }
    case 'AgentMessage':
    case 'agent_message': {
      const text = contentToText(item['content'] ?? item['message'])
      return text.trim() === '' ? [] : [{ type: 'text', text }]
    }
    case 'Reasoning':
    case 'reasoning':
      return reasoningBlocks(item)
    case 'CommandExecution':
    case 'command_execution':
      return commandExecutionBlocks(item)
    case 'FileChange':
    case 'file_change':
      return fileChangeBlocks(item)
    case 'McpToolCall':
    case 'mcp_tool_call':
      return mcpToolCallBlocks(item)
    case 'WebSearch':
    case 'web_search': {
      const query = pickStr(item, 'query') ?? ''
      return [
        { type: 'tool_call', tool: 'web_search', callId: pickStr(item, 'id') ?? '', state: query }
      ]
    }
    case 'Plan':
    case 'plan': {
      const text = pickStr(item, 'text') ?? ''
      return text.trim() === '' ? [] : [{ type: 'text', text }]
    }
    case 'FunctionCallOutput':
    case 'function_call_output': {
      const name = pickStr(item, 'name') ?? ''
      const body = outputToText(item['output'])
      return [
        {
          type: 'tool_result',
          callId: pickStr(item, 'id', 'call_id', 'callId') ?? '',
          output: name !== '' ? `[${name}]\n${body}` : body
        }
      ]
    }
    case 'ContextCompaction':
    case 'context_compaction':
      return [{ type: 'compaction' }]
    case 'ImageView':
    case 'image_view': {
      const path = pickStr(item, 'path') ?? ''
      return [{ type: 'file_ref', filename: baseName(path) || path }]
    }
    case 'DynamicToolCall':
    case 'dynamic_tool_call': {
      const callId = pickStr(item, 'id') ?? ''
      const tool = pickStr(item, 'tool', 'name') ?? 'tool'
      const blocks: ContentBlock[] = [
        { type: 'tool_call', tool, callId, state: stringify(item['arguments']) }
      ]
      const body = firstNonEmpty([
        contentToText(item['content_items'] ?? item['contentItems']),
        pickStr(item, 'error')
      ])
      if (body !== undefined && body.trim() !== '') {
        blocks.push({ type: 'tool_result', callId, output: body })
      }
      return blocks
    }
    case 'CollabAgentToolCall':
    case 'collab_agent_tool_call': {
      const tool = pickStr(item, 'tool') ?? 'agent'
      const prompt = pickStr(item, 'prompt') ?? ''
      return [
        { type: 'tool_call', tool: `agent.${tool}`, callId: pickStr(item, 'id') ?? '', state: prompt }
      ]
    }
    default:
      return []
  }
}

/* ============================================================
   response_item（原始 Responses API items，仅作回退）
   ============================================================ */

function responseItemBlocks(payload: Rec): ContentBlock[] {
  const type = pickStr(payload, 'type') ?? ''
  if (type === 'reasoning') {
    const out: ContentBlock[] = []
    const collect = (arr: unknown): void => {
      if (!Array.isArray(arr)) return
      for (const item of arr) {
        const rec = asRec(item)
        const text = rec !== undefined ? rec['text'] : undefined
        if (typeof text === 'string' && text.trim() !== '') out.push({ type: 'reasoning', text })
      }
    }
    collect(payload['summary'])
    collect(payload['content'])
    return out
  }
  if (type === 'function_call') {
    const name = pickStr(payload, 'name') ?? ''
    if (name === '') return []
    return [
      {
        type: 'tool_call',
        tool: name,
        callId: pickStr(payload, 'call_id', 'callId') ?? '',
        state: stringify(payload['arguments'])
      }
    ]
  }
  if (type === 'function_call_output') {
    return [
      {
        type: 'tool_result',
        callId: pickStr(payload, 'call_id', 'callId') ?? '',
        output: outputToText(payload['output'])
      }
    ]
  }
  if (type === 'local_shell_call') {
    return [
      {
        type: 'tool_call',
        tool: 'shell',
        callId: pickStr(payload, 'call_id', 'callId') ?? '',
        state: stringify(payload['action'])
      }
    ]
  }
  return []
}

/* ============================================================
   旧版 event_msg（legacy EventMsg）
   ============================================================ */

type LegacyAction =
  | { kind: 'user'; text: string }
  | { kind: 'blocks'; key: string | null; blocks: ContentBlock[] }
  | null

/** 旧版事件 → 展示动作；`key` 用于 begin/end 配对（同 key 的块追加到同一槽位） */
function legacyEventAction(payload: Rec): LegacyAction {
  const type = pickStr(payload, 'type') ?? ''
  const callId = pickStr(payload, 'call_id', 'callId') ?? ''
  switch (type) {
    case 'user_message': {
      const text = pickStr(payload, 'message') ?? contentToText(payload['content'])
      return { kind: 'user', text }
    }
    case 'agent_message': {
      const text = pickStr(payload, 'message') ?? contentToText(payload['content'])
      return { kind: 'blocks', key: null, blocks: text.trim() === '' ? [] : [{ type: 'text', text }] }
    }
    case 'agent_reasoning':
    case 'agent_reasoning_raw_content': {
      const text = pickStr(payload, 'text') ?? ''
      return {
        kind: 'blocks',
        key: null,
        blocks: text.trim() === '' ? [] : [{ type: 'reasoning', text }]
      }
    }
    case 'exec_command_begin': {
      const command = pickStrArr(payload, 'command').join(' ') || stringify(payload['command'])
      return {
        kind: 'blocks',
        key: `exec:${callId}`,
        blocks: [{ type: 'tool_call', tool: 'shell', callId, state: command }]
      }
    }
    case 'exec_command_end': {
      const output =
        firstNonEmpty([
          pickStr(payload, 'aggregated_output', 'aggregatedOutput'),
          pickStr(payload, 'formatted_output', 'formattedOutput'),
          [pickStr(payload, 'stdout'), pickStr(payload, 'stderr')]
            .filter((v) => v !== undefined && v !== '')
            .join('\n')
        ]) ?? ''
      const exitCode = pickNum(payload, 'exit_code', 'exitCode')
      const meta = exitCode !== undefined ? `(exit: ${exitCode})` : ''
      const body = [output, meta].filter((v) => v !== '').join('\n\n')
      return {
        kind: 'blocks',
        key: `exec:${callId}`,
        blocks: [{ type: 'tool_result', callId, output: body }]
      }
    }
    case 'patch_apply_begin':
    case 'patch_apply_end': {
      const rec = asRec(payload['changes'])
      const files = rec !== undefined ? Object.keys(rec) : []
      return {
        kind: 'blocks',
        key: `patch:${callId}`,
        blocks: type === 'patch_apply_begin' && files.length > 0 ? [{ type: 'patch', files }] : []
      }
    }
    case 'mcp_tool_call_begin': {
      const server = pickStr(payload, 'server', 'server_name', 'serverName') ?? ''
      const tool = pickStr(payload, 'tool') ?? ''
      const name = [server, tool].filter((v) => v !== '').join('.') || 'mcp'
      return {
        kind: 'blocks',
        key: `mcp:${callId}`,
        blocks: [{ type: 'tool_call', tool: name, callId, state: stringify(payload['arguments']) }]
      }
    }
    case 'mcp_tool_call_end': {
      const result = asRec(payload['result'])
      const body =
        firstNonEmpty([
          result !== undefined ? contentToText(result['content']) : undefined,
          pickStr(payload, 'error')
        ]) ?? ''
      return {
        kind: 'blocks',
        key: `mcp:${callId}`,
        blocks: [{ type: 'tool_result', callId, output: body }]
      }
    }
    case 'web_search_begin': {
      return {
        kind: 'blocks',
        key: `web:${callId}`,
        blocks: [
          { type: 'tool_call', tool: 'web_search', callId, state: pickStr(payload, 'query') ?? '' }
        ]
      }
    }
    case 'context_compacted':
      return { kind: 'blocks', key: null, blocks: [{ type: 'compaction' }] }
    case 'error':
    case 'stream_error': {
      const text = pickStr(payload, 'message') ?? stringify(payload)
      return { kind: 'blocks', key: null, blocks: text.trim() === '' ? [] : [{ type: 'text', text }] }
    }
    default:
      return null
  }
}

/* ============================================================
   文件探测
   ============================================================ */

interface CodexLine {
  timestamp?: string
  type?: string
  payload?: unknown
}

/** 廉价探测整份文件是否含 UI 事件（event_msg）——决定走 event_msg 还是 response_item */
function fileHasUiEvents(filePath: string, chunkBytes = 1 << 20): boolean {
  const needle = '"event_msg"'
  const overlap = 64
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(chunkBytes)
    let offset = 0
    let carry = ''
    for (;;) {
      const read = readSync(fd, buf, 0, chunkBytes, offset)
      if (read <= 0) return false
      const text = carry + buf.subarray(0, read).toString('utf8')
      if (text.includes(needle)) return true
      carry = text.slice(-overlap)
      if (read < chunkBytes) return false
      offset += read
    }
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** 读取文件头部（默认 64KB）用于廉价提取 session_meta 与首条真实用户消息 */
function peekHead(filePath: string, bytes = 65536): string {
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(bytes)
    const read = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, read).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

interface CodexHeadInfo {
  sessionId?: string
  cwd?: string
  createdAt?: number
  title?: string
}

export class CodexReader implements ReaderAdapter {
  readonly source = 'codex' as const
  private readonly home: string
  /** extId → 会话文件绝对路径 */
  private readonly fileIndex = new Map<string, string>()

  constructor(home?: string) {
    this.home = home ?? resolveCodexHome()
  }

  async isAvailable(): Promise<ReaderAvailability> {
    const sessions = join(this.home, 'sessions')
    if (!existsSync(sessions)) {
      return { available: false, detail: `目录不存在: ${sessions}`, unavailableReason: 'no_data' }
    }
    const found = this.scanRollouts()
    return found.length > 0
      ? { available: true, detail: sessions }
      : { available: false, detail: `sessions 下无 rollout: ${sessions}`, unavailableReason: 'no_data' }
  }

  async listSessions(): Promise<RawSessionRef[]> {
    const refs: RawSessionRef[] = []
    for (const file of this.scanRollouts()) {
      const st = statSync(file)
      const info = this.readHeadInfo(file)
      const extId = info.sessionId ?? file.replace(/\.jsonl$/, '').split(/[\\/]/).pop() ?? file
      this.fileIndex.set(extId, file)
      // 标题：首条真实用户消息 → 无则回落 cwd 目录名（harness 注入内容不作标题）
      const title = info.title ?? (info.cwd !== undefined ? baseName(info.cwd) : undefined)
      refs.push({
        source: this.source,
        extId,
        updatedAt: st.mtimeMs,
        ...(title !== undefined && title !== '' ? { titleHint: title } : {}),
        ...(info.cwd !== undefined && info.cwd !== '' ? { directory: info.cwd } : {}),
        ...(info.createdAt !== undefined ? { startedAt: info.createdAt } : {}),
        sizeHint: st.size
      })
    }
    return refs
  }

  async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
    const file = this.fileIndex.get(ref.extId) ?? this.findFileByExtId(ref.extId)
    if (file === undefined) throw new Error(`Codex 会话文件不存在: ${ref.extId}`)

    const useUiEvents = fileHasUiEvents(file)
    /** 当前 assistant 消息的块槽位（有序；同 key 重设即整体替换，防重复） */
    const slots = new Map<string, ContentBlock[]>()
    let pending: RawMessage | null = null
    let seq = 0

    const syncBlocks = (): void => {
      if (pending === null) return
      const all: ContentBlock[] = []
      for (const blocks of slots.values()) all.push(...blocks)
      pending.blocks = all
    }

    const ensurePending = (sentAt: number): void => {
      if (pending === null) {
        pending = {
          sessionId: ref.extId,
          role: 'assistant',
          agentName: 'Codex',
          sentAt,
          blocks: []
        }
      }
    }

    const appendSlot = (key: string, blocks: ContentBlock[]): void => {
      slots.set(key, [...(slots.get(key) ?? []), ...blocks])
    }

    const flush = function* (): Generator<RawMessage> {
      if (pending !== null) {
        syncBlocks()
        if (pending.blocks.length > 0) yield pending
        pending = null
      }
      slots.clear()
    }

    const emitUser = function* (text: string, sentAt: number): Generator<RawMessage> {
      yield* flush()
      if (text.trim() === '' || isHarnessInjected(text)) return
      yield {
        sessionId: ref.extId,
        role: 'user',
        agentName: 'Codex',
        sentAt,
        blocks: [{ type: 'text', text }]
      }
    }

    for await (const raw of readJsonl(file)) {
      const rec = asRec(raw)
      if (rec === undefined) continue
      const line = rec as CodexLine
      const payload = asRec(line.payload)
      if (payload === undefined) continue
      const sentAt = coerceTimestamp(line.timestamp) ?? 0

      if (useUiEvents) {
        if (line.type === 'compacted') {
          const message = pickStr(payload, 'message')
          ensurePending(sentAt)
          slots.set(
            `compact#${seq++}`,
            message !== undefined ? [{ type: 'compaction', summary: message }] : [{ type: 'compaction' }]
          )
          syncBlocks()
          continue
        }
        if (line.type !== 'event_msg') continue

        const eventType = pickStr(payload, 'type') ?? ''

        // 新版：item_started / item_completed（payload.item = TurnItem）
        if (eventType === 'item_started' || eventType === 'item_completed') {
          const item = asRec(payload['item'])
          if (item === undefined) continue
          const tag = pickStr(item, 'type') ?? ''
          const blocks = turnItemToBlocks(item)
          if (blocks.length === 0) continue
          if (tag === 'UserMessage' || tag === 'user_message') {
            yield* emitUser(contentToText(item['content'] ?? item['message']), sentAt)
            continue
          }
          const itemId = pickStr(item, 'id') ?? `${tag}#${seq++}`
          ensurePending(sentAt)
          // item_started 先落地；item_completed 同 id 整体替换为最终态
          if (eventType === 'item_completed' || !slots.has(itemId)) slots.set(itemId, blocks)
          syncBlocks()
          continue
        }

        // 旧版 legacy 事件
        const action = legacyEventAction(payload)
        if (action === null) continue
        if (action.kind === 'user') {
          yield* emitUser(action.text, sentAt)
          continue
        }
        if (action.blocks.length === 0) continue
        ensurePending(sentAt)
        appendSlot(action.key ?? `${eventType || 'blk'}#${seq++}`, action.blocks)
        syncBlocks()
        continue
      }

      // 回退：无 UI 事件的老 rollout —— 读 response_item，但过滤 harness 注入
      if (line.type === 'response_item') {
        const itemType = pickStr(payload, 'type') ?? ''
        if (itemType === 'message') {
          const role = pickStr(payload, 'role') ?? ''
          const text = contentToText(payload['content'])
          if (text.trim() === '') continue
          if (role === 'user') {
            yield* emitUser(text, sentAt)
            continue
          }
          // 仅 assistant 视为模型发言；developer / system 等一律跳过
          if (role !== 'assistant') continue
          ensurePending(sentAt)
          slots.set(`msg#${seq++}`, [{ type: 'text', text }])
          syncBlocks()
          continue
        }
        const blocks = responseItemBlocks(payload)
        if (blocks.length === 0) continue
        const id = pickStr(payload, 'call_id', 'callId', 'id') ?? `ri#${seq++}`
        ensurePending(sentAt)
        if (itemType === 'function_call_output') appendSlot(id, blocks)
        else slots.set(id, blocks)
        syncBlocks()
        continue
      }

      if (line.type === 'compacted') {
        const message = pickStr(payload, 'message')
        ensurePending(sentAt)
        slots.set(
          `compact#${seq++}`,
          message !== undefined ? [{ type: 'compaction', summary: message }] : [{ type: 'compaction' }]
        )
        syncBlocks()
      }
    }
    yield* flush()
  }

  /** 递归扫描 sessions + archived_sessions 下的 rollout-*.jsonl */
  private scanRollouts(): string[] {
    const out: string[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > 4 || !existsSync(dir)) return
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        let isDir: boolean
        try {
          isDir = statSync(full).isDirectory()
        } catch {
          continue
        }
        if (isDir) walk(full, depth + 1)
        else if (entry.startsWith('rollout-') && entry.endsWith('.jsonl')) out.push(full)
      }
    }
    walk(join(this.home, 'sessions'), 0)
    walk(join(this.home, 'archived_sessions'), 0)
    return out
  }

  /** 从文件头提取 session_meta（cwd/时间/id）与首条真实用户消息标题 */
  private readHeadInfo(file: string): CodexHeadInfo {
    const info: CodexHeadInfo = {}
    for (const line of peekHead(file).split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      let obj: unknown
      try {
        obj = JSON.parse(trimmed)
      } catch {
        // 头部截断行解析失败即停
        break
      }
      const rec = asRec(obj)
      if (rec === undefined) continue
      const payload = asRec(rec['payload'])
      if (payload === undefined) continue
      const lineType = pickStr(rec, 'type') ?? ''

      if (lineType === 'session_meta') {
        const id = pickStr(payload, 'session_id', 'id')
        if (id !== undefined) info.sessionId = id
        const cwd = pickStr(payload, 'cwd')
        if (cwd !== undefined) info.cwd = cwd
        const created = coerceTimestamp(payload['timestamp'] as number | string | undefined)
        if (created !== undefined) info.createdAt = created
      } else if (info.title === undefined) {
        const candidate = this.userTextFromLine(lineType, payload)
        if (candidate !== undefined) info.title = sanitizeTitle(candidate)
      }

      if (info.sessionId !== undefined && info.title !== undefined && info.createdAt !== undefined) {
        break
      }
    }
    return info
  }

  /** 从单行中提取「真实用户输入」文本（跳过 harness 注入） */
  private userTextFromLine(lineType: string, payload: Rec): string | undefined {
    if (lineType === 'event_msg') {
      const eventType = pickStr(payload, 'type') ?? ''
      if (eventType === 'user_message') {
        const text = pickStr(payload, 'message') ?? contentToText(payload['content'])
        return text.trim() !== '' && !isHarnessInjected(text) ? text : undefined
      }
      if (eventType === 'item_started' || eventType === 'item_completed') {
        const item = asRec(payload['item'])
        if (item === undefined) return undefined
        const tag = pickStr(item, 'type') ?? ''
        if (tag !== 'UserMessage' && tag !== 'user_message') return undefined
        const text = contentToText(item['content'] ?? item['message'])
        return text.trim() !== '' && !isHarnessInjected(text) ? text : undefined
      }
      return undefined
    }
    if (lineType === 'response_item') {
      if (pickStr(payload, 'type') !== 'message') return undefined
      if (pickStr(payload, 'role') !== 'user') return undefined
      const text = contentToText(payload['content'])
      return text.trim() !== '' && !isHarnessInjected(text) ? text : undefined
    }
    return undefined
  }

  private findFileByExtId(extId: string): string | undefined {
    for (const file of this.scanRollouts()) {
      if (this.readHeadInfo(file).sessionId === extId) return file
    }
    return undefined
  }
}

/** 便捷工厂（registry 惰性加载入口） */
export function createCodexReader(home?: string): CodexReader {
  return new CodexReader(home)
}
