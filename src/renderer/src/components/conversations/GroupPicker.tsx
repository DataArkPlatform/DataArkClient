/**
 * 批量「分组」浮窗 —— 列出全部分组供选择。
 */
import type { GroupSummary } from '../../../../shared/data-contract'
import { Popup } from '../Popup'
import { useI18n } from '../../stores/useI18n'
import { IconFolder } from '../icons'

export interface GroupPickerProps {
  x: number
  y: number
  groups: GroupSummary[]
  anchorEl?: HTMLElement | null
  /** 当前激活分组（以「当前」徽标标注） */
  activeGroupId?: string | null
  onClose: () => void
  onPick: (groupId: string) => void
}

export function GroupPicker({
  x,
  y,
  groups,
  anchorEl,
  activeGroupId,
  onClose,
  onPick
}: GroupPickerProps): React.JSX.Element {
  const t = useI18n((s) => s.t)

  return (
    <Popup x={x} y={y} width={160} onClose={onClose} anchorEl={anchorEl} className="da-popup da-popup--menu">
      {groups.length === 0 ? (
        <div className="da-popup__hint">{t('noGroupYet')}</div>
      ) : (
        groups.map((g) => (
          <button key={g.id} type="button" className="da-popup__item" onClick={() => onPick(g.id)}>
            <IconFolder size={14} />
            <span className="da-popup__subname">{g.name}</span>
            {g.id === activeGroupId ? (
              <span className="da-popup__current">当前</span>
            ) : (
              <span className="da-popup__subcount">{g.count}</span>
            )}
          </button>
        ))
      )}
    </Popup>
  )
}
