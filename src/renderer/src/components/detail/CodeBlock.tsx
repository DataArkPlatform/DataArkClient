/**
 * 代码块（Figma F10）—— 容器 #F7F7F7 r8 p8：头部行（语言 chip + 复制图标钮）+ 分隔线 + 代码区。
 * 复制：点击写入剪贴板 → 图标临时变对勾，2s 后复位。
 */
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../stores/useI18n'
import { useToastStore } from '../../stores/useToastStore'
import { copyText } from '../../utils/clipboard'
import { IconCheck } from '../icons'
import copyIcon from '../../assets/icons/copy.svg'

export interface CodeBlockProps {
  /** 语言标签；空串则不显示 chip */
  lang?: string
  code: string
}

const COPIED_MS = 2000

export function CodeBlock({ lang = '', code }: CodeBlockProps): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const toast = useToastStore((s) => s)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const handleCopy = (): void => {
    copyText(code)
      .then(() => {
        setCopied(true)
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
      })
      .catch(() => toast.error(t('copyFailed')))
  }

  return (
    <div className="da-codeblock">
      <div className="da-codeblock__head">
        {lang.length > 0 && <span className="da-codeblock__lang">{lang}</span>}
        <button
          type="button"
          className={copied ? 'da-codeblock__copy da-codeblock__copy--copied' : 'da-codeblock__copy'}
          onClick={handleCopy}
          aria-label={copied ? t('copiedShort') : t('copy')}
        >
          {copied ? <IconCheck /> : <img src={copyIcon} alt="" draggable={false} />}
        </button>
      </div>
      <div className="da-codeblock__divider" aria-hidden="true" />
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}
