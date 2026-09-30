/**
 * Agent 统一配置源 —— 支持的数据源清单与展示元数据的唯一定义处。
 *
 * 新增 Agent 三步：readers/<agent>/ 实现适配器 → registry 注册 → 在 AGENT_DEFS 增加一行。
 * 说明：不做成运行时 JSON 配置——适配器本身是代码注册的，运行时配置无法增减能力；
 *      统一为编译期单一来源，可同时驱动主进程 / 渲染层 / 设置页 / 扫描页。
 */
export const AGENT_SOURCES = [
  'opencode',
  'codex',
  'claude-code',
  'copilot',
  'gemini-cli',
  'qoder',
  'deepseek-harness'
] as const

export type AgentSourceId = (typeof AGENT_SOURCES)[number]

export interface AgentDef {
  source: AgentSourceId
  /** 展示名（设置页/扫描胶囊/列表徽标共用） */
  label: string
  /** 圆点/头像底色（Figma 仅定 opencode 蓝，其余为品牌近似占位） */
  color: string
  /** 存储位置提示（设置页勾选行 title 用） */
  hint: string
}

export const AGENT_DEFS: readonly AgentDef[] = [
  { source: 'opencode', label: 'OpenCode', color: '#2678F6', hint: '~/.local/share/opencode' },
  { source: 'codex', label: 'Codex', color: '#10A37F', hint: 'Codex CLI 会话' },
  { source: 'claude-code', label: 'Claude Code', color: '#D97757', hint: '~/.claude/projects JSONL' },
  { source: 'copilot', label: 'Copilot', color: '#8952E0', hint: 'VS Code Copilot Chat' },
  { source: 'gemini-cli', label: 'Gemini CLI', color: '#4285F4', hint: 'Gemini CLI 会话' },
  { source: 'qoder', label: 'Qoder', color: '#6D5EF6', hint: 'Qoder CLI/IDE 会话' },
  { source: 'deepseek-harness', label: 'DeepSeek Harness', color: '#4D6BFE', hint: '~/.dsh/sessions' }
]

export function agentDefOf(source: string): AgentDef | undefined {
  return AGENT_DEFS.find((d) => d.source === source)
}