/**
 * Claude Code 适配器 —— ~/.claude（可用 CLAUDE_CONFIG_DIR 重定位）
 *
 * ★ 多布局发现（不写死单一子目录）。实测与官方文档存在这些落盘形态：
 *   A. 标准会话：<root>/projects/<项目 slug>/<sessionUUID>.jsonl
 *      { type: user|assistant|summary|system, message:{content,model,usage}, timestamp,
 *        isMeta?, isSidechain? }
 *   B. 简化转录：<root>/transcripts/ses_*.jsonl
 *      { type: user|tool_use|tool_result, timestamp, content | tool_name+tool_input | tool_output }
 *   C. 会话目录：<root>/sessions 下的 .jsonl（有界递归，部分版本）
 *
 * 根目录候选：CLAUDE_CONFIG_DIR（官方）> CLAUDE_HOME（兼容别名）> ~/.claude；
 * 在根下按 A/B/C 已知布局扫描，并对未知位置的 JSONL 做**内容特征**识别兜底
 * （排除 backups / logs / file-history / todos 等非会话目录）。
 *
 * 展示口径对齐客户端：
 *   - 跳过 isMeta / isSidechain（子代理侧链）/ summary / system；
 *   - 用户正文剥离 <system-reminder> 注入块（客户端不展示）；
 *   - assistant：text / thinking→reasoning / tool_use→tool_call（usage→tokens）；
 *   - 简化转录：tool_use/tool_result 并入同一条 assistant 消息。
 *
 * 增量依据：文件 mtime 高水位（listSessions.updatedAt）。
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
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

/** 读取统计（对账归因用） */
export interface ClaudeCodeReadStats {
  sessionsRead: number
  linesSeen: number
  messagesYielded: number
  skippedByType: Record<string, number>
  malformedLines: number
}

type Rec = Record<string, unknown>

/** 已知会话目录（根下一级） */
const KNOWN_LAYOUT_DIRS = ['projects', 'transcripts', 'sessions'] as const

/** 根下需要跳过的非会话目录（缓存/日志/状态） */
const SKIP_DIRS = new Set([
  'backups',
  'ide',
  'todos',
  'statsig',
  'shell-snapshots',
  'logs',
  'log',
  'file-history',
  'paste-cache',
  'cache',
  'mcp-servers',
  'plugins',
  'memory',
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage'
])

/** 汇总 Claude 候选根目录（CLAUDE_CONFIG_DIR 官方 > CLAUDE_HOME 兼容 > ~/.claude） */
export function resolveClaudeRoots(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string[] {
  const raw: string[] = []
  const push = (v: string | undefined): void => {
    if (v !== undefined && v !== '') raw.push(v)
  }
  push(env['CLAUDE_CONFIG_DIR'])
  push(env['CLAUDE_HOME'])
  push(join(home, '.claude'))
  const seen = new Set<string>()
  return raw.filter((p) => {
    const key = process.platform === 'win32' ? p.toLowerCase() : p
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 主根目录（向后兼容：首个存在的候选，否则 ~/.claude） */
export function resolveClaudeHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  const roots = resolveClaudeRoots(env, home)
  return roots.find((r) => existsSync(r)) ?? roots[roots.length - 1] ?? join(home, '.claude')
}

function asRec(value: unknown): Rec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Rec)
    : undefined
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

/** 只读文件头部（默认 32KB），用于廉价提取标题/起始时间，不整文件解析 */
function peekHead(filePath: string, bytes = 32768): string {
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

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** 用户正文清洗：剥离 <system-reminder> 注入块，折叠空白 */
export function cleanUserText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .trim()
}

/** user 消息 content（string | block[]）→ 统一块列表 */
function userBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    const text = cleanUserText(content)
    return text === '' ? [] : [{ type: 'text', text }]
  }
  if (!Array.isArray(content)) return []
  const blocks: ContentBlock[] = []
  for (const item of content) {
    const rec = asRec(item)
    if (rec === undefined) continue
    if (rec['type'] === 'text' && typeof rec['text'] === 'string') {
      const text = cleanUserText(rec['text'])
      if (text !== '') blocks.push({ type: 'text', text })
    } else if (rec['type'] === 'tool_result') {
      blocks.push({
        type: 'tool_result',
        callId: typeof rec['tool_use_id'] === 'string' ? rec['tool_use_id'] : '',
        output: stringifyUnknown(rec['content'])
      })
    }
  }
  return blocks
}

