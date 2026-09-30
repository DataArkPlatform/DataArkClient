/**
 * DeepSeek Harness (dsh) 适配器 —— DeepSeek 2026-08-13 开源的 agent harness 会话。
 *
 * 数据位置：<DSH_HOME|~>/.dsh/sessions/<projectDir>/<sessionDir>/session[.vN].jsonl[.zstd]
 *   - projectDir = `--<规范化cwd>--`（分隔符→`-`）或 `_no-cwd`
 *   - sessionDir = 会话 id 的转义编码（非 [A-Za-z0-9._-] → `~XXXX`）
 *   - 默认 zstd：首帧仅含 header 行，其后每帧一个 append 批次（拼接 checksummed 帧）
 *   - compression:'none' 时为明文 .jsonl
 *
 * 文件结构：首行 = header {type:'session', version, id, createdAt, cwd?}；
 *   其后每行 = event {type, seq, time, data, ...}。
 *
 * 映射：user/message→user；assistant/message→assistant（text/reasoning/tool-call，
 *   usage→tokens）；tool/result→assistant（tool-result 块）；system/message 跳过。
 * 标题：session/title 事件优先，否则首条 user 消息。增量依据：最后事件 time。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  coerceTimestamp,
  type ContentBlock,
  type RawMessage,
  type RawSessionRef
} from '../../../shared/unified-model'
import type { ReaderAdapter, ReaderAvailability } from '../types'
import { decompressZstdFrames } from '../infra/zstd-frames'

/** 解析 dsh 根目录（DSH_HOME 覆盖默认；默认 ~/.dsh） */
export function resolveDshHome(): string {
  const env = process.env['DSH_HOME']
  return env !== undefined && env !== '' ? env : join(homedir(), '.dsh')
}

/** 会话日志根：默认 <home>/sessions（dsh 各 profile 的持久化 root） */
function sessionsRoot(home: string): string {
  const env = process.env['DSH_SESSION_ROOT']
  return env !== undefined && env !== '' ? env : join(home, 'sessions')
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** LLM ContentBlock[] → 纯文本（用于 tool-result 输出折叠） */
function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return stringifyUnknown(content)
  const parts: string[] = []
  for (const item of content) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec['text'] === 'string') parts.push(rec['text'])
    else if (rec['content'] !== undefined) parts.push(blocksToText(rec['content']))
  }
  return parts.join('\n')
}

/** LLM ContentBlock → 统一块（text/reasoning/tool-call/tool-result；其余跳过） */
function toBlock(item: unknown): ContentBlock | null {
  if (item === null || typeof item !== 'object') return null
  const rec = item as Record<string, unknown>
  switch (rec['type']) {
    case 'text':
      return typeof rec['text'] === 'string' ? { type: 'text', text: rec['text'] } : null
    case 'reasoning':
      return typeof rec['text'] === 'string' ? { type: 'reasoning', text: rec['text'] } : null
    case 'tool-call': {
      const name = rec['name']
      if (typeof name !== 'string') return null
      return {
        type: 'tool_call',
        tool: name,
        callId: typeof rec['id'] === 'string' ? rec['id'] : '',
        state: stringifyUnknown(rec['arguments'])
      }
    }
    case 'tool-result':
      return {
        type: 'tool_result',
        callId: typeof rec['toolCallId'] === 'string' ? rec['toolCallId'] : '',
        output: blocksToText(rec['content'])
      }
    default:
      return null
  }
}

function messageBlocks(message: unknown): ContentBlock[] {
  if (message === null || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>)['content']
  if (!Array.isArray(content)) return []
  const out: ContentBlock[] = []
  for (const item of content) {
    const block = toBlock(item)
    if (block !== null) out.push(block)
  }
  return out
}

interface DshHeader {
  id?: string
  createdAt?: number
  cwd?: string
}

interface DshEvent {
  type?: string
  time?: number
  data?: unknown
}

export class DeepSeekHarnessReader implements ReaderAdapter {
  readonly source = 'deepseek-harness' as const
  private readonly home: string
  /** extId → 会话日志文件绝对路径 */
  private readonly fileIndex = new Map<string, string>()

  constructor(home?: string) {
    this.home = home ?? resolveDshHome()
  }

  async isAvailable(): Promise<ReaderAvailability> {
    const root = sessionsRoot(this.home)
    if (!existsSync(root)) {
      return { available: false, detail: `目录不存在: ${root}`, unavailableReason: 'no_data' }
    }
    const found = this.scanLogs()
    return found.length > 0
      ? { available: true, detail: root }
      : { available: false, detail: `sessions 下无会话日志: ${root}`, unavailableReason: 'no_data' }
  }

  async listSessions(): Promise<RawSessionRef[]> {
    const refs: RawSessionRef[] = []
    for (const file of this.scanLogs()) {
      const st = statSync(file)
      const lines = this.readLines(file)
      const header = this.parseHeader(lines[0])
      if (header.id === undefined || header.id === '') continue
      this.fileIndex.set(header.id, file)
      const events = this.parseEvents(lines.slice(1))
      const updatedAt = this.maxEventTime(events) ?? header.createdAt ?? st.mtimeMs
      const title = this.pickTitle(events, lines)
      refs.push({
        source: this.source,
        extId: header.id,
        updatedAt,
        ...(title !== '' ? { titleHint: title } : {}),
        ...(header.cwd !== undefined && header.cwd !== '' ? { directory: header.cwd } : {}),
        ...(header.createdAt !== undefined ? { startedAt: header.createdAt } : {}),
        sizeHint: st.size
      })
    }
    return refs
  }

