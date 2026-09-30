/**
 * export.ts —— 会话导出服务（M7）
 *
 * 两种格式：
 * - json：每会话一个 `${safeTitle}-${shortId}.json`，
 *   { meta: { id,title,source,directory,startedAt,updatedAt }, messages: [...] }
 * - markdown：每会话一个 `.md`，`# title` + 来源头 + 分角色段落；
 *   text/reasoning 原文，tool_call 折叠 JSON 块，tool_result 围栏块，patch/file 列文件，
 *   step_marker 跳过，compaction 仅在有摘要时输出一行说明。
 *
 * 写文件全部异步（fs/promises），DAO 读取为单会话粒度，不阻塞主进程事件循环。
 */
import type { Database as DatabaseType } from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ContentBlock } from '../../shared/unified-model'
import type { ExportResult } from '../../shared/data-contract'
import { createDaos } from '../db/dao'

/** 标题单行化：折叠所有空白（含换行）为单空格 —— 防止撑破 Markdown H1 / 文件名 */
function oneLine(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** 文件名非法字符 → 下划线；超长截断 80 字符 */
function sanitizeFileName(raw: string): string {
  const cleaned = oneLine(raw).replace(/[<>:"/\\|?*]/g, '_')
  if (cleaned.length === 0) return 'untitled'
  return cleaned.slice(0, 80)
}

/** 会话 id 前 8 位作为文件名唯一后缀 */
function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'x'
}

/** 生成不冲突的文件名（-2 / -3 后缀） */
function uniqueFileName(used: Set<string>, base: string, ext: string): string {
  let candidate = `${base}.${ext}`
  let n = 2
  while (used.has(candidate)) {
    candidate = `${base}-${n}.${ext}`
    n += 1
  }
  used.add(candidate)
  return candidate
}

/** 内容块 → Markdown 片段（text/reasoning 原文，其余结构化） */
function blockToMarkdown(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool_call': {
      const summary = `工具调用：${block.tool}`
      const payload = JSON.stringify(
        { tool: block.tool, callId: block.callId, state: block.state },
        null,
        2
      )
      return `<details>\n<summary>${summary}</summary>\n\n\`\`\`json\n${payload}\n\`\`\`\n</details>`
    }
    case 'tool_result':
      return '```text\n' + block.output + '\n```'
    case 'patch':
      if (block.files.length === 0) return '_（文件变更）_'
      return block.files.map((f) => `- 文件变更：${f}`).join('\n')
    case 'file_ref':
      return `- 文件引用：${block.filename}`
    case 'step_marker':
      return ''
    case 'compaction':
      return block.summary !== undefined ? `> 上下文压缩摘要：${block.summary}` : ''
  }
}

/** 单条消息 → Markdown 段落（标题 + 块内容） */
function messageToMarkdown(
  role: string,
  agentName: string | null,
  modelName: string | null,
  blocks: ContentBlock[]
): string {
  const heading =
    role === 'user'
      ? '## [用户]'
      : `## [${[agentName, modelName].filter((v) => v !== null && v !== undefined).join(' · ') || 'Assistant'}]`
  const parts = blocks.map(blockToMarkdown).filter((p) => p.length > 0)
  if (parts.length === 0) return heading
  return `${heading}\n\n${parts.join('\n\n')}`
}

/** 本地日期 YYYY-MM-DD（导出头「采集」日期用） */
function dateStamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 导出指定会话到目录。
 * 返回 { dir, written, failed }；failed 含「会话不存在/已删除/写入失败」。
 */
export async function exportConversationsToDir(
  db: DatabaseType,
  ids: string[],
  format: 'json' | 'markdown',
  outDir: string
): Promise<ExportResult> {
  const daos = createDaos(db)
  await fs.mkdir(outDir, { recursive: true })
  const used = new Set<string>()
  let written = 0
  let failed = 0
  let firstFile: string | undefined

  for (const id of ids) {
    const row = daos.sessions.getById(id)
    if (row === undefined || row.deletedAt !== null) {
      failed += 1
      continue
    }
    const messages = daos.messages.getMessages(id)
    const title = row.title !== null && row.title.trim().length > 0 ? row.title.trim() : '未命名会话'
    const base = `${sanitizeFileName(title)}-${shortId(row.id)}`

    try {
      let name: string
      if (format === 'json') {
        const payload = {
          meta: {
            id: row.id,
            title,
            source: row.source,
            directory: row.directory,
            startedAt: row.startedAt,
            updatedAt: row.updatedAt
          },
          messages: messages.map((m) => ({
            role: m.role,
            sentAt: m.sentAt,
            agentName: m.agentName,
            modelName: m.modelName,
            blocks: m.blocks
          }))
        }
        name = uniqueFileName(used, base, 'json')
        await fs.writeFile(join(outDir, name), JSON.stringify(payload, null, 2) + '\n', 'utf8')
      } else {
        const collectedAt = dateStamp(row.startedAt ?? row.updatedAt ?? Date.now())
        // 标题单行化：多行/含 #/< 的标题（如 Codex 的裸 XML）会破坏 H1 结构
        const heading = `# ${oneLine(title)}\n\n> 来源 ${row.source} · 采集 ${collectedAt}\n\n---\n`
        const body = messages
          .map((m) => messageToMarkdown(m.role, m.agentName, m.modelName, m.blocks))
          .join('\n\n')
        name = uniqueFileName(used, base, 'md')
        await fs.writeFile(join(outDir, name), `${heading}\n${body}\n`, 'utf8')
      }
      if (firstFile === undefined) firstFile = join(outDir, name)
      written += 1
    } catch {
      failed += 1
    }
  }

  return { dir: outDir, written, failed, ...(firstFile !== undefined ? { firstFile } : {}) }
}