/** assistant 消息 content（block[]）→ 统一块列表（text/thinking/tool_use） */
function assistantBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) {
    if (typeof content === 'string' && content.trim() !== '') {
      return [{ type: 'text', text: content }]
    }
    return []
  }
  const blocks: ContentBlock[] = []
  for (const item of content) {
    const rec = asRec(item)
    if (rec === undefined) continue
    if (rec['type'] === 'text' && typeof rec['text'] === 'string') {
      blocks.push({ type: 'text', text: rec['text'] })
    } else if (rec['type'] === 'thinking' && typeof rec['thinking'] === 'string') {
      blocks.push({ type: 'reasoning', text: rec['thinking'] })
    } else if (rec['type'] === 'tool_use' && typeof rec['name'] === 'string') {
      blocks.push({
        type: 'tool_call',
        tool: rec['name'],
        callId: typeof rec['id'] === 'string' ? rec['id'] : '',
        state: stringifyUnknown(rec['input'])
      })
    }
  }
  return blocks
}

/** 简化转录记录 → 统一块（transcripts/ses_*.jsonl） */
function transcriptBlocks(rec: Rec): ContentBlock[] {
  const type = typeof rec['type'] === 'string' ? rec['type'] : ''
  if (type === 'tool_use') {
    const name = typeof rec['tool_name'] === 'string' ? rec['tool_name'] : ''
    if (name === '') return []
    return [
      {
        type: 'tool_call',
        tool: name,
        callId: typeof rec['tool_use_id'] === 'string' ? rec['tool_use_id'] : '',
        state: stringifyUnknown(rec['tool_input'])
      }
    ]
  }
  if (type === 'tool_result') {
    const out = asRec(rec['tool_output'])
    const output = out !== undefined ? stringifyUnknown(out['output'] ?? out) : stringifyUnknown(rec['tool_output'])
    return [{ type: 'tool_result', callId: '', output }]
  }
  return []
}

/** 其它 Agent 的 JSONL 特征（内容识别兜底时排除，避免误收） */
function looksLikeForeignAgent(head: string): boolean {
  for (const line of head.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    const rec = asRec(obj)
    if (rec === undefined) continue
    // Codex：{ timestamp, type, payload }
    if (
      typeof rec['type'] === 'string' &&
      rec['payload'] !== undefined &&
      rec['timestamp'] !== undefined
    ) {
      return true
    }
    // Gemini CLI：$set / $rewindTo
    if (rec['$set'] !== undefined || rec['$rewindTo'] !== undefined) return true
    return false
  }
  return false
}

/** 文件是否为 Claude 会话（前若干行内出现 Claude 记录特征） */
function looksLikeClaudeSession(file: string): boolean {
  const head = peekHead(file, 65536)
  for (const line of head.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    const rec = asRec(obj)
    if (rec === undefined) continue
    if (rec['message'] !== undefined || rec['sessionId'] !== undefined) return true
    const type = rec['type']
    if (
      typenameIsClaude(type) ||
      (typeof type === 'string' && (rec['content'] !== undefined || rec['tool_name'] !== undefined))
    ) {
      return true
    }
    return false
  }
  return false
}

function typenameIsClaude(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    ['user', 'assistant', 'summary', 'system', 'tool_use', 'tool_result'].includes(value)
  )
}

/** 取记录的用户正文（兼容 message.content / 顶层 content 两种形态） */
function userTextOf(rec: Rec): string {
  const message = asRec(rec['message'])
  if (typeof message?.['content'] === 'string') return message['content']
  if (typeof rec['content'] === 'string') return rec['content']
  return ''
}

