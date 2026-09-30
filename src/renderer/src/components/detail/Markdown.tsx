/**
 * 轻量 Markdown 渲染器（M5 手写实现，零依赖）。
 *
 * 覆盖 MUST DO 要求的子集：段落 / **加粗** / `行内代码` / 列表 / 链接 / 标题 /
 * 引用 / 分割线 / 代码围栏（交给 CodeBlock 渲染）。
 * 未识别的结构一律按纯文本输出，保证内容无丢失（防御性兜底）。
 */
import { Fragment, memo, type ReactNode } from 'react'
import { CodeBlock } from './CodeBlock'

interface MarkdownProps {
  text: string
}

const FENCE_RE = /^(`{3,}|~{3,})(\w*)\s*$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE_RE = /^>\s?(.*)$/
const UL_RE = /^\s*[-*+]\s+(.*)$/
const OL_RE = /^\s*\d+[.)]\s+(.*)$/

/** 行内 token：加粗 / 行内代码 / 链接（捕获组使 split 保留命中项） */
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]]*\]\([^)\s]+\))/g
const LINK_RE = /^\[([^\]]*)\]\(([^)\s]+)\)$/

/** 链接协议白名单：仅放行 http/https/mailto，其余（file:/data:/javascript: 等）降级为纯文本 —— 防 ShellExecute 执行本地文件 */
const SAFE_HREF_RE = /^(https?:\/\/|mailto:)/i

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_RE).map((tok, i) => {
    if (tok.length > 4 && tok.startsWith('**') && tok.endsWith('**')) {
      return <strong key={i}>{renderInline(tok.slice(2, -2))}</strong>
    }
    if (tok.length > 2 && tok.startsWith('`') && tok.endsWith('`')) {
      return <code key={i}>{tok.slice(1, -1)}</code>
    }
    const m = LINK_RE.exec(tok)
    if (m !== null && SAFE_HREF_RE.test(m[2])) {
      return (
        <a key={i} href={m[2]} target="_blank" rel="noreferrer">
          {renderInline(m[1])}
        </a>
      )
    }
    return <Fragment key={i}>{tok}</Fragment>
  })
}

function Heading({ level, children }: { level: number; children: ReactNode }): React.JSX.Element {
  switch (level) {
    case 1:
      return <h1>{children}</h1>
    case 2:
      return <h2>{children}</h2>
    case 3:
      return <h3>{children}</h3>
    case 4:
      return <h4>{children}</h4>
    case 5:
      return <h5>{children}</h5>
    default:
      return <h6>{children}</h6>
  }
}

function parseBlocks(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // 代码围栏
    const fence = FENCE_RE.exec(line)
    if (fence !== null) {
      const lang = fence[2]
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i])
        i += 1
      }
      i += 1 // 跳过闭合围栏（或文件尾）
      out.push(<CodeBlock key={key++} lang={lang} code={codeLines.join('\n')} />)
      continue
    }

    // 标题
    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      out.push(
        <Heading key={key++} level={heading[1].length}>
          {renderInline(heading[2])}
        </Heading>
      )
      i += 1
      continue
    }

    // 分割线
    if (HR_RE.test(line)) {
      out.push(<hr key={key++} />)
      i += 1
      continue
    }

    // 引用
    if (QUOTE_RE.test(line)) {
      const quote: string[] = []
      while (i < lines.length) {
        const q = QUOTE_RE.exec(lines[i])
        if (q === null) break
        quote.push(q[1])
        i += 1
      }
      out.push(<blockquote key={key++}>{renderInline(quote.join(' '))}</blockquote>)
      continue
    }

    // 有序 / 无序列表（连续行合并为一个 list）
    const ordered = OL_RE.test(line)
    if (ordered || UL_RE.test(line)) {
      const re = ordered ? OL_RE : UL_RE
      const items: ReactNode[] = []
      while (i < lines.length) {
        const m = re.exec(lines[i])
        if (m === null) break
        items.push(<li key={items.length}>{renderInline(m[1])}</li>)
        i += 1
      }
      out.push(
        ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>
      )
      continue
    }

    // 段落：连续非空且非特殊行
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE_RE.test(lines[i]) &&
      !HEADING_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !OL_RE.test(lines[i]) &&
      !UL_RE.test(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    if (para.length > 0) {
      out.push(<p key={key++}>{renderInline(para.join('\n'))}</p>)
    } else {
      i += 1 // 空行
    }
  }

  return out
}

/** memo：会话内容静态，父组件状态变化（收藏/弹层）不应触发整篇重解析 */
export const Markdown = memo(function Markdown({ text }: MarkdownProps): React.JSX.Element {
  return <div className="da-md">{parseBlocks(text)}</div>
})
