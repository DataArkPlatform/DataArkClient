/**
 * Qoder 适配器 —— 阿里 Qoder（CLI / CN CLI / 桌面 IDE）本地会话。
 *
 * ★ 设计原则：**能发现就不写死**。Qoder 的会话布局随「版本 / 端 / 平台 / 用户配置」变化，
 *   实测与官方文档至少存在这些形态：
 *
 *   A. 桌面端 CLI 缓存：<appData>/QoderCN/SharedClientCache/cli/projects/task-*.session.execution.jsonl
 *   B. Qoder CLI    ：<配置目录>/projects/<项目>/<session-id>.jsonl  (+ <session-id>-session.json)
 *   C. Qoder CN CLI ：<配置目录> 为 ~/.qoder-cn（B 的 CN 变体）
 *   D. 桌面 IDE 归档：~/Documents/Qoder/<日期>/<短哈希>/…（结构未公开，靠内容识别）
 *
 *   因此本适配器不依赖单一固定路径，而是：
 *   1) 汇总**候选根目录**（环境变量 > 规范路径 > 应用数据目录 > 文档目录），去重且仅保留存在者；
 *   2) 在每个根下做**有界递归扫描**（深度/目录数/文件数三重上限 + 噪声目录跳过），找出所有 .jsonl；
 *   3) 用**内容特征**排除其它 Agent 的 JSONL（Codex rollout / Claude / Gemini），而非靠目录名；
 *   4) 元数据可选：同名 `<extId>-session.json` 存在则取 title/working_dir/时间；缺失则从首条
 *      用户消息推导标题、按文件 mtime 作增量依据。
 *
 *   官方文档：https://docs.qoder.com/cli/sessions （QODER_CONFIG_DIR / QODERCN_CONFIG_DIR 可自定义配置目录）
 *
 * 记录结构（兼容多形态）：{ role, parts[] } 为主；亦容忍 { role, content[] }、{ role, message }。
 *   parts[].type: text{text} / reasoning{thinking} / tool_call{id,name,input,finished} /
 *                 tool_result{tool_use_id,name,content} / finish{reason}
 * 映射：user→user；assistant→assistant（text/reasoning/tool_call）；tool→把 tool_result 合并进
 *   前一条 assistant 消息（与 OpenCode 单消息含 call+result 的模型一致）。
 */
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  type Dirent
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type ContentBlock, type RawMessage, type RawSessionRef } from '../../../shared/unified-model'
import type { ReaderAdapter, ReaderAvailability } from '../types'
import { readJsonl } from '../infra/jsonl-stream'
import { appDataDir } from '../infra/app-data'

type Rec = Record<string, unknown>

const META_SUFFIX = '-session.json'
const JSONL_SUFFIX = '.jsonl'

/* ============================================================
   候选根目录发现
   ============================================================ */

/**
 * 汇总 Qoder 候选根目录（去重、保序）；仅做「路径拼接」，存在性由调用方判断。
 * env / home / appData 可注入，便于跨平台单测。
 */
export function resolveQoderRoots(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  appData: string = appDataDir()
): string[] {
  const raw: string[] = []
  const push = (value: string | undefined): void => {
    if (value !== undefined && value !== '') raw.push(value)
  }

  // 1) 环境变量（官方：CLI 配置目录可自定义）
  push(env['QODER_CONFIG_DIR'])
  push(env['QODERCN_CONFIG_DIR'])
  push(env['QODER_HOME'])

  // 2) 家目录规范位置（官方 CLI 默认）
  push(join(home, '.qoder'))
  push(join(home, '.qoder-cn'))

  // 3) 桌面端应用数据目录（Win %APPDATA% / macOS ~/Library/Application Support / Linux ~/.config）
  push(join(appData, 'QoderCN'))
  push(join(appData, 'Qoder'))

  // 4) 用户文档目录（桌面 IDE 归档形态 D）
  push(join(home, 'Documents', 'Qoder'))
  push(join(home, 'Documents', 'QoderCN'))

  // 去重（Windows 大小写不敏感）并保序
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of raw) {
    const key = process.platform === 'win32' ? p.toLowerCase() : p
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/** 主根目录（向后兼容；优先返回含 Qoder 会话特征的已存在根） */
export function resolveQoderHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  appData: string = appDataDir()
): string {
  const roots = resolveQoderRoots(env, home, appData)
  const preferred = roots.find(
    (root) => existsSync(join(root, 'SharedClientCache')) || existsSync(join(root, 'projects'))
  )
  return preferred ?? roots[0] ?? join(home, '.qoder')
}