/** 记录是否携带用户正文（用于「工具轨迹」过滤） */
function hasUserContent(rec: Rec): boolean {
  return userTextOf(rec).trim() !== ''
}

/** 轻量判断：文件头部是否含用户提问（前缀布局 transcripts 用，纯工具轨迹会被排除） */
function hasUserRecord(file: string): boolean {
  for (const line of peekHead(file, 8192).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      break
    }
    const rec = asRec(obj)
    if (rec === undefined) break
    if (rec['type'] === 'user' && rec['isMeta'] !== true && hasUserContent(rec)) {
      const text = cleanUserText(userTextOf(rec))
      if (text !== '' && !text.startsWith('/') && !text.startsWith('?')) return true
    }
  }
  return false
}

interface DiscoveredSession {
  extId: string
  file: string
}

/** 发现结果短时缓存窗口（ms）：避免一轮探测里重复整树扫描 */
const DISCOVERY_TTL_MS = 2000

export class ClaudeCodeReader implements ReaderAdapter {
  readonly source = 'claude-code' as const
  /** 显式传入时只用该根（测试/覆盖） */
  private readonly explicitRoot: string | undefined
  private readonly fileIndex = new Map<string, string>()
  /** 发现结果短时缓存（避免 detectSources 的 isAvailable + listSessions 重复整树扫描） */
  private cache: { at: number; sessions: DiscoveredSession[] } | null = null
  private stats: ClaudeCodeReadStats = {
    sessionsRead: 0,
    linesSeen: 0,
    messagesYielded: 0,
    skippedByType: {},
    malformedLines: 0
  }

  constructor(home?: string) {
    this.explicitRoot = home
  }

  readSessionStats(): ClaudeCodeReadStats {
    return { ...this.stats, skippedByType: { ...this.stats.skippedByType } }
  }

  private roots(): string[] {
    return this.explicitRoot !== undefined ? [this.explicitRoot] : resolveClaudeRoots()
  }

  /**
   * 多布局发现：projects/<slug>、transcripts/ses_*、sessions/**，外加内容识别兜底。
   * 已知布局走**文件名规则**（零额外 I/O）；仅未知位置才读头部做内容识别。
   */
  private discover(useCache = true): DiscoveredSession[] {
    if (useCache && this.cache !== null && Date.now() - this.cache.at < DISCOVERY_TTL_MS) {
      return this.cache.sessions
    }
    const out: DiscoveredSession[] = []
    const used = new Set<string>()
    const add = (file: string, known: boolean): void => {
      const base = file.slice(0, -'.jsonl'.length)
      const extId = base.split(/[\\/]/).pop() ?? ''
      if (extId === '' || used.has(extId)) return
      if (!known) {
        // 未知位置：必须通过内容识别，且排除其它 Agent
        if (!looksLikeClaudeSession(file)) return
        if (looksLikeForeignAgent(peekHead(file, 4096))) return
      }
      used.add(extId)
      out.push({ extId, file })
    }

    for (const root of this.roots()) {
      if (!existsSync(root)) continue
      // A. projects/<slug>/*.jsonl
      const projects = join(root, 'projects')
      if (existsSync(projects)) {
        for (const slug of safeReaddir(projects)) {
          const slugDir = join(projects, slug)
          if (!isDir(slugDir)) continue
          for (const f of safeReaddir(slugDir)) {
            if (f.endsWith('.jsonl')) add(join(slugDir, f), true)
          }
        }
      }
      // B. transcripts/*.jsonl（本机实测：ses_*.jsonl）
      //    该布局常为「工具执行轨迹」（无用户提问）——只收录含用户提问者，避免列表被无名轨迹淹没
      const transcripts = join(root, 'transcripts')
      if (existsSync(transcripts)) {
        for (const f of safeReaddir(transcripts)) {
          if (!f.endsWith('.jsonl')) continue
          const full = join(transcripts, f)
          if (!hasUserRecord(full)) continue
          add(full, true)
        }
      }
      // C. sessions/**/*.jsonl（有界）
      walkJsonl(join(root, 'sessions'), 3, (f) => add(f, true))
      // D. 兜底：根下有界扫描，靠内容识别（跳过缓存/日志/状态目录与已知布局）
      walkJsonl(root, 4, (f) => add(f, false), SKIP_DIRS, KNOWN_LAYOUT_DIRS)
    }
    this.cache = { at: Date.now(), sessions: out }
    return out
  }

