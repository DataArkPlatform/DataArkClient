/**
 * Gemini CLI 适配器 —— google-gemini/gemini-cli 会话。
 *
 * 数据位置：<GEMINI_CLI_HOME|~>/.gemini/tmp/<project-id>/chats/session-<ts>-<8id>.jsonl
 *   - 新版：JSONL（首行元数据 + 消息行 + {$set}/{$rewindTo} 控制行），扩展名 .jsonl
 *   - 旧版：单文件 .json（同 ConversationRecord 形状），目录名为项目根 SHA-256
 *   - <project-id>：新版为 projects.json 注册的短 slug；旧版为 sha256(项目根)
 *
 * 项目路径解析：~/.gemini/projects.json {projects:{<规范绝对路径>:<slug>}} 反查，
 * 或 <tmp|history>/<slug>/.project_root 标记文件。
 *
 * 消息映射：type user→user；gemini→assistant（text + thoughts→reasoning +
 * toolCalls→tool_call，其 result→tool_result）；info/error/warning 跳过。
 * 增量依据：元数据 lastUpdated（缺省回退文件 mtime）。
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
import { readJsonl } from '../infra/jsonl-stream'

/**
 * 解析 Gemini 根目录。
 * 候选环境变量：GEMINI_DIR > GEMINI_CLI_HOME（两种约定都兼容：直接指向 .gemini 根，或指向其父目录）
 * 默认：~/.gemini
 */
export function resolveGeminiHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  const explicit = env['GEMINI_DIR'] ?? env['GEMINI_CLI_HOME']
  if (explicit !== undefined && explicit !== '') {
    return existsSync(join(explicit, 'tmp')) || existsSync(join(explicit, 'history'))
      ? explicit
      : join(explicit, '.gemini')
  }
  return join(home, '.gemini')
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

/** PartListUnion（string | Part | Part[]）→ 纯文本 */
function contentToText(content: unknown): string {
  const one = (part: unknown): string => {
    if (typeof part === 'string') return part
    if (part !== null && typeof part === 'object') {
      const p = part as Record<string, unknown>
      if (typeof p['text'] === 'string') return p['text']
      if (p['functionResponse'] !== undefined) return stringifyUnknown(p['functionResponse'])
      if (p['functionCall'] !== undefined) return stringifyUnknown(p['functionCall'])
    }
    return ''
  }
  if (Array.isArray(content)) return content.map(one).filter((t) => t !== '').join('\n')
  return one(content)
}

interface GeminiMessageRecord {
  id?: string
  timestamp?: string
  type?: string
  content?: unknown
  model?: string
  thoughts?: unknown
  tokens?: unknown
  toolCalls?: unknown
}

/** 单条 gemini 消息 → 统一块列表 */
function geminiBlocks(rec: GeminiMessageRecord): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const text = contentToText(rec.content)
  if (text.trim() !== '') blocks.push({ type: 'text', text })

  if (Array.isArray(rec.thoughts)) {
    for (const t of rec.thoughts) {
      if (t === null || typeof t !== 'object') continue
      const th = t as Record<string, unknown>
      const subject = typeof th['subject'] === 'string' ? th['subject'] : ''
      const desc = typeof th['description'] === 'string' ? th['description'] : ''
      const joined = [subject, desc].filter((s) => s !== '').join('：')
      if (joined !== '') blocks.push({ type: 'reasoning', text: joined })
    }
  }

  if (Array.isArray(rec.toolCalls)) {
    for (const tc of rec.toolCalls) {
      if (tc === null || typeof tc !== 'object') continue
      const call = tc as Record<string, unknown>
      const name = typeof call['name'] === 'string' ? call['name'] : ''
      const callId = typeof call['id'] === 'string' ? call['id'] : ''
      if (name === '') continue
      blocks.push({
        type: 'tool_call',
        tool: name,
        callId,
        state: stringifyUnknown({ args: call['args'], status: call['status'] })
      })
      if (call['result'] !== undefined && call['result'] !== null) {
        blocks.push({ type: 'tool_result', callId, output: contentToText(call['result']) })
      }
    }
  }
  return blocks
}

interface TokenSummary {
  input?: number
  output?: number
}

