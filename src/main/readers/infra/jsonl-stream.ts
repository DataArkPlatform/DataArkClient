/**
 * JSONL 流式逐行解析基建
 *
 * - 基于 fs.createReadStream + readline，按行流式产出，适合大会话文件
 * - 容忍末尾残缺行（readline 会产出无换行的尾部行，解析失败时仅告警跳过）
 * - .gz / .zst 压缩支持留待后续里程碑（Codex 适配器），本期不做
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

export interface JsonlStreamOptions {
  onError?: (line: number, error: unknown) => void
}

/** 逐行读取 JSONL 文件，产出解析后的对象 */
export async function* readJsonl(
  filePath: string,
  options: JsonlStreamOptions = {}
): AsyncGenerator<unknown> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const line of rl) {
      lineNumber += 1
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        yield JSON.parse(trimmed) as unknown
      } catch (error) {
        options.onError?.(lineNumber, error)
      }
    }
  } finally {
    stream.destroy()
  }
}
