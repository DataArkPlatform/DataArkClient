import type { ReactNode } from 'react'

/**
 * 关键词高亮：按 query（忽略大小写）切分文本，命中片段包 <mark>。
 * query 为空返回原文；正则特殊字符自动转义。
 */
export function highlightText(
  text: string,
  query: string,
  keyPrefix = 'hl'
): ReactNode[] {
  const q = query.trim()
  if (q.length === 0) return [text]
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  return text.split(re).map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={`${keyPrefix}-${i}`} className="da-search-mark">
        {part}
      </mark>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  )
}
