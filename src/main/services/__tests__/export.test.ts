/**
 * export 服务 —— JSON / Markdown 导出结构、文件名净化与去重
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTempDb, makeMockReader, type MockConversation } from '../../__tests__/helpers'
import { ingestSource } from '../../pipeline/ingest'
import { createDaos } from '../../db/dao'
import { exportConversationsToDir } from '../export'

function baseConv(extId: string, title: string): MockConversation {
  return {
    extId,
    title,
    directory: 'C:\\proj',
    updatedAt: 1_700_000_000_000,
    messages: [
      { role: 'user', sentAt: 1_700_000_000_000, blocks: [{ type: 'text', text: '帮我优化性能' }] },
      {
        role: 'assistant',
        sentAt: 1_700_000_000_100,
        agentName: 'primary',
        modelName: 'deepseek-v3',
        blocks: [
          { type: 'text', text: '建议用 React.memo' },
          { type: 'reasoning', text: '先看渲染路径' },
          { type: 'tool_call', tool: 'bash', callId: 'c1', state: '{"status":"running"}' },
          { type: 'tool_result', callId: 'c1', output: '10ms' },
          { type: 'patch', files: ['src/App.tsx', 'src/Row.tsx'] },
          { type: 'file_ref', filename: 'src/App.tsx' },
          { type: 'step_marker', phase: 'start' },
          { type: 'compaction', summary: '上下文已压缩' }
        ]
      }
    ]
  }
}

describe('exportConversationsToDir', () => {
  it('JSON：每会话一文件，meta + messages 结构正确', async () => {
    const temp = createTempDb()
    try {
      const report = await ingestSource(makeMockReader([baseConv('ses-1', '前端性能调优讨论')]), temp.db)
      expect(report.scannedNew).toBe(1)
      const daos = createDaos(temp.db)
      const row = daos.sessions.getByExtId('opencode', 'ses-1')
      expect(row).toBeDefined()
      const outDir = join(temp.dir, 'out-json')
      const result = await exportConversationsToDir(temp.db, [row!.id], 'json', outDir)
      expect(result).toMatchObject({ dir: outDir, written: 1, failed: 0 })
      expect(typeof result.firstFile).toBe('string')
      expect(readdirSync(outDir)).toContain(
        (result.firstFile ?? '').split('\\').pop()?.split('/').pop()
      )

      const files = readdirSync(outDir)
      expect(files).toHaveLength(1)
      expect(files[0]!).toMatch(/^前端性能调优讨论-.*\.json$/)
      const parsed = JSON.parse(readFileSync(join(outDir, files[0]!), 'utf8')) as {
        meta: { id: string; title: string; source: string; directory: string | null; startedAt: number | null; updatedAt: number | null }
        messages: Array<{ role: string; sentAt: number | null; blocks: Array<{ type: string }> }>
      }
      expect(parsed.meta.title).toBe('前端性能调优讨论')
      expect(parsed.meta.source).toBe('opencode')
      expect(parsed.meta.directory).toBe('C:\\proj')
      expect(parsed.messages).toHaveLength(2)
      expect(parsed.messages[0]!.role).toBe('user')
      expect(parsed.messages[1]!.blocks[0]).toEqual({ type: 'text', text: '建议用 React.memo' })
    } finally {
      temp.close()
    }
  })

  it('Markdown：标题头 + 分角色段落 + 各块类型渲染', async () => {
    const temp = createTempDb()
    try {
      const convs = [baseConv('ses-2', 'Vue3 源码分析')]
      await ingestSource(makeMockReader(convs), temp.db)
      const daos = createDaos(temp.db)
      const row = daos.sessions.getByExtId('opencode', 'ses-2')!
      const outDir = join(temp.dir, 'out-md')
      const result = await exportConversationsToDir(temp.db, [row.id], 'markdown', outDir)
      expect(result.written).toBe(1)

      const content = readFileSync(join(outDir, readdirSync(outDir)[0]!), 'utf8')
      expect(content).toContain('# Vue3 源码分析')
      expect(content).toContain('> 来源 opencode · 采集 ')
      expect(content).toContain('## [用户]')
      expect(content).toContain('## [primary · deepseek-v3]')
      expect(content).toContain('帮我优化性能')
      expect(content).toContain('建议用 React.memo')
      expect(content).toContain('先看渲染路径')
      // tool_call → 折叠 JSON 围栏块
      expect(content).toContain('<details>')
      expect(content).toContain('"tool": "bash"')
      // tool_result → text 围栏
      expect(content).toContain('```text\n10ms\n```')
      // patch → 文件清单
      expect(content).toContain('文件变更：src/App.tsx')
      expect(content).toContain('文件变更：src/Row.tsx')
      // file_ref → 文件引用
      expect(content).toContain('文件引用：src/App.tsx')
      // step_marker 跳过
      expect(content).not.toContain('step_marker')
      // compaction 有摘要 → 说明行
      expect(content).toContain('上下文压缩摘要：上下文已压缩')
    } finally {
      temp.close()
    }
  })

  it('文件名净化；同一会话重复导出触发 -2 去重后缀；已删除会话计入 failed', async () => {
    const temp = createTempDb()
    try {
      const convs = [baseConv('ses-3', '非法:字符/名\\称'), baseConv('ses-5', '将被删除')]
      await ingestSource(makeMockReader(convs), temp.db)
      const daos = createDaos(temp.db)
      const a = daos.sessions.getByExtId('opencode', 'ses-3')!
      const gone = daos.sessions.getByExtId('opencode', 'ses-5')!
      daos.trash.softDeleteSessions([gone.id])

      const outDir = join(temp.dir, 'out-san')
      // 同一会话导出两次 → 第二次文件名带 -2；已删除会话失败
      const result = await exportConversationsToDir(temp.db, [a.id, a.id, gone.id], 'json', outDir)
      expect(result).toMatchObject({ dir: outDir, written: 2, failed: 1 })
      expect(typeof result.firstFile).toBe('string')

      const files = readdirSync(outDir)
      expect(files).toHaveLength(2)
      // 非法字符被净化；重复导出命中去重后缀
      expect(files.some((f) => f.match(/^非法_字符_名_称-.*\.json$/))).toBe(true)
      expect(files.some((f) => f.includes('-2.'))).toBe(true)
    } finally {
      temp.close()
    }
  })
})