function tokensOf(rec: GeminiMessageRecord): TokenSummary {
  if (rec.tokens === null || typeof rec.tokens !== 'object') return {}
  const t = rec.tokens as Record<string, unknown>
  return {
    ...(typeof t['input'] === 'number' ? { input: t['input'] } : {}),
    ...(typeof t['output'] === 'number' ? { output: t['output'] } : {})
  }
}

export class GeminiCliReader implements ReaderAdapter {
  readonly source = 'gemini-cli' as const
  private readonly home: string
  /** sessionId → 会话文件绝对路径（listSessions 时填充，供 readSession 定位） */
  private readonly fileIndex = new Map<string, string>()

  constructor(home?: string) {
    this.home = home ?? resolveGeminiHome()
  }

  async isAvailable(): Promise<ReaderAvailability> {
    const tmp = join(this.home, 'tmp')
    if (!existsSync(tmp)) {
      return { available: false, detail: `目录不存在: ${tmp}`, unavailableReason: 'no_data' }
    }
    const found = this.scanSessionFiles()
    return found.length > 0
      ? { available: true, detail: tmp }
      : { available: false, detail: `tmp 下无会话文件: ${tmp}`, unavailableReason: 'no_data' }
  }

  async listSessions(): Promise<RawSessionRef[]> {
    const projectMap = this.readProjectMap()
    const refs: RawSessionRef[] = []
    for (const { file, slug } of this.scanSessionFiles()) {
      const st = statSync(file)
      const meta = this.readMeta(file)
      const sessionId = meta?.['sessionId']
      if (typeof sessionId !== 'string' || sessionId === '') continue
      this.fileIndex.set(sessionId, file)
      const updatedAt =
        coerceTimestamp(meta?.['lastUpdated'] as number | string | undefined) ?? st.mtimeMs
      const startedAt = coerceTimestamp(meta?.['startTime'] as number | string | undefined)
      const title = this.pickTitle(meta?.['summary'], file)
      const dir = this.resolveProjectPath(slug, projectMap)
      refs.push({
        source: this.source,
        extId: sessionId,
        updatedAt,
        ...(title !== '' ? { titleHint: title } : {}),
        ...(dir !== '' ? { directory: dir } : {}),
        ...(startedAt !== undefined ? { startedAt } : {}),
        sizeHint: st.size
      })
    }
    return refs
  }

  async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
    const file = this.fileIndex.get(ref.extId) ?? this.findFileBySessionId(ref.extId)
    if (file === undefined) throw new Error(`Gemini CLI 会话文件不存在: ${ref.extId}`)

    // 折叠为有序消息表：$rewindTo 截断、$set.messages 重建
    const order: string[] = []
    const byId = new Map<string, GeminiMessageRecord>()
    const apply = (rec: GeminiMessageRecord): void => {
      const id = rec.id
      if (id === undefined || id === '') return
      if (!byId.has(id)) order.push(id)
      byId.set(id, rec)
    }

