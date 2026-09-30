/**
 * 适配器注册表 —— 新 Agent = 新增一个 readers/<agent>/ 目录并注册
 */
import type { AgentSource } from '../../shared/unified-model'
import type { ReaderAdapter } from './types'
import type { UnavailableReason } from '../../shared/data-contract'

const readers = new Map<AgentSource, ReaderAdapter>()

export function registerReader(reader: ReaderAdapter): void {
  if (readers.has(reader.source)) {
    throw new Error(`Reader already registered for source "${reader.source}"`)
  }
  readers.set(reader.source, reader)
}

export function getReader(source: AgentSource): ReaderAdapter | undefined {
  return readers.get(source)
}

export function listReaders(): ReaderAdapter[] {
  return [...readers.values()]
}

export function resetReaders(): void {
  readers.clear()
}

/**
 * 惰性加载内置适配器并注册；测试可自行构造 Mock 适配器直接调用 ingestSource。
 * 未注册的源返回 unavailableReason: 'not_implemented'
 */
export async function loadReader(source: AgentSource): Promise<ReaderAdapter | { unavailableReason: UnavailableReason } | undefined> {
  const existing = getReader(source)
  if (existing) return existing
  switch (source) {
    case 'opencode': {
      const { createOpencodeReader } = await import('./opencode')
      const reader = createOpencodeReader()
      registerReader(reader)
      return reader
    }
    case 'codex': {
      const { createCodexReader } = await import('./codex')
      const reader = createCodexReader()
      registerReader(reader)
      return reader
    }
    case 'claude-code': {
      const { createClaudeCodeReader } = await import('./claude-code')
      const reader = createClaudeCodeReader()
      registerReader(reader)
      return reader
    }
    case 'copilot': {
      const { createCopilotReader } = await import('./copilot')
      const reader = createCopilotReader()
      registerReader(reader)
      return reader
    }
    case 'gemini-cli': {
      const { createGeminiCliReader } = await import('./gemini-cli')
      const reader = createGeminiCliReader()
      registerReader(reader)
      return reader
    }
    case 'qoder': {
      const { createQoderReader } = await import('./qoder')
      const reader = createQoderReader()
      registerReader(reader)
      return reader
    }
    case 'deepseek-harness': {
      const { createDeepSeekHarnessReader } = await import('./deepseek-harness')
      const reader = createDeepSeekHarnessReader()
      registerReader(reader)
      return reader
    }
    default:
      return { unavailableReason: 'not_implemented' }
  }
}
