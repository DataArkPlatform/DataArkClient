/**
 * 处理钩子链 —— 归一化后、写库前的可插拔变换
 *
 * 本期内置 'redact'(脱敏) 与 'standardize'(标准化) 为空实现（恒等透传），
 * 但管线已贯通：后续里程碑只需 registerHook() 即可无侵入插入真实处理器。
 */
import type { Message } from '../../shared/unified-model'

export interface HookContext {
  source: string
  sessionId: string
  seq: number
}

export interface PipelineHook {
  name: string
  /** 返回 null 表示丢弃该消息（拦截） */
  transformMessage?: (msg: Message, ctx: HookContext) => Message | null
}

/** 内置：脱敏（本期恒等透传，占位） */
export const redactHook: PipelineHook = {
  name: 'redact',
  transformMessage: (msg) => msg
}

/** 内置：标准化（本期恒等透传，占位） */
export const standardizeHook: PipelineHook = {
  name: 'standardize',
  transformMessage: (msg) => msg
}

let hooks: PipelineHook[] = [redactHook, standardizeHook]

/** 注册钩子（可重复注册同名钩子，按注册顺序执行）；返回注销函数 */
export function registerHook(hook: PipelineHook): () => void {
  hooks.push(hook)
  return () => {
    hooks = hooks.filter((h) => h !== hook)
  }
}

/** 注销指定名称的钩子 */
export function unregisterHook(name: string): void {
  hooks = hooks.filter((h) => h.name !== name)
}

/** 重置为内置钩子（用于测试与进程级重置） */
export function resetHooks(): void {
  hooks = [redactHook, standardizeHook]
}

/** 当前钩子链（按执行顺序） */
export function listHooks(): string[] {
  return hooks.map((h) => h.name)
}

/**
 * 沿钩子链依次变换消息；任一步返回 null 则整条丢弃。
 * 顺序：normalize → [redact] → [standardize] → 其他注册钩子 → index
 */
export function applyHooks(msg: Message, ctx: HookContext): Message | null {
  let current: Message = msg
  for (const hook of hooks) {
    if (!hook.transformMessage) continue
    const next = hook.transformMessage(current, ctx)
    if (next === null) return null
    current = next
  }
  return current
}
