/**
 * TrashEmptyState —— 垃圾箱空态（原型 trash-empty SVG + da-empty 视觉语言）。
 * 自包含 SVG，不依赖 conversations/EmptyState，避免跨目录耦合。
 */
interface TrashEmptyStateProps {
  title: string
  description: string
}

export function TrashEmptyState({ title, description }: TrashEmptyStateProps): React.JSX.Element {
  return (
    <div className="da-empty" role="status">
      <div className="da-empty__art">
        <svg viewBox="0 0 120 80" fill="none" width="100" height="66" aria-hidden="true">
          <rect
            x="35"
            y="10"
            width="50"
            height="55"
            rx="4"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.25"
          />
          <line
            x1="28"
            y1="10"
            x2="92"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.2"
            opacity="0.3"
            strokeLinecap="round"
          />
          <line
            x1="45"
            y1="24"
            x2="75"
            y2="24"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.2"
            strokeLinecap="round"
          />
          <line
            x1="45"
            y1="34"
            x2="70"
            y2="34"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.15"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h3 className="da-empty__title">{title}</h3>
      <p className="da-empty__desc">{description}</p>
    </div>
  )
}