  async isAvailable(): Promise<ReaderAvailability> {
    const existing = this.roots().filter((r) => existsSync(r))
    if (existing.length === 0) {
      return {
        available: false,
        detail: `未找到 Claude 目录（已探测 ${this.roots().length} 个候选路径）`,
        unavailableReason: 'no_data'
      }
    }
    const found = this.discover()
    return found.length > 0
      ? { available: true, detail: `发现 ${found.length} 个会话于 ${existing.join(' / ')}` }
      : {
          available: false,
          detail: `Claude 目录存在但未发现会话: ${existing.join(' / ')}`,
          unavailableReason: 'no_data'
        }
  }

  async listSessions(): Promise<RawSessionRef[]> {
    const refs: RawSessionRef[] = []
    this.fileIndex.clear()
    for (const session of this.discover()) {
      let st
      try {
        st = statSync(session.file)
      } catch {
        continue
      }
      this.fileIndex.set(session.extId, session.file)
      const { titleHint, startedAt } = this.headInfo(session.file)
      refs.push({
        source: this.source,
        extId: session.extId,
        updatedAt: st.mtimeMs,
        ...(titleHint !== undefined ? { titleHint } : {}),
        sizeHint: st.size,
        ...(startedAt !== undefined ? { startedAt } : {})
      })
    }
    return refs
  }

  async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
    const file = this.fileIndex.get(ref.extId) ?? this.findFileByExtId(ref.extId)
    if (file === undefined) {
      throw new Error(`Claude Code 会话文件不存在: ${ref.extId}`)
    }
    // 每次读取重置统计，避免多会话累加（对账语义：单会话粒度）
    this.stats = {
      sessionsRead: 0,
      linesSeen: 0,
      messagesYielded: 0,
      skippedByType: {},
      malformedLines: 0
    }

    /** 简化转录（transcripts）的 assistant 侧缓冲：tool_use/tool_result 并入同一条消息 */
    let pending: RawMessage | null = null
    const flush = function* (): Generator<RawMessage> {
      if (pending !== null) {
        yield pending
        pending = null
      }
    }