  async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
    const file = this.fileIndex.get(ref.extId) ?? this.findFileByExtId(ref.extId)
    if (file === undefined) throw new Error(`DeepSeek Harness 会话文件不存在: ${ref.extId}`)
    const lines = this.readLines(file)
    const events = this.parseEvents(lines.slice(1))
    for (const evt of events) {
      const msg = this.eventToMessage(evt, ref.extId)
      if (msg !== null) yield msg
    }
  }

  /** 事件 → 统一消息（user/message / assistant/message / tool/result；其余跳过） */
  private eventToMessage(evt: DshEvent, sessionId: string): RawMessage | null {
    if (evt.type !== 'user/message' && evt.type !== 'assistant/message' && evt.type !== 'tool/result') {
      return null
    }
    const data =
      evt.data !== null && typeof evt.data === 'object'
        ? (evt.data as Record<string, unknown>)
        : {}
    const blocks = messageBlocks(data['message'])
    if (blocks.length === 0) return null
    const sentAt = coerceTimestamp(evt.time as number | string | undefined) ?? 0

    // tool/result 归到 assistant 侧（与 OpenCode 单消息含 call+result 的展示一致）
    const role = evt.type === 'user/message' ? 'user' : 'assistant'
    let modelName: string | undefined
    if (evt.type === 'assistant/message') {
      const message = data['message']
      if (message !== null && typeof message === 'object') {
        const source = (message as Record<string, unknown>)['source']
        if (source !== null && typeof source === 'object') {
          const m = (source as Record<string, unknown>)['model']
          if (typeof m === 'string' && m !== '') modelName = m
        }
      }
    }
    const usage =
      data['usage'] !== null && typeof data['usage'] === 'object'
        ? (data['usage'] as Record<string, unknown>)
        : undefined

    return {
      sessionId,
      role,
      agentName: 'DeepSeek Harness',
      sentAt,
      ...(modelName !== undefined ? { modelName } : {}),
      ...(typeof usage?.['inputTokens'] === 'number' ? { tokensIn: usage['inputTokens'] } : {}),
      ...(typeof usage?.['outputTokens'] === 'number' ? { tokensOut: usage['outputTokens'] } : {}),
      blocks
    }
  }

  /** 读取日志文本：.zstd 走拼接帧解压，否则明文 */
  private readLines(file: string): string[] {
    try {
      const buf = readFileSync(file)
      const text = file.endsWith('.zstd') ? decompressZstdFrames(buf) : buf.toString('utf8')
      return text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    } catch {
      return []
    }
  }

  private parseHeader(line: string | undefined): DshHeader {
    if (line === undefined) return {}
    try {
      const obj = JSON.parse(line) as unknown
      if (obj === null || typeof obj !== 'object') return {}
      const rec = obj as Record<string, unknown>
      return {
        ...(typeof rec['id'] === 'string' ? { id: rec['id'] } : {}),
        ...(typeof rec['createdAt'] === 'number' ? { createdAt: rec['createdAt'] } : {}),
        ...(typeof rec['cwd'] === 'string' ? { cwd: rec['cwd'] } : {})
      }
    } catch {
      return {}
    }
  }

  private parseEvents(lines: string[]): DshEvent[] {
    const out: DshEvent[] = []
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as unknown
        if (obj !== null && typeof obj === 'object') out.push(obj as DshEvent)
      } catch {
        /* 跳过残缺行 */
      }
    }
    return out
  }

  private maxEventTime(events: DshEvent[]): number | undefined {
    let max: number | undefined
    for (const e of events) {
      if (typeof e.time === 'number' && (max === undefined || e.time > max)) max = e.time
    }
    return max
  }

  /** 标题：session/title 事件（后者覆盖）优先，否则首条 user 消息文本 */
  private pickTitle(events: DshEvent[], lines: string[]): string {
    let title = ''
    for (const e of events) {
      if (e.type !== 'session/title') continue
      const data = e.data !== null && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {}
      if (typeof data['title'] === 'string' && data['title'] !== '') title = data['title']
    }
    if (title !== '') return title
    for (const line of lines.slice(1)) {
      try {
        const obj = JSON.parse(line) as DshEvent
        if (obj.type !== 'user/message') continue
        const text = blocksToText(
          obj.data !== null && typeof obj.data === 'object'
            ? ((obj.data as Record<string, unknown>)['message'] as Record<string, unknown> | undefined)?.[
                'content'
              ]
            : undefined
        ).trim()
        if (text !== '') return text.slice(0, 80)
      } catch {
        /* 跳过 */
      }
    }
    return ''
  }

  /** 扫描 <root>/<projectDir>/<sessionDir>/session*.jsonl[.zstd] */
  private scanLogs(): string[] {
    const root = sessionsRoot(this.home)
    if (!existsSync(root)) return []
    const out: string[] = []
    for (const project of readdirSync(root)) {
      const projectDir = join(root, project)
      if (!isDir(projectDir)) continue
      for (const session of readdirSync(projectDir)) {
        const sessionDir = join(projectDir, session)
        if (!isDir(sessionDir)) continue
        for (const f of readdirSync(sessionDir)) {
          if (f.startsWith('session') && (f.endsWith('.jsonl') || f.endsWith('.jsonl.zstd'))) {
            out.push(join(sessionDir, f))
          }
        }
      }
    }
    return out
  }

  private findFileByExtId(extId: string): string | undefined {
    for (const file of this.scanLogs()) {
      const header = this.parseHeader(this.readLines(file)[0])
      if (header.id === extId) return file
    }
    return undefined
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 便捷工厂（registry 惰性加载入口） */
export function createDeepSeekHarnessReader(home?: string): DeepSeekHarnessReader {
  return new DeepSeekHarnessReader(home)
}