/* ============================================================
   有界递归扫描
   ============================================================ */

/** 噪声目录（缓存 / 依赖 / 构建产物 / 其它生态）——不进入 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.cache',
  '.vscode',
  '.idea',
  '__pycache__',
  'Cache',
  'CachedData',
  'CachedExtensions',
  'CachedExtensionVSIXs',
  'GPUCache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Service Worker',
  'Local Storage',
  'Session Storage',
  'Network',
  'logs',
  'log',
  'tmp',
  'temp',
  'dist',
  'out',
  'build',
  'coverage',
  'Crashpad',
  'Crash Reports',
  // Qoder 自身的非会话目录（遥测/索引），避免被当成会话
  'ai_tracker',
  'embeddings_cache',
  'index_cache'
])

interface ScanCaps {
  maxDepth: number
  maxDirs: number
  maxFiles: number
}

const DEFAULT_CAPS: ScanCaps = { maxDepth: 6, maxDirs: 4000, maxFiles: 6000 }

/** 有界收集 root 下所有 .jsonl（深度/目录数/文件数三重上限，DFS + 噪声目录跳过） */
function collectJsonlFiles(root: string, caps: ScanCaps = DEFAULT_CAPS): string[] {
  const out: string[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let dirs = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    if (current.depth > caps.maxDepth) continue
    if (++dirs > caps.maxDirs) break
    let entries: Dirent[]
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current.dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          stack.push({ dir: full, depth: current.depth + 1 })
        }
      } else if (entry.isFile() && entry.name.endsWith(JSONL_SUFFIX)) {
        out.push(full)
        if (out.length >= caps.maxFiles) return out.sort()
      }
    }
  }
  return out.sort()
}

/** 读取文件头若干 KB（跨读取边界足够容纳超长首行） */
function readHeadText(file: string, bytes = 262144): string {
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const read = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, read).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** 其它 Agent 的 JSONL 特征（用于内容识别排除，而非路径猜测）——只认已知的强特征 */
function looksLikeForeignAgent(text: string): boolean {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (obj === null || typeof obj !== 'object') continue
    const rec = obj as Rec
    // Codex：RolloutItem 三件套 { timestamp, type, payload }
    if (
      typeof rec['type'] === 'string' &&
      rec['payload'] !== undefined &&
      rec['timestamp'] !== undefined
    ) {
      return true
    }
    // Claude Code：camelCase sessionId + parentUuid/uuid
    if (rec['sessionId'] !== undefined || rec['parentUuid'] !== undefined) return true
    // Gemini CLI：$set / $rewindTo 折叠指令
    if (rec['$set'] !== undefined || rec['$rewindTo'] !== undefined) return true
    return false
  }
  return false
}

/**
 * Qoder 会话行的**正向内容特征**（用于拒绝非会话 JSONL，例如 Qoder 自己的 ai_tracker 遥测）。
 * 已知形态：
 *   · { role, parts:[…] }                       —— .session.execution.jsonl
 *   · { role, message:{ content:[…] } }         —— conversation-history/<id>.jsonl
 *   · { role, content:[…] }                     —— 同族变体
 *   · { session_id, … }                         —— 带会话归属的宽松形态
 */
function isQoderRecordShape(rec: Rec): boolean {
  if (Array.isArray(rec['parts'])) return true
  const message = asRec(rec['message'])
  if (message !== undefined && Array.isArray(message['content'])) return true
  if (typeof rec['role'] === 'string' && Array.isArray(rec['content'])) return true
  if (typeof rec['session_id'] === 'string') return true
  return false
}

