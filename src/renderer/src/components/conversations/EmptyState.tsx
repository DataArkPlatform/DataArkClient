/**
 * 空状态插画 —— SVG 标记源自原型 emptyStateHTML（viewBox 0 0 120 80，
 * currentColor 描边 + 品牌色点缀，容器半透明）。
 */
interface EmptyStateProps {
  variant: 'no-data' | 'no-result'
  title: string
  description: React.ReactNode
  action?: React.ReactNode
}

function NoDataSvg(): React.JSX.Element {
  return (
    <svg viewBox="0 0 120 80" fill="none" width="100" height="66" aria-hidden="true">
      <rect x="15" y="10" width="90" height="60" rx="8" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <line x1="35" y1="28" x2="85" y2="28" stroke="currentColor" strokeWidth="1.2" opacity="0.25" strokeLinecap="round" />
      <line x1="45" y1="40" x2="75" y2="40" stroke="currentColor" strokeWidth="1.2" opacity="0.2" strokeLinecap="round" />
      <line x1="35" y1="52" x2="65" y2="52" stroke="currentColor" strokeWidth="1.2" opacity="0.15" strokeLinecap="round" />
      <circle cx="100" cy="62" r="12" fill="var(--color-primary)" opacity="0.15" />
      <circle cx="100" cy="62" r="6" fill="var(--color-primary)" opacity="0.3" />
    </svg>
  )
}

function NoResultSvg(): React.JSX.Element {
  return (
    <svg viewBox="0 0 120 80" fill="none" width="100" height="66" aria-hidden="true">
      <circle cx="50" cy="35" r="18" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <line x1="63" y1="48" x2="78" y2="63" stroke="currentColor" strokeWidth="1.2" opacity="0.3" strokeLinecap="round" />
      <circle cx="50" cy="35" r="6" fill="currentColor" opacity="0.15" />
      <line x1="38" y1="68" x2="62" y2="68" stroke="currentColor" strokeWidth="1.5" opacity="0.15" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyState({ variant, title, description, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="da-empty" role="status">
      <div className="da-empty__art">{variant === 'no-data' ? <NoDataSvg /> : <NoResultSvg />}</div>
      <h3 className="da-empty__title">{title}</h3>
      <p className="da-empty__desc">{description}</p>
      {action !== undefined && <div className="da-empty__action">{action}</div>}
    </div>
  )
}
