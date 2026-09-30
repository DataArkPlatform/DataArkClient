/**
 * GitHub Copilot Chat 适配器 —— VS Code Copilot Chat session-store.db
 *
 * 路径：<应用数据根>/<VS Code 变体>/User/globalStorage/github.copilot-chat/session-store.db
 *   - Windows: %APPDATA%\Code\...
 *   - macOS:   ~/Library/Application Support/Code/...
 * COPILOT_HOME 环境变量覆盖（指向包含 session-store.db 的目录）。
 *
 * 结构（本机 v3 实测）：sessions(id,cwd,summary,created_at,updated_at,...)
 *                      turns(session_id,turn_index,user_message,assistant_response,timestamp)
 * - 每 turn 产出 user + assistant 两条消息（纯文本块）
 * - 只读策略：openRo 直读，永不写源库
 * - 未覆盖（后续版本）：workspaceStorage chatSessions JSON、checkpoints
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { coerceTimestamp, type RawMessage, type RawSessionRef } from '../../../shared/unified-model'
import type { ReaderAdapter, ReaderAvailability } from '../types'
import { openRo, type RoDatabase } from '../infra/ro-sqlite'
import { appDataDir } from '../infra/app-data'

/**
 * 在 `<base>/<任意应用名>/User/globalStorage/<任意包含 copilot 的扩展目录>/session-store.db` 中查找。
 * 用**通配发现**替代固定清单：VS Code / Insiders / VSCodium / Cursor / Windsurf / 未来新变体
 * 都能被覆盖，无需逐个登记。
 */
function globStores(base: string): Array<{ path: string; mtime: number }> {
  const out: Array<{ path: string; mtime: number }> = []
  let apps: string[]
  try {
    apps = readdirSync(base)
  } catch {
    return out
  }
  for (const app of apps) {
    const globalStorage = join(base, app, 'User', 'globalStorage')
    let extensions: string[]
    try {
      extensions = readdirSync(globalStorage)
    } catch {
      continue
    }
    for (const extension of extensions) {
      if (!extension.toLowerCase().includes('copilot')) continue
      const candidate = join(globalStorage, extension, 'session-store.db')
      if (!existsSync(candidate)) continue
      try {
        out.push({ path: candidate, mtime: statSync(candidate).mtimeMs })
      } catch {
        /* 读取失败忽略 */
      }
    }
  }
  return out
}

/** 便携版安装：`<程序目录>/<应用>/data/user-data/User/globalStorage/<扩展>/session-store.db` */
function globPortableStores(localAppData: string): Array<{ path: string; mtime: number }> {
  const programs = join(localAppData, 'Programs')
  let apps: string[]
  try {
    apps = readdirSync(programs)
  } catch {
    return []
  }
  const out: Array<{ path: string; mtime: number }> = []
  for (const app of apps) {
    out.push(...globStores(join(programs, app, 'data', 'user-data')))
  }
  return out
}

/**
 * 解析 session-store.db 路径。
 * 优先级：COPILOT_HOME 环境变量 → 应用数据目录下的通配发现 → 便携版安装目录 →
 * 默认 Code 路径兜底。多个候选并存时取**最近修改**者（即用户最近在用的那个变体）。
 * env / appData / localAppData 可注入，便于跨平台单测。
 */
export function resolveStorePath(
  env: NodeJS.ProcessEnv = process.env,
  appData: string = appDataDir(),
  localAppData: string | undefined = env['LOCALAPPDATA']
): string {
  const envHome = env['COPILOT_HOME']
  if (envHome !== undefined && envHome !== '') {
    return join(envHome, 'session-store.db')
  }

  const candidates: Array<{ path: string; mtime: number }> = [...globStores(appData)]
  if (localAppData !== undefined && localAppData !== '') {
    candidates.push(...globPortableStores(localAppData))
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.mtime - a.mtime)
    return candidates[0]!.path
  }

  // 兜底：标准 VS Code 稳定版路径（可能不存在，用于给出可读的「未检测到」提示）
  return join(appData, 'Code', 'User', 'globalStorage', 'github.copilot-chat', 'session-store.db')
}

/** 读取统计（对账归因用） */
export interface CopilotReadStats {
  sessionsRead: number
  turnsSeen: number
  messagesYielded: number
}

interface SessionRow {
  id: string
  summary: string | null
  cwd: string | null
  created_at: string | null
  updated_at: string | null
}