/** 文件是否为 Qoder 会话（前若干行内出现 Qoder 记录特征） */
function looksLikeQoderSession(file: string): boolean {
  const head = readHeadText(file, 65536)
  let checked = 0
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
    if (isQoderRecordShape(rec)) return true
    if (++checked >= 3) break
  }
  return false
}

/* ============================================================
   记录 → 统一块（多形态容忍）
   ============================================================ */

function asRec(value: unknown): Rec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Rec)
    : undefined
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

/** 单条记录 parts[] → 统一块 + finishReason（Qoder 原生形态） */
function partsToBlocks(parts: unknown): { blocks: ContentBlock[]; finishReason?: string } {
  const blocks: ContentBlock[] = []
  let finishReason: string | undefined
  if (!Array.isArray(parts)) return { blocks }
  for (const item of parts) {
    const part = asRec(item)
    if (part === undefined) continue
    const data = asRec(part['data']) ?? {}
    switch (part['type']) {
      case 'text': {
        const text = data['text']
        if (typeof text === 'string' && text.trim() !== '') blocks.push({ type: 'text', text })
        break
      }
      case 'reasoning': {
        const thinking = data['thinking']
        if (typeof thinking === 'string' && thinking.trim() !== '') {
          blocks.push({ type: 'reasoning', text: thinking })
        }
        break
      }
      case 'tool_call': {
        const name = data['name']
        if (typeof name === 'string') {
          blocks.push({
            type: 'tool_call',
            tool: name,
            callId: typeof data['id'] === 'string' ? data['id'] : '',
            state: stringifyUnknown({ input: data['input'], finished: data['finished'] })
          })
        }
        break
      }
      case 'tool_result': {
        blocks.push({
          type: 'tool_result',
          callId: typeof data['tool_use_id'] === 'string' ? data['tool_use_id'] : '',
          output: stringifyUnknown(data['content'])
        })
        break
      }
      case 'finish': {
        if (typeof data['reason'] === 'string') finishReason = data['reason']
        break
      }
      default:
        break
    }
  }
  return finishReason !== undefined ? { blocks, finishReason } : { blocks }
}

/** 通用 content（string / [{type,text}]）→ 统一块（兼容非 Qoder 原生形态） */
function genericContentToBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    return content.trim() === '' ? [] : [{ type: 'text', text: content }]
  }
  if (!Array.isArray(content)) return []
  const blocks: ContentBlock[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.trim() !== '') blocks.push({ type: 'text', text: item })
      continue
    }
    const rec = asRec(item)
    if (rec === undefined) continue
    const type = typeof rec['type'] === 'string' ? rec['type'] : ''
    const text = rec['text'] ?? rec['thinking']
    switch (type) {
      case 'text':
      case 'input_text':
      case 'output_text':
      case 'reasoning':
      case 'thinking': {
        if (typeof text === 'string' && text.trim() !== '') {
          blocks.push(type === 'reasoning' || type === 'thinking' ? { type: 'reasoning', text } : { type: 'text', text })
        }
        break
      }
      case 'tool_call':
      case 'tool_use': {
        const name = rec['name'] ?? rec['tool']
        blocks.push({
          type: 'tool_call',
          tool: typeof name === 'string' ? name : '',
          callId: typeof rec['id'] === 'string' ? rec['id'] : '',
          state: stringifyUnknown(rec['input'] ?? rec['arguments'])
        })
        break
      }
      case 'tool_result': {
        blocks.push({
          type: 'tool_result',
          callId: typeof rec['tool_use_id'] === 'string' ? rec['tool_use_id'] : '',
          output: stringifyUnknown(rec['content'])
        })
        break
      }
      default: {
        // 无 type 但带 text 的宽松兜底
        if (typeof text === 'string' && text.trim() !== '') blocks.push({ type: 'text', text })
        break
      }
    }
  }
  return blocks
}

interface QoderRecord {
  id?: string
  role?: string
  type?: string
  parts?: unknown
  content?: unknown
  message?: unknown
  model?: string
  created_at?: number
  provider?: string
  is_meta?: boolean
}

