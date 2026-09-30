/**
 * 会话列表行（Figma 1617:5307 对齐：80px 卡片）——
 * 复选框(24) · 平台头像(56×56 r12) · 标题(16/24)+分组胶囊 · 元信息(12/20) ·
 * 消息数徽标(DIN Bold) · 星标/更多(32 圆形，悬停显隐)
 */
import type { ConversationListItem } from '../../../../shared/data-contract'
import { useI18n } from '../../stores/useI18n'
import { formatRelativeTime } from '../../utils/time'
import { highlightText } from '../../utils/highlight'
import { sourceColor, sourceIcon, sourceLabel } from '../../utils/source'
import { IconStar } from '../icons'
import moreIcon from '../../assets/icons/more.svg'

export interface ConversationRowProps {
  item: ConversationListItem
  selected: boolean
  dragging: boolean
  groupName?: string
  /** 搜索关键词（非空时标题命中片段高亮） */
  highlight?: string
  onToggleSelect: (id: string) => void
  onToggleStar: (item: ConversationListItem) => void
  onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, item: ConversationListItem) => void
  onOpen: (item: ConversationListItem) => void
  onDragStart: (e: React.DragEvent<HTMLDivElement>, id: string) => void
  onDragEnd: () => void
}

export function ConversationRow({
  item,
  selected,
  dragging,
  groupName,
  highlight,
  onToggleSelect,
  onToggleStar,
  onMoreClick,
  onOpen,
  onDragStart,
  onDragEnd
}: ConversationRowProps): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const title = item.title.trim().length > 0 ? item.title.trim() : t('unnamed')
  const icon = sourceIcon(item.source)

  return (
    <div
      className={
        'da-conv-row__body' +
        (selected ? ' da-conv-row__body--selected' : '') +
        (dragging ? ' da-conv-row__body--dragging' : '')
      }
      draggable
      onClick={() => onOpen(item)}
      onDragStart={(e) => onDragStart(e, item.id)}
      onDragEnd={onDragEnd}
      title={title}
    >
      <button
        type="button"
        className={selected ? 'da-conv-check da-conv-check--on' : 'da-conv-check'}
        aria-pressed={selected}
        aria-label={t('selectAll')}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(item.id)
        }}
      >
        {selected && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* 平台头像 56×56 浅盒：已知源用平台 logo（sourceIcon 映射），未知源回退首字母色块 */}
      {icon !== undefined ? (
        <span className="da-conv-avatar" aria-hidden="true">
          <img className="da-conv-avatar__logo" src={icon} alt="" draggable={false} />
        </span>
      ) : (
        <span className="da-conv-avatar da-conv-avatar--letter" style={{ color: sourceColor(item.source) }} aria-hidden="true">
          {sourceLabel(item.source).charAt(0).toUpperCase()}
        </span>
      )}

      <div className="da-conv-info">
        <div className="da-conv-titleline">
          <span className="da-conv-title">
            {highlight !== undefined && highlight.length > 0
              ? highlightText(title, highlight, item.id)
              : title}
          </span>
          {groupName !== undefined && <span className="da-conv-grouptag">{groupName}</span>}
        </div>
        <div className="da-conv-meta">
          {sourceLabel(item.source)} · {item.msgCount} {t('msgUnit')} · {formatRelativeTime(item.updatedAt)}
        </div>
      </div>

      {/* 消息数徽标（Figma #F0F5FD 胶囊 / DIN Bold） */}
      <span className="da-conv-count">{item.msgCount}</span>

      <div className="da-conv-actions">
        <button
          type="button"
          className={item.starred ? 'da-star da-star--on' : 'da-star'}
          title={item.starred ? t('starred') : t('starFilter')}
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar(item)
          }}
        >
          <IconStar size={24} fill={item.starred ? 'var(--color-star-active)' : 'none'} stroke={item.starred ? 'var(--color-star-active)' : 'currentColor'} />
        </button>
        <button
          type="button"
          className="da-conv-more"
          title={t('more')}
          onClick={(e) => {
            e.stopPropagation()
            onMoreClick(e, item)
          }}
        >
          <img src={moreIcon} alt="" draggable={false} />
        </button>
      </div>
    </div>
  )
}