interface TurnRow {
  id: number
  turn_index: number
  user_message: string | null
  assistant_response: string | null
  timestamp: string | null
}

function hasTable(db: RoDatabase['db'], name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | undefined
  return row !== undefined
}

export class CopilotReader implements ReaderAdapter {
  readonly source = 'copilot' as const
  private readonly dbPath: string
  private readonly stats: CopilotReadStats = { sessionsRead: 0, turnsSeen: 0, messagesYielded: 0 }

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? resolveStorePath()
  }

  readSessionStats(): CopilotReadStats {
    return { ...this.stats }
  }

  async isAvailable(): Promise<ReaderAvailability> {
    if (!existsSync(this.dbPath)) {
      return { available: false, detail: `会话库不存在: ${this.dbPath}`, unavailableReason: 'no_data' }
    }
    let ro: RoDatabase
    try {
      ro = await openRo(this.dbPath, { retries: 0 })
    } catch (error) {
      return {
        available: false,
        detail: `打开失败: ${error instanceof Error ? error.message : String(error)}`,
        unavailableReason: 'access_denied'
      }
    }
    try {
      if (hasTable(ro.db, 'sessions') && hasTable(ro.db, 'turns')) {
        return { available: true, detail: this.dbPath }
      }
      return { available: false, detail: `缺少 sessions/turns 表: ${this.dbPath}`, unavailableReason: 'corrupted' }
    } finally {
      ro.close()
    }
  }

  async listSessions(): Promise<RawSessionRef[]> {
    const ro = await openRo(this.dbPath)
    try {
      const rows = ro.db
        .prepare(
          `SELECT id, summary, cwd, created_at, updated_at
           FROM sessions
           ORDER BY COALESCE(updated_at, created_at) DESC`
        )
        .all() as SessionRow[]
      // 每会话内容字节量（user_message + assistant_response 之和）→ sizeHint：进度按数据量加权
      const weightRows = ro.db
        .prepare(
          `SELECT session_id AS sid,
                  SUM(LENGTH(COALESCE(user_message, '')) + LENGTH(COALESCE(assistant_response, ''))) AS bytes
           FROM turns GROUP BY session_id`
        )
        .all() as Array<{ sid: string; bytes: number | null }>
      const weightMap = new Map(weightRows.map((r) => [r.sid, r.bytes ?? 0]))
      return rows.map((row) => {
        const updated = coerceTimestamp(row.updated_at ?? row.created_at ?? undefined) ?? 0
        const started = coerceTimestamp(row.created_at ?? undefined)
        return {
          source: this.source,
          extId: row.id,
          updatedAt: updated,
          ...(row.summary !== null && row.summary !== '' ? { titleHint: row.summary } : {}),
          ...(row.cwd !== null ? { directory: row.cwd } : {}),
          ...(started !== undefined ? { startedAt: started } : {}),
          sizeHint: weightMap.get(row.id) ?? 0
        }
      })
    } finally {
      ro.close()
    }
  }

  async *readSession(ref: RawSessionRef): AsyncIterable<RawMessage> {
    const ro = await openRo(this.dbPath)
    try {
      const rows = ro.db
        .prepare(
          `SELECT turn_index, user_message, assistant_response, timestamp, id
           FROM turns WHERE session_id = ?
           ORDER BY turn_index ASC, id ASC`
        )
        .all(ref.extId) as TurnRow[]
      for (const row of rows) {
        this.stats.turnsSeen += 1
        const sentAt = coerceTimestamp(row.timestamp ?? undefined) ?? 0
        if (row.user_message !== null && row.user_message.trim() !== '') {
          this.stats.messagesYielded += 1
          yield {
            sessionId: ref.extId,
            role: 'user',
            agentName: 'GitHub Copilot Chat',
            sentAt,
            blocks: [{ type: 'text', text: row.user_message }]
          }
        }
        if (row.assistant_response !== null && row.assistant_response.trim() !== '') {
          this.stats.messagesYielded += 1
          yield {
            sessionId: ref.extId,
            role: 'assistant',
            agentName: 'GitHub Copilot Chat',
            sentAt,
            blocks: [{ type: 'text', text: row.assistant_response }]
          }
        }
      }
      this.stats.sessionsRead += 1
    } finally {
      ro.close()
    }
  }
}

/** 便捷工厂（registry 惰性加载入口） */
export function createCopilotReader(dbPath?: string): CopilotReader {
  return new CopilotReader(dbPath)
}