/**
 * 记录 → 统一块（统一入口，容忍四种形态）：
 *   1) { parts:[…] }                    —— .session.execution.jsonl
 *   2) { message:{ content:[…] } }      —— conversation-history/<id>.jsonl
 *   3) { content:[…] }                  —— 通用形态
 *   4) { message:"…" }                  —— 纯文本兜底
 */
function recordBlocks(rec: Rec): { blocks: ContentBlock[]; finishReason?: string } {
  const fromParts = partsToBlocks(rec['parts'])
  if (fromParts.blocks.length > 0 || fromParts.finishReason !== undefined) return fromParts
  const message = asRec(rec['message'])
  if (message !== undefined) {
    const nested = genericContentToBlocks(message['content'])
    if (nested.length > 0) return { blocks: nested }
  }
  const direct = genericContentToBlocks(rec['content'])
  if (direct.length > 0) return { blocks: direct }
  if (typeof rec['message'] === 'string' && rec['message'].trim() !== '') {
    return { blocks: [{ type: 'text', text: rec['message'] }] }
  }
  return { blocks: [] }
}

/**
 * 用户消息正文清洗：Qoder IDE 会把真实提问包在 `<user_query>` 内，
 * 并在前面塞 `<system-reminder>` 等注入块——客户端只展示 query 本身。
 */
export function cleanUserText(text: string): string {
  const query = /<user_query>([\s\S]*?)<\/user_query>/.exec(text)
  if (query !== null && query[1] !== undefined && query[1].trim() !== '') return query[1].trim()
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?user_query>/g, '')
    .trim()
}

/** 用户消息块清洗（仅文本块走 cleanUserText，其余原样） */
function cleanUserBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = cleanUserText(block.text)
      if (text !== '') out.push({ type: 'text', text })
    } else {
      out.push(block)
    }
  }
  return out
}

/** 取块列表中首个文本块的文本 */
function firstText(blocks: ContentBlock[]): string {
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim() !== '') return block.text
  }
  return ''
}

/** 归一化记录角色（兼容 role / type 两种字段） */
function recordRole(rec: QoderRecord): 'user' | 'assistant' | 'tool' | undefined {
  const raw = typeof rec.role === 'string' ? rec.role : typeof rec.type === 'string' ? rec.type : ''
  switch (raw) {
    case 'user':
    case 'human':
      return 'user'
    case 'assistant':
    case 'ai':
    case 'model':
      return 'assistant'
    case 'tool':
    case 'tool_result':
      return 'tool'
    default:
      return undefined
  }
}

/* ============================================================
   Reader
   ============================================================ */

interface DiscoveredSession {
  extId: string
  jsonl: string
  /** 是否来自 conversation-history/<id>/<id>.jsonl（同一会话的轻量副本） */
  isConversationHistory: boolean
  metaPath?: string
}

/**
 * Qoder 同一会话可能有两份落盘：完整的 `.session.execution.jsonl`（含工具调用）与
 * 轻量的 `conversation-history/<短id>/<短id>.jsonl`（仅文本）。短 id 通常是完整 id 的前缀，
 * 此时保留**更完整的 execution 版本**，避免同一会话在列表里重复出现。
 */
function dedupeHistoryAgainstExecution(sessions: DiscoveredSession[]): DiscoveredSession[] {
  const executionIds = sessions
    .filter((s) => s.extId.endsWith('.session.execution'))
    .map((s) => s.extId)
  if (executionIds.length === 0) return sessions
  return sessions.filter((s) => {
    if (!s.isConversationHistory) return true
    return !executionIds.some((id) => id.length > s.extId.length && id.startsWith(s.extId))
  })
}

/** 扫描结果短时缓存（避免 detectSources 的 isAvailable + listSessions 重复整树扫描） */
const DISCOVERY_TTL_MS = 2000