    if (file.endsWith('.json')) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { messages?: unknown }
      if (Array.isArray(parsed.messages)) {
        for (const m of parsed.messages) apply(m as GeminiMessageRecord)
      }
    } else {
      for await (const raw of readJsonl(file)) {
        if (raw === null || typeof raw !== 'object') continue
        const rec = raw as Record<string, unknown>
        if (typeof rec['$rewindTo'] === 'string') {
          const idx = order.indexOf(rec['$rewindTo'])
          if (idx >= 0) {
            for (const removed of order.splice(idx)) byId.delete(removed)
          } else {
            order.length = 0
            byId.clear()
          }
          continue
        }
        if (rec['$set'] !== undefined) {
          const set = rec['$set'] as Record<string, unknown>
          if (Array.isArray(set['messages'])) {
            order.length = 0
            byId.clear()
            for (const m of set['messages']) apply(m as GeminiMessageRecord)
          }
          continue
        }
        if (rec['id'] !== undefined) apply(rec as GeminiMessageRecord)
      }
    }

    for (const id of order) {
      const rec = byId.get(id)
      if (rec === undefined) continue
      const type = rec.type
      if (type !== 'user' && type !== 'gemini') continue
      const tokens = tokensOf(rec)
      yield {
        sessionId: ref.extId,
        role: type === 'gemini' ? 'assistant' : 'user',
        agentName: 'Gemini CLI',
        sentAt: coerceTimestamp(rec.timestamp) ?? 0,
        ...(typeof rec.model === 'string' && rec.model !== '' ? { modelName: rec.model } : {}),
        ...(tokens.input !== undefined ? { tokensIn: tokens.input } : {}),
        ...(tokens.output !== undefined ? { tokensOut: tokens.output } : {}),
        blocks: type === 'gemini' ? geminiBlocks(rec) : [{ type: 'text', text: contentToText(rec.content) }]
      }
    }
  }

  /** 扫描 <tmp|history>/<slug>/chats/*.{json,jsonl}（非递归：跳过 subagent 子目录） */
  private scanSessionFiles(): Array<{ file: string; slug: string }> {
    const out: Array<{ file: string; slug: string }> = []
    for (const base of ['tmp', 'history']) {
      const baseDir = join(this.home, base)
      if (!existsSync(baseDir)) continue
      for (const slug of readdirSync(baseDir)) {
        const chats = join(baseDir, slug, 'chats')
        if (!existsSync(chats) || !statSync(chats).isDirectory()) continue
        for (const f of readdirSync(chats)) {
          if (!f.startsWith('session-') || !(f.endsWith('.json') || f.endsWith('.jsonl'))) continue
          out.push({ file: join(chats, f), slug })
        }
      }
    }
    return out
  }

  /** 读取会话元数据（JSONL 首行 / 整份 JSON），叠加 $set 补丁 */
  private readMeta(file: string): Record<string, unknown> | undefined {
    try {
      if (file.endsWith('.json')) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
        return parsed !== null && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : undefined
      }
      // JSONL：首行即元数据（含 sessionId），后续 $set 覆盖 lastUpdated/summary
      let meta: Record<string, unknown> | undefined
      const lines = readFileSync(file, 'utf8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        let obj: unknown
        try {
          obj = JSON.parse(trimmed)
        } catch {
          continue
        }
        if (obj === null || typeof obj !== 'object') continue
        const rec = obj as Record<string, unknown>
        if (rec['$set'] !== undefined && meta !== undefined) {
          Object.assign(meta, rec['$set'] as Record<string, unknown>)
        } else if (rec['sessionId'] !== undefined && meta === undefined) {
          meta = { ...rec }
        }
      }
      return meta
    } catch {
      return undefined
    }
  }

  /** 标题：summary 优先，否则首个非斜杠/问号 user 消息 */
  private pickTitle(summary: unknown, file: string): string {
    if (typeof summary === 'string' && summary.trim() !== '') return summary
    try {
      const lines = readFileSync(file, 'utf8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        let obj: unknown
        try {
          obj = JSON.parse(trimmed)
        } catch {
          continue
        }
        if (obj === null || typeof obj !== 'object') continue
        const rec = obj as Record<string, unknown>
        if (rec['type'] !== 'user') continue
        const text = contentToText(rec['content']).trim()
        if (text !== '' && !text.startsWith('/') && !text.startsWith('?')) return text.slice(0, 80)
      }
    } catch {
      /* 忽略 */
    }
    return ''
  }

  /** projects.json 反查：slug → 规范项目路径 */
  private readProjectMap(): Map<string, string> {
    const map = new Map<string, string>()
    const p = join(this.home, 'projects.json')
    if (!existsSync(p)) return map
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as { projects?: Record<string, string> }
      for (const [path, slug] of Object.entries(parsed.projects ?? {})) {
        if (!map.has(slug)) map.set(slug, path)
      }
    } catch {
      /* 忽略 */
    }
    return map
  }

  /** 项目路径：projects.json 优先，其次 .project_root 标记文件 */
  private resolveProjectPath(slug: string, projectMap: Map<string, string>): string {
    const fromMap = projectMap.get(slug)
    if (fromMap !== undefined) return fromMap
    for (const base of ['tmp', 'history']) {
      const marker = join(this.home, base, slug, '.project_root')
      if (existsSync(marker)) {
        try {
          return readFileSync(marker, 'utf8').trim()
        } catch {
          /* 忽略 */
        }
      }
    }
    return ''
  }

  /** readSession 未命中索引时按 sessionId 兜底扫描 */
  private findFileBySessionId(sessionId: string): string | undefined {
    for (const { file } of this.scanSessionFiles()) {
      const meta = this.readMeta(file)
      if (meta?.sessionId === sessionId) return file
    }
    return undefined
  }
}

/** 便捷工厂（registry 惰性加载入口） */
export function createGeminiCliReader(home?: string): GeminiCliReader {
  return new GeminiCliReader(home)
}
