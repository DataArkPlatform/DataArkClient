/**
 * 会话行 ··· 菜单 —— 添加到分组（内联子菜单）/ 备份 / 导出 / 删除。
 */
import { useState } from 'react'
import type { GroupSummary } from '../../../../shared/data-contract'
import { Popup } from '../Popup'
import { useI18n } from '../../stores/useI18n'
import { IconCheck, IconChevronRight, IconDownload, IconFolder, IconTrash } from '../icons'

export interface RowMenuProps {
  x: number
  y: number
  groups: GroupSummary[]
  anchorEl?: HTMLElement | null
  /** 行当前所属分组（子菜单里以「当前」徽标标注） */
  currentGroupId?: string | null
  onClose: () => void
  onBackup: () => void
  onExport: () => void
  onDelete: () => void
  onAssign: (groupId: string) => void
}

export function RowMenu({
  x,
  y,
  groups,
  anchorEl,
  currentGroupId,
  onClose,
  onBackup,
  onExport,
  onDelete,
  onAssign
}: RowMenuProps): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const [showGroups, setShowGroups] = useState(false)

  return (
    <Popup x={x} y={y} width={120} onClose={onClose} anchorEl={anchorEl} className="da-popup da-popup--menu">
      <button type="button" className="da-popup__item" onClick={() => setShowGroups((v) => !v)}>
        <IconFolder size={14} />
        <span className="da-popup__label">{t('addToGroup')}</span>
        <IconChevronRight
          size={10}
          className={showGroups ? 'da-popup__caret da-popup__caret--open' : 'da-popup__caret'}
        />
      </button>

      {showGroups && (
        <div className="da-popup__submenu">
          {groups.length === 0 ? (
            <div className="da-popup__hint">{t('noGroupYet')}</div>
          ) : (
            groups.map((g) => (
              <button key={g.id} type="button" className="da-popup__item da-popup__item--sub" onClick={() => onAssign(g.id)}>
                <span className="da-popup__subname">{g.name}</span>
                {g.id === currentGroupId ? (
                  <span className="da-popup__current">当前</span>
                ) : (
                  <span className="da-popup__subcount">{g.count}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      <button type="button" className="da-popup__item" onClick={onBackup}>
        <IconCheck size={14} />
        <span className="da-popup__label">{t('backup')}</span>
      </button>
      <button type="button" className="da-popup__item" onClick={onExport}>
        <IconDownload size={14} />
        <span className="da-popup__label">{t('exportAction')}</span>
      </button>
      <div className="da-popup__divider" />
      <button type="button" className="da-popup__item da-popup__item--danger" onClick={onDelete}>
        <IconTrash size={14} />
        <span className="da-popup__label">{t('deleteAction')}</span>
      </button>
    </Popup>
  )
}