export class QoderReader implements ReaderAdapter {
  readonly source = 'qoder' as const
  /** 显式传入时只用该根（测试/覆盖）；否则用发现的全部候选根 */
  private readonly explicitRoot: string | undefined
  private readonly fileIndex = new Map<string, string>()
  private readonly metaIndex = new Map<string, string>()
  private cache: { at: number; sessions: DiscoveredSession[] } | null = null

  constructor(home?: string) {
    this.explicitRoot = home
  }

  private roots(): string[] {
    return this.explicitRoot !== undefined ? [this.explicitRoot] : resolveQoderRoots()
  }

  /** 有界扫描全部候选根，识别 Qoder 会话（内容特征排除其它 Agent） */
  private discover(useCache = true): DiscoveredSession[] {
    if (useCache && this.cache !== null && Date.now() - this.cache.at < DISCOVERY_TTL_MS) {
      return this.cache.sessions
    }
    const sessions: DiscoveredSession[] = []
    const usedIds = new Set<string>()
    for (const root of this.roots()) {
      if (!existsSync(root)) continue
      for (const jsonl of collectJsonlFiles(root)) {
        const base = jsonl.slice(0, -JSONL_SUFFIX.length)
        const extId = base.split(/[\\/]/).pop() ?? ''
        if (extId === '') continue
        if (usedIds.has(extId)) continue
        const head = readHeadText(jsonl, 65536)
        if (head.trim() === '') continue
        // 内容识别：排除其它 Agent；非强签名文件还需正向匹配 Qoder 记录特征
        if (looksLikeForeignAgent(head)) continue
        const strongName = extId.endsWith('.session.execution')
        if (!strongName && !looksLikeQoderSession(jsonl)) continue
        const metaPath = `${base}${META_SUFFIX}`
        usedIds.add(extId)
        sessions.push({
          extId,
          jsonl,
          isConversationHistory: jsonl.includes(`conversation-history`),
          ...(existsSync(metaPath) ? { metaPath } : {})
        })
      }
    }
    const deduped = dedupeHistoryAgainstExecution(sessions)
    this.cache = { at: Date.now(), sessions: deduped }
    return deduped
  }

