import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  /** 面板宽度，默认 480 */
  width?: number
  children: ReactNode
}

const CLOSE_MS = 150

/**
 * 通用弹窗 —— portal 到 body，150ms 淡入缩放，Esc / 点击遮罩关闭，初始聚焦面板。
 */
export function Modal({
  open,
  onClose,
  title,
  width = 480,
  children
}: ModalProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setVisible(true)
      setClosing(false)
      return
    }
    setClosing(true)
    const timer = window.setTimeout(() => setVisible(false), CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  // Esc 关闭 + 初始聚焦（基础焦点陷阱）
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!visible) return null

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div
      className={closing ? 'da-modal-overlay da-modal-overlay--closing' : 'da-modal-overlay'}
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={closing ? 'da-modal da-modal--closing' : 'da-modal'}
        style={{ width }}
      >
        {title !== undefined && <h3 className="da-modal__title">{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  )
}
