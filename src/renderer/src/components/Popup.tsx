import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PopupProps {
  /** 固定定位 left */
  x: number
  /** 固定定位 top */
  y: number
  width?: number
  className?: string
  onClose: () => void
  /** 触发按钮元素 —— 点击它不会触发「点击外部关闭」 */
  anchorEl?: HTMLElement | null
  children: ReactNode
}

/**
 * 通用浮层 —— portal 到 body（固定定位，不受滚动容器裁剪），
 * 点击外部 / Esc 关闭。用于行内 ··· 菜单、批量分组、分组树弹层。
 */
export function Popup({
  x,
  y,
  width = 176,
  className,
  onClose,
  anchorEl,
  children
}: PopupProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorEl])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={className ?? 'da-popup'}
      style={{ left: x, top: y, width }}
    >
      {children}
    </div>,
    document.body
  )
}
