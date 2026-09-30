/**
 * 数据源展示映射 —— 标签/圆点色统一取自 shared/agents.ts（单一配置源）
 */
import { AGENT_DEFS, agentDefOf } from '../../../shared/agents'
import type { AgentSource } from '../../../shared/unified-model'
import opencodeIcon from '../assets/platforms/opencode.svg'
import codexIcon from '../assets/platforms/codex.png'
import claudeIcon from '../assets/platforms/claude.svg'
import copilotIcon from '../assets/platforms/copilot.png'
import geminiIcon from '../assets/platforms/gemini.png'
import qoderIcon from '../assets/platforms/qoder.svg'
import deepseekIcon from '../assets/platforms/deepseek.svg'

export const SOURCE_LABELS = Object.fromEntries(
  AGENT_DEFS.map((d) => [d.source, d.label])
) as Record<AgentSource, string>

export const SOURCE_COLORS = Object.fromEntries(
  AGENT_DEFS.map((d) => [d.source, d.color])
) as Record<AgentSource, string>

/** 未知源兜底 */
export function sourceLabel(source: string): string {
  return agentDefOf(source)?.label ?? source
}

export function sourceColor(source: string): string {
  return agentDefOf(source)?.color ?? '#b3b3b3'
}

/* ---- 平台图标（Figma 1914:226 胶囊；扫描胶囊 / 头像 / 日志色块等可复用） ---- */

/** 各源 20px 平台 logo（彩色 PNG 直用；黑白 SVG 深色主题需 CSS filter 反白） */
export const SOURCE_ICONS: Record<AgentSource, string> = {
  opencode: opencodeIcon,
  codex: codexIcon,
  'claude-code': claudeIcon,
  copilot: copilotIcon,
  'gemini-cli': geminiIcon,
  qoder: qoderIcon,
  'deepseek-harness': deepseekIcon
}

/** 纯黑单色图标（深色主题下用 invert 反白，见 scan.css） */
const MONO_ICON_SOURCES: ReadonlySet<string> = new Set(['opencode', 'qoder', 'deepseek-harness'])

/** 平台图标路径；未知源返回 undefined（调用方回退到圆点） */
export function sourceIcon(source: string): string | undefined {
  return agentDefOf(source) ? SOURCE_ICONS[source as AgentSource] : undefined
}

/** 该源图标是否为纯黑单色（需深色反白） */
export function isSourceIconMono(source: string): boolean {
  return MONO_ICON_SOURCES.has(source)
}