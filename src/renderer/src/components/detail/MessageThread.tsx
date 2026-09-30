/**
 * 消息流（M5）—— user/assistant 气泡 + 8 类内容块渲染。
 * 块渲染规则见任务书：step_marker 完全跳过；compaction 居中分隔；
 * tool_result 独立卡片（v1 不与 tool_call 视觉合并）。
 */
import { useState } from 'react'
import type { ConversationMessage } from '../../../../shared/data-contract'
import type { ContentBlock } from '../../../../shared/unified-model'
import { useI18n, type I18nKey } from '../../stores/useI18n'
import { IconChevronDown, IconFile } from '../icons'
import { Markdown } from './Markdown'

export interface MessageThreadProps {
  messages: ConversationMessage[]
}

/** 角色行文案：user → 用户；assistant → agentName · modelName */
function roleLabel(msg: ConversationMessage, t: (key: I18nKey) => string): string {
  if (msg.role === 'user') return t('userRole')
  const parts = [msg.agentName, msg.modelName].filter((v): v is string => v !== null && v !== undefined)
  return parts.join(' · ') || 'Assistant'
}

export function MessageThread({ messages }: MessageThreadProps): React.JSX.Element {
  return (
    <div className="da-detail__thread">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} />
      ))}
    </div>
  )
}

function MessageBubble({ msg }: { msg: ConversationMessage }): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const isUser = msg.role === 'user'
  const cls = isUser ? 'da-msg da-msg--user' : 'da-msg da-msg--assistant'
  return (
    <div className={cls}>
      <div className="da-msg__role">{roleLabel(msg, t)}</div>
      <div className="da-msg__blocks">
        {msg.blocks.map((b, i) => (
          <BlockView key={`${msg.id}-${i}`} block={b} />
        ))}
      </div>
    </div>
  )
}

function BlockView({ block }: { block: ContentBlock }): React.JSX.Element | null {
  switch (block.type) {
    case 'text':
      return <Markdown text={block.text} />
    case 'reasoning':
      return <ReasoningBlock text={block.text} />
    case 'tool_call':
      return <ToolCallCard tool={block.tool} state={block.state} />
    case 'tool_result':
      return <ToolResultCard output={block.output} />
    case 'patch':
      return <PatchCard hash={block.hash} files={block.files} />
    case 'file_ref':
      return <FileRefRow filename={block.filename} mime={block.mime} />
    case 'step_marker':
      return null
    case 'compaction':
      return <CompactionDivider summary={block.summary} />
  }
}

/* ---- reasoning ---- */
function ReasoningBlock({ text }: { text: string }): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const [open, setOpen] = useState(false)
  return (
    <div className="da-reasoning">
      <button
        type="button"
        className="da-reasoning__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown
          className={open ? 'da-reasoning__chev da-reasoning__chev--open' : 'da-reasoning__chev'}
        />
        <span>{t('reasoningTitle')}</span>
      </button>
      {open && <div className="da-reasoning__body">{text}</div>}
    </div>
  )
}

/* ---- 工具调用 ---- */
type ToolStatus = 'completed' | 'error' | 'pending'

/** 解析工具 state JSON：completed=成功，error=失败，其余=进行中(琥珀) */
function toolStatus(state: string): ToolStatus {
  try {
    const parsed: unknown = JSON.parse(state)
    if (parsed !== null && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>
      const status = typeof rec.status === 'string' ? rec.status.toLowerCase() : ''
      if (status === 'completed' || status === 'done' || status === 'success') return 'completed'
      if (status === 'error' || status === 'failed' || status === 'cancelled') return 'error'
      if (status !== '') return 'pending'
    }
  } catch {
    /* 非 JSON，走字符串兜底 */
  }
  const hay = state.toLowerCase()
  if (hay.includes('"status":"completed"')) return 'completed'
  if (hay.includes('"status":"error"') || hay.includes('error')) return 'error'
  return 'pending'
}

/** state/output 美化：合法 JSON 对象 → 2 空格缩进；否则原样 */
function prettyState(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 2)
    }
  } catch {
    /* 不是 JSON */
  }
  return raw
}

function ToolCallCard({ tool, state }: { tool: string; state: string }): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const [open, setOpen] = useState(false)
  const status = toolStatus(state)
  return (
    <div className="da-toolcard">
      <button
        type="button"
        className="da-toolcard__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`da-toolcard__dot da-toolcard__dot--${status}`} aria-hidden="true" />
        <span className="da-toolcard__label">{t('toolCallLabel')}</span>
        <span className="da-toolcard__chip" title={tool}>
          {tool}
        </span>
        <span className="da-toolcard__chev">
          <IconChevronDown />
        </span>
      </button>
      {open && <pre className="da-toolcard__body">{prettyState(state)}</pre>}
    </div>
  )
}

/* ---- 工具结果（独立卡片，自动折叠显示前 3 行） ---- */
function ToolResultCard({ output }: { output: string }): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const [open, setOpen] = useState(false)
  const summary = output.split('\n').slice(0, 3).join('\n')
  return (
    <div className="da-toolcard">
      <button
        type="button"
        className="da-toolcard__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="da-toolcard__dot da-toolcard__dot--completed" aria-hidden="true" />
        <span className="da-toolcard__label">{t('toolOutput')}</span>
        <span className="da-toolcard__chev">
          <IconChevronDown />
        </span>
      </button>
      {open ? (
        <pre className="da-toolcard__body">{prettyState(output)}</pre>
      ) : (
        <pre className="da-toolcard__summary">{summary}</pre>
      )}
    </div>
  )
}

/* ---- patch ---- */
function PatchCard({ hash, files }: { hash: string | undefined; files: string[] }): React.JSX.Element {
  const t = useI18n((s) => s.t)
  return (
    <div className="da-patchcard">
      <div className="da-patchcard__head">
        {hash !== undefined && hash !== '' && (
          <span className="da-patchcard__hash" title={hash}>
            {hash}
          </span>
        )}
        <span className="da-patchcard__count">
          {files.length} {t('itemsUnit')}
        </span>
      </div>
      <ul className="da-patchcard__files">
        {files.map((f) => (
          <li key={f} className="da-patchcard__file">
            <IconFile size={13} />
            <span className="da-patchcard__file-name">{f}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---- file_ref ---- */
function FileRefRow({ filename, mime }: { filename: string; mime: string | undefined }): React.JSX.Element {
  return (
    <div className="da-fileref">
      <IconFile size={14} />
      <span className="da-fileref__name">{filename}</span>
      {mime !== undefined && mime !== '' && <span className="da-fileref__mime">{mime}</span>}
    </div>
  )
}

/* ---- compaction 分隔 ---- */
function CompactionDivider({ summary }: { summary: string | undefined }): React.JSX.Element {
  const t = useI18n((s) => s.t)
  return (
    <div className="da-compaction" role="separator">
      <span className="da-compaction__line" aria-hidden="true" />
      <span className="da-compaction__chip">
        {summary !== undefined && summary !== '' ? summary : t('contextCompacted')}
      </span>
      <span className="da-compaction__line" aria-hidden="true" />
    </div>
  )
}