    for await (const raw of readJsonl(file, {
      onError: () => {
        this.stats.malformedLines += 1
      }
    })) {
      this.stats.linesSeen += 1
      if (raw === null || typeof raw !== 'object') {
        this.stats.malformedLines += 1
        continue
      }
      const rec = raw as Rec
      const type = typeof rec['type'] === 'string' ? rec['type'] : '<missing>'
      bump(this.stats.skippedByType, type)

      if (type === 'summary') continue

      const sentAt = coerceTimestamp(rec['timestamp'] as number | string | undefined) ?? Date.now()

      /* ---- 标准格式：带 message 字段 ---- */
      if (rec['message'] !== undefined) {
        if (type === 'user') {
          if (rec['isMeta'] === true || rec['isSidechain'] === true) continue
          const message = asRec(rec['message'])
          const blocks = userBlocks(message?.['content'])
          if (blocks.length === 0) continue
          yield* flush()
          this.stats.messagesYielded += 1
          yield { sessionId: ref.extId, role: 'user', agentName: 'Claude Code', sentAt, blocks }
          continue
        }
        if (type === 'assistant') {
          if (rec['isSidechain'] === true) continue
          const message = asRec(rec['message'])
          if (message === undefined) continue
          const blocks = assistantBlocks(message['content'])
          if (blocks.length === 0) continue
          let modelName: string | undefined
          let tokensIn: number | undefined
          let tokensOut: number | undefined
          if (typeof message['model'] === 'string') modelName = message['model']
          const usage = asRec(message['usage'])
          if (usage !== undefined) {
            if (typeof usage['input_tokens'] === 'number') tokensIn = usage['input_tokens']
            if (typeof usage['output_tokens'] === 'number') tokensOut = usage['output_tokens']
          }
          yield* flush()
          this.stats.messagesYielded += 1
          yield {
            sessionId: ref.extId,
            role: 'assistant',
            agentName: 'Claude Code',
            sentAt,
            ...(modelName !== undefined ? { modelName } : {}),
            ...(tokensIn !== undefined ? { tokensIn } : {}),
            ...(tokensOut !== undefined ? { tokensOut } : {}),
            blocks
          }
          continue
        }
        continue
      }

      /* ---- 简化转录格式（transcripts/ses_*.jsonl）---- */
      if (type === 'user') {
        const text = cleanUserText(typeof rec['content'] === 'string' ? rec['content'] : '')
        if (text === '') continue
        yield* flush()
        this.stats.messagesYielded += 1
        yield {
          sessionId: ref.extId,
          role: 'user',
          agentName: 'Claude Code',
          sentAt,
          blocks: [{ type: 'text', text }]
        }
        continue
      }
      const blocks = transcriptBlocks(rec)
      if (blocks.length === 0) continue
      if (pending === null) {
        pending = {
          sessionId: ref.extId,
          role: 'assistant',
          agentName: 'Claude Code',
          sentAt,
          blocks: [...blocks]
        }
      } else {
        pending.blocks.push(...blocks)
      }
      this.stats.messagesYielded += 1
    }
    yield* flush()
    this.stats.sessionsRead += 1
  }

  /** 头部探测：summary 标题 / 首条用户消息 + 起始时间（8KB 足够覆盖前几行） */
  private headInfo(file: string): { titleHint?: string; startedAt?: number } {
    let titleHint: string | undefined
    let startedAt: number | undefined
    for (const line of peekHead(file, 8192).split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      let obj: unknown
      try {
        obj = JSON.parse(trimmed)
      } catch {
        break
      }
      const rec = asRec(obj)
      if (rec === undefined) break
      if (startedAt === undefined) {
        const ts = coerceTimestamp(rec['timestamp'] as number | string | undefined)
        if (ts !== undefined) startedAt = ts
      }
      if (titleHint === undefined && rec['type'] === 'summary' && typeof rec['summary'] === 'string') {
        titleHint = rec['summary']
      }
      if (titleHint === undefined && rec['type'] === 'user' && rec['isMeta'] !== true) {
        const text = cleanUserText(userTextOf(rec))
        if (text !== '' && !text.startsWith('/') && !text.startsWith('?')) {
          titleHint = text.replace(/\s+/g, ' ').slice(0, 80)
        }
      }
      if (titleHint !== undefined && startedAt !== undefined) break
    }
    return {
      ...(titleHint !== undefined ? { titleHint } : {}),
      ...(startedAt !== undefined ? { startedAt } : {})
    }
  }

  private findFileByExtId(extId: string): string | undefined {
    return this.discover().find((s) => s.extId === extId)?.file
  }
}

/* ============================================================
   目录工具
   ============================================================ */

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 有界递归收集 .jsonl；skipDirs 内的目录（及 extraSkip）不进入 */
function walkJsonl(
  root: string,
  maxDepth: number,
  onFile: (file: string) => void,
  skipDirs: ReadonlySet<string> = new Set(),
  extraSkip: readonly string[] = []
): void {
  if (!existsSync(root)) return
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    for (const entry of safeReaddir(dir)) {
      const full = join(dir, entry)
      if (isDir(full)) {
        if (skipDirs.has(entry) || extraSkip.includes(entry) || entry.startsWith('.')) continue
        walk(full, depth + 1)
      } else if (entry.endsWith('.jsonl')) {
        onFile(full)
      }
    }
  }
  walk(root, 0)
}

/** 便捷工厂（registry 惰性加载入口） */
export function createClaudeCodeReader(home?: string): ClaudeCodeReader {
  return new ClaudeCodeReader(home)
}
