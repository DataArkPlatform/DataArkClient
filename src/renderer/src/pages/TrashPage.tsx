/**
 * 垃圾箱页（M7）——
 * 列表（最多显示 500 条，不虚拟化）· 批量恢复 / 清空回收站（确认弹窗）·
 * 行内恢复 / 彻底删除 · 24h 保留倒计时元信息 · 空态插画。
 *
 * 自动清理由主进程 scheduler 每 10 分钟执行，本页只做展示与交互。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrashItem } from '../../../shared/data-contract'
import { useDataStore } from '../stores/useDataStore'
import { useI18n } from '../stores/useI18n'
import { useToastStore } from '../stores/useToastStore'
import { Modal } from '../components/Modal'
import { TrashEmptyState } from '../components/trash/TrashEmptyState'
import { IconCheck, IconRestore, IconTrashFilled } from '../components/icons'
import { sourceColor, sourceIcon, sourceLabel } from '../utils/source'

const HOUR_MS = 3_600_000
const MAX_ROWS = 500

type ConfirmState =
  | { kind: 'purge'; ids: string[]; title: string }
  | { kind: 'empty' }
  | null

function hoursAgo(ts: number, now: number = Date.now()): string {
  const diffMs = now - ts
  if (diffMs < HOUR_MS) return useI18n.getState().tFmt('justDeleted', {})
  return useI18n.getState().tFmt('hoursAgoDeleted', { n: Math.floor(diffMs / HOUR_MS) })
}

function hoursLeft(ts: number, now: number = Date.now()): string {
  return useI18n
    .getState()
    .tFmt('purgeInHours', { n: Math.max(0, Math.ceil((ts - now) / HOUR_MS)) })
}

export function TrashPage(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const tFmt = useI18n((s) => s.tFmt)
  const toast = useToastStore((s) => s)
  const version = useDataStore((s) => s.version)

  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const fetchSeq = useRef(0)

  /* ---- 拉取列表（version 变化时刷新：恢复/删除后重拉） ---- */
  const load = useCallback(async (): Promise<void> => {
    const seq = ++fetchSeq.current
    setLoading(true)
    try {
      const rows = await window.api.data.listTrash()
      if (seq !== fetchSeq.current) return
      setItems(rows.slice(0, MAX_ROWS))
      setSelected(new Set())
      setLoading(false)
    } catch (err) {
      if (seq !== fetchSeq.current) return
      console.error('[trash] 加载垃圾箱失败', err)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  const selectedCount = selected.size

  /* ---- 变更后刷新：bump 数据版本（会话页/侧栏联动重拉） ---- */
  const bumpData = (): void => {
    useDataStore.setState((s) => ({ version: s.version + 1 }))
    void useDataStore.getState().refreshGroups()
  }

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* ---- 恢复 ---- */
  const restore = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    try {
      const { count } = await window.api.data.restoreTrash(ids)
      if (count === 0) return
      const first = items.find((i) => i.id === ids[0])
      if (ids.length === 1) {
        toast.success(tFmt('restoredOneToast', { title: first?.title ?? '' }))
      } else {
        toast.success(tFmt('restoredManyToast', { n: count }))
      }
      bumpData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- 彻底删除 / 清空 ---- */
  const confirmPurge = async (): Promise<void> => {
    if (confirm === null) return
    const state = confirm
    setConfirm(null)
    try {
      if (state.kind === 'empty') {
        const { count } = await window.api.data.emptyTrash()
        if (count > 0) toast.success(t('trashEmptiedToast'))
      } else {
        const { count } = await window.api.data.purgeTrash(state.ids)
        if (count > 0) toast.success(t('deletedPermanentlyToast'))
      }
      bumpData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="da-trash">
      {/* 头部（Figma 1660:9913：标题 + 右侧提示 + 线性批量按钮） */}
      <div className="da-trash__header">
        {/* TODO-i18n: 页面标题（Figma：垃圾箱） */}
        <h1 className="da-trash__title">垃圾箱</h1>
        <span className="da-trash__hint">{t('trashNote')}</span>
        <div className="da-trash__actions">
          <button
            type="button"
            className="da-btn da-btn--line"
            disabled={selectedCount === 0}
            onClick={() => void restore(Array.from(selected))}
          >
            <IconRestore size={20} />
            {t('batchRestore')}
          </button>
          <button
            type="button"
            className="da-btn da-btn--line da-btn--line-danger"
            disabled={items.length === 0}
            onClick={() => setConfirm({ kind: 'empty' })}
          >
            <IconTrashFilled size={20} />
            {t('emptyTrash')}
          </button>
        </div>
      </div>

      {/* G3：头部下方独立分隔线 */}
      <div className="da-trash__divider" aria-hidden="true" />

      {/* 列表 */}
      <div className="da-trash__list">
        {loading && items.length === 0 ? (
          <div className="da-trash__loading">
            <span className="da-conv-list__spinner" aria-hidden="true" />
          </div>
        ) : items.length === 0 ? (
          <TrashEmptyState title={t('trashEmptyTitle')} description={t('trashNote')} />
        ) : (
          <>
            {items.map((item) => {
              const title = item.title.trim().length > 0 ? item.title.trim() : t('unnamed')
              const checked = selected.has(item.id)
              const icon = sourceIcon(item.source)
              return (
                <div key={item.id} className={checked ? 'da-trash__row da-trash__row--selected' : 'da-trash__row'}>
                  <button
                    type="button"
                    className={checked ? 'da-conv-check da-conv-check--on' : 'da-conv-check'}
                    aria-pressed={checked}
                    aria-label={t('selectAll')}
                    onClick={() => toggleSelect(item.id)}
                  >
                    {checked && <IconCheck size={16} />}
                  </button>
                  {icon !== undefined ? (
                    <span className="da-conv-avatar" aria-hidden="true">
                      <img className="da-conv-avatar__logo" src={icon} alt="" draggable={false} />
                    </span>
                  ) : (
                    <span
                      className="da-conv-avatar da-conv-avatar--letter"
                      style={{ color: sourceColor(item.source) }}
                      aria-hidden="true"
                    >
                      {sourceLabel(item.source).charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="da-trash__info">
                    <div className="da-conv-titleline">
                      <div className="da-conv-title" title={title}>
                        {title}
                      </div>
                      <span className="da-conv-grouptag">{hoursLeft(item.purgeAt)}</span>
                    </div>
                    <div className="da-conv-meta">
                      {sourceLabel(item.source)} · {item.msgCount} {t('msgUnit')} ·{' '}
                      {hoursAgo(item.deletedAt)}
                    </div>
                  </div>
                  <div className="da-trash__row-actions">
                    <button
                      type="button"
                      className="da-trash__btn-restore"
                      onClick={() => void restore([item.id])}
                    >
                      <IconRestore size={16} />
                      {t('restore')}
                    </button>
                    <button
                      type="button"
                      className="da-trash__btn-delete"
                      onClick={() => setConfirm({ kind: 'purge', ids: [item.id], title })}
                    >
                      <IconTrashFilled size={16} />
                      {t('permDelete')}
                    </button>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* 彻底删除确认 */}
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'empty' ? t('emptyTrash') : t('permDelete')}
        width={420}
      >
        {/* 确认文案 */}
        <p className="da-modal__desc">
          {confirm?.kind === 'empty'
            ? t('purgeEmptyConfirm')
            : t('purgeOneConfirm')}
        </p>
        <div className="da-modal__actions">
          <button type="button" className="da-btn da-btn--ghost" onClick={() => setConfirm(null)}>
            {t('cancel')}
          </button>
          <button type="button" className="da-btn da-btn--danger" onClick={() => void confirmPurge()}>
            {t('confirm')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