  /** 从 JSONL 头部推导标题（元数据缺失时的兜底） */
  private titleFromHead(jsonl: string): string | undefined {
    const head = readHeadText(jsonl, 65536)
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
      if (recordRole(rec as QoderRecord) !== 'user') continue
      const text = cleanUserText(firstText(recordBlocks(rec).blocks))
      if (text.trim() !== '') return text.replace(/\s+/g, ' ').trim().slice(0, 80)
    }
    return undefined
  }

  async isAvailable(): Promise<ReaderAvailability> {
    const existing = this.roots().filter((root) => existsSync(root))
    if (existing.length === 0) {
      return {
        available: false,
        detail: `未找到 Qoder 目录（已探测 ${this.roots().length} 个候选路径）`,
        unavailableReason: 'no_data'
      }
    }
    const sessions = this.discover()
    return sessions.length > 0
      ? { available: true, detail: `发现 ${sessions.length} 个会话于 ${existing.join(' / ')}` }
      : {
          available: false,
          detail: `Qoder 目录存在但未发现会话: ${existing.join(' / ')}`,
          unavailableReason: 'no_data'
        }
  }

  async listSessions(): Promise<RawSessionRef[]> {
    const refs: RawSessionRef[] = []
    this.fileIndex.clear()
    this.metaIndex.clear()
    for (const session of this.discover()) {
      this.fileIndex.set(session.extId, session.jsonl)
      if (session.metaPath !== undefined) this.metaIndex.set(session.extId, session.metaPath)
      let st
      try {
        st = statSync(session.jsonl)
      } catch {
        continue
      }
      const meta = this.readMeta(session.metaPath)
      const title =
        meta?.title !== undefined && meta.title !== ''
          ? meta.title
          : this.titleFromHead(session.jsonl)
      const updatedAt = meta?.updated_at ?? st.mtimeMs
      refs.push({
        source: this.source,
        extId: session.extId,
        updatedAt,
        ...(title !== undefined && title !== '' ? { titleHint: title } : {}),
        ...(meta?.working_dir !== undefined && meta.working_dir !== ''
          ? { directory: meta.working_dir }
          : {}),
        ...(meta?.created_at !== undefined ? { startedAt: meta.created_at } : {}),
        sizeHint: st.size
      })
    }
    return refs.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
    let jsonl = this.fileIndex.get(ref.extId)
    if (jsonl === undefined) {
      // 索引未命中：绕缓存重新发现一次（会话可能在 listSessions 之后新增）
      const found = this.discover(false).find((s) => s.extId === ref.extId)
      jsonl = found?.jsonl
    }
    if (jsonl === undefined || !existsSync(jsonl)) {
      throw new Error(`Qoder 会话文件不存在: ${ref.extId}`)
    }

    /** 缓冲中的 assistant 消息：其后紧跟的 tool 记录合并为同一消息 */
    let pending: RawMessage | null = null
    const flush = function* (): Generator<RawMessage> {
      if (pending !== null) {
        yield pending
        pending = null
      }
    }

    for await (const raw of readJsonl(jsonl)) {
      const rec = asRec(raw) as QoderRecord | undefined
      if (rec === undefined) continue
      if (rec.is_meta === true) continue

      const role = recordRole(rec)
      const { blocks, finishReason } = recordBlocks(rec as Rec)
      const merged = role === 'user' ? cleanUserBlocks(blocks) : blocks
      if (merged.length === 0 && finishReason === undefined) continue

      const sentAt = typeof rec.created_at === 'number' ? rec.created_at : Date.now()

      if (role === 'tool') {
        // 工具结果并入当前 assistant 消息；无缓冲则独立成条（保守兜底）
        if (pending !== null) {
          pending.blocks.push(...merged)
        } else {
          yield {
            sessionId: ref.extId,
            role: 'assistant',
            agentName: 'Qoder',
            sentAt,
            blocks: merged
          }
        }
        continue
      }
      if (role === undefined) continue

      yield* flush()
      const msg: RawMessage = {
        sessionId: ref.extId,
        role: role === 'assistant' ? 'assistant' : 'user',
        agentName: 'Qoder',
        sentAt,
        ...(typeof rec.model === 'string' && rec.model !== '' ? { modelName: rec.model } : {}),
        ...(typeof rec.provider === 'string' && rec.provider !== '' ? { provider: rec.provider } : {}),
        ...(finishReason !== undefined ? { finishReason } : {}),
        blocks: merged
      }
      if (msg.role === 'assistant') pending = msg
      else yield msg
    }
    yield* flush()
  }

  /** 读取会话元数据 JSON（缺省/损坏返回 undefined，不阻断列表） */
  private readMeta(metaPath: string | undefined): QoderMeta | undefined {
    if (metaPath === undefined) return undefined
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown
      const rec = asRec(parsed)
      if (rec === undefined) return undefined
      // 兼容命名差异：working_dir / workdir / cwd、updated_at / updatedAt
      const title = typeof rec['title'] === 'string' ? rec['title'] : undefined
      const dir =
        typeof rec['working_dir'] === 'string'
          ? rec['working_dir']
          : typeof rec['workdir'] === 'string'
            ? rec['workdir']
            : typeof rec['cwd'] === 'string'
              ? rec['cwd']
              : undefined
      const created =
        typeof rec['created_at'] === 'number'
          ? rec['created_at']
          : typeof rec['createdAt'] === 'number'
            ? rec['createdAt']
            : undefined
      const updated =
        typeof rec['updated_at'] === 'number'
          ? rec['updated_at']
          : typeof rec['updatedAt'] === 'number'
            ? rec['updatedAt']
            : undefined
      return { title, working_dir: dir, created_at: created, updated_at: updated }
    } catch {
      return undefined
    }
  }
}

interface QoderMeta {
  title?: string
  working_dir?: string
  created_at?: number
  updated_at?: number
}

/** 便捷工厂（registry 惰性加载入口） */
export function createQoderReader(home?: string): QoderReader {
  return new QoderReader(home)
}
