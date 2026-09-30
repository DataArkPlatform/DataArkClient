import { useEffect } from 'react'
import { useToastStore, type Toast, type ToastVariant } from '../stores/useToastStore'
import {
  IconAttention,
  IconBell,
  IconCheckCircle,
  IconClose,
  IconXCircle,
  type IconProps
} from './icons'

const TOAST_ICONS: Record<ToastVariant, (props: IconProps) => React.JSX.Element> = {
  success: IconCheckCircle,
  error: IconXCircle,
  warning: IconAttention,
  info: IconAttention,
  neutral: IconBell
}

const AUTO_DISMISS_MS = 4000

function ToastCard({ toast }: { toast: Toast }): React.JSX.Element {
  const dismiss = useToastStore((s) => s.dismiss)
  const Icon = TOAST_ICONS[toast.variant]

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [dismiss, toast.id])

  return (
    <div className={`da-toast da-toast--${toast.variant}`} role="status">
      <div className="da-toast__icon" aria-hidden="true">
        <Icon size={24} />
      </div>
      <div className="da-toast__body">
        <span className="da-toast__message">{toast.message}</span>
        {toast.sub !== undefined && <span className="da-toast__sub">{toast.sub}</span>}
      </div>
      {toast.action !== undefined && (
        <button
          type="button"
          className="da-toast__action"
          onClick={() => {
            toast.action?.onPress?.()
            dismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="da-toast__close"
        aria-label="关闭"
        onClick={() => dismiss(toast.id)}
      >
        <IconClose size={16} />
      </button>
    </div>
  )
}

/**
 * Toast 宿主 —— 固定右下角，新消息从右侧滑入。
 */
export function ToastHost(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="da-toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
