/**
 * 会话管理页（M4）——
 * 搜索（300ms 防抖）· 时间/收藏筛选 · 批量操作（分组/导出/删除）·
 * 手写虚拟滚动列表（64px 行高，overscan 8）· 行内 ··· 菜单 · 拖拽入组 ·
 * 空状态（无数据 / 无搜索结果）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConversationListItem,
  ConversationSourceCount,
  ConversationTimeRange,
  GroupSummary
} from '../../../shared/data-contract'
import type { AgentSource } from '../../../shared/unified-model'
import { useAppStore } from '../stores/useAppStore'
import { useDataStore } from '../stores/useDataStore'
import { useI18n } from '../stores/useI18n'
import { useToastStore } from '../stores/useToastStore'
import { isSourceIconMono, sourceColor, sourceIcon, sourceLabel } from '../utils/source'
import { Modal } from '../components/Modal'
import { ConversationRow } from '../components/conversations/ConversationRow'
import { EmptyState } from '../components/conversations/EmptyState'
import { GroupPicker } from '../components/conversations/GroupPicker'
import { RowMenu } from '../components/conversations/RowMenu'
import { IconCheck, IconClose, IconDash, IconSearch } from '../components/icons'
import groupIcon from '../assets/icons/group.svg'
import backupIcon from '../assets/icons/backup.svg'
import exportIcon from '../assets/icons/export.svg'
import deleteIcon from '../assets/icons/delete.svg'

const ROW_H = 88
const OVERSCAN = 8
const PAGE = 200
const LOAD_MORE_THRESHOLD = 480

const TIME_RANGES: Array<{ key: ConversationTimeRange; labelKey: 'all' | 'today' | 'last7d' | 'last30d' }> = [
  { key: 'all', labelKey: 'all' },
  { key: 'today', labelKey: 'today' },
  { key: '7d', labelKey: 'last7d' },
  { key: '30d', labelKey: 'last30d' }
]

interface RowMenuState {
  item: ConversationListItem
  x: number
  y: number
  anchor: HTMLElement
}

interface AssignPopupState {
  x: number
  y: number
  anchor: HTMLElement
}

export function ConversationsPage(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const tFmt = useI18n((s) => s.tFmt)
  const bumpVersion = useDataStore((s) => s.bumpVersion)
  const toast = useToastStore((s) => s)
  const navigate = useAppStore((s) => s.navigate)
  const openConversation = useDataStore((s) => s.openConversation)
  const version = useDataStore((s) => s.version)
  const groups = useDataStore((s) => s.groups)
  const activeGroupId = useDataStore((s) => s.activeGroupId)
  const setConversationTotal = useDataStore((s) => s.setConversationTotal)
  const assignGroup = useDataStore((s) => s.assignGroup)
  const refreshGroups = useDataStore((s) => s.refreshGroups)

  /* ---- 筛选状态 ---- */
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [timeRange, setTimeRange] = useState<ConversationTimeRange>('all')
  const [starredOnly, setStarredOnly] = useState(false)
  /** 按 Agent 数据源筛选（'all' = 全部） */
  const [sourceFilter, setSourceFilter] = useState<'all' | AgentSource>('all')
  /** 各数据源会话计数（筛选胶囊 + 数量徽标） */
  const [sourceCounts, setSourceCounts] = useState<ConversationSourceCount[]>([])

  /* ---- 列表数据 ---- */
  const [items, setItems] = useState<ConversationListItem[]>([])
  const [total, setTotal] = useState(0)
  const [starTotal, setStarTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  /* ---- 选择 / 弹层 / 拖拽 ---- */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const [assignPopup, setAssignPopup] = useState<AssignPopupState | null>(null)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  /* ---- 虚拟滚动 ---- */
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const fetchSeq = useRef(0)
  const loadingMore = useRef(false)

  /* 搜索防抖 300ms */
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  /* 列表容器高度测量 */
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = (): void => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items.length === 0 ? 0 : 1]) // 容器存在性变化（空态↔列表）时重挂

  /* 数据收缩（删除/筛选变化）后钳位 scrollTop，防止可视区落在画布外出现空白列表 */
  useEffect(() => {
    const el = listRef.current
    if (el === null) return
    const maxScroll = Math.max(0, items.length * ROW_H - el.clientHeight)
    if (el.scrollTop > maxScroll) {
      el.scrollTop = maxScroll
      setScrollTop(maxScroll)
    }
  }, [items.length])

  const fetchPage = useCallback(
    async (offset: number, append: boolean): Promise<void> => {
      const seq = ++fetchSeq.current
      setLoading(true)
      try {
        const res = await window.api.data.listConversations({
          query: debouncedQuery,
          timeRange,
          starredOnly,
          ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
          groupId: activeGroupId ?? undefined,
          offset,
          limit: PAGE
        })
        if (seq !== fetchSeq.current) return
        setItems((prev) => {
          if (!append) return res.items
          const seen = new Set(prev.map((i) => i.id))
          const fresh = res.items.filter((i) => !seen.has(i.id))
          return [...prev, ...fresh]
        })
        setTotal(res.total)
        setConversationTotal(res.total)
        const starRes = await window.api.data.listConversations({ starredOnly: true, limit: 1 })
        if (seq !== fetchSeq.current) return
        setStarTotal(starRes.total)
        setLoadError(null)
        setInitialized(true)
      } catch (err) {
        if (seq !== fetchSeq.current) return
        setLoadError(err instanceof Error ? err.message : String(err))
        setInitialized(true)
      } finally {
        if (seq === fetchSeq.current) setLoading(false)
      }
    },
    [debouncedQuery, timeRange, starredOnly, sourceFilter, activeGroupId, setConversationTotal]
  )

  /* 数据源计数：挂载 + 数据版本变化（读取完成后）时刷新 */
  useEffect(() => {
    let cancelled = false
    void window.api.data
      .listConversationSources()
      .then((rows) => {
        if (!cancelled) setSourceCounts(rows)
      })
      .catch(() => {
        /* 计数失败不阻塞列表 */
      })
    return () => {
      cancelled = true
    }
  }, [version])

  /* 筛选/分组/版本变化 → 重置并拉首页 */
  useEffect(() => {
    setItems([])
    setSelected(new Set())
    setScrollTop(0)
    setInitialized(false)
    void fetchPage(0, false)
  }, [fetchPage, version])

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore.current || items.length >= total) return
    loadingMore.current = true
    try {
      await fetchPage(items.length, true)
    } finally {
      loadingMore.current = false
    }
  }, [items.length, total, fetchPage])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD) {
      void loadMore()
    }
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(items.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible = items.slice(start, end)

  const groupNameById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups])

  /* ---- 选择 ---- */
  const selectedCount = selected.size
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id))
  const someSelected = selectedCount > 0 && !allSelected

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const i of items) next.delete(i.id)
      } else {
        for (const i of items) next.add(i.id)
      }
      return next
    })
  }

  /* ---- 快捷键：Ctrl/Cmd+F 聚焦搜索，Ctrl/Cmd+A 全选（输入框内不拦截） ---- */
  const toggleSelectAllRef = useRef<() => void>(toggleSelectAll)
  toggleSelectAllRef.current = toggleSelectAll
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement | null
      const inEditable =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key.toLowerCase() === 'f' && !inEditable) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key.toLowerCase() === 'a' && !inEditable) {
        e.preventDefault()
        toggleSelectAllRef.current()
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [])

  /* ---- 星标（乐观更新） ---- */
  const toggleStar = async (item: ConversationListItem): Promise<void> => {
    const next = !item.starred
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: next } : i)))
    setStarTotal((prev) => Math.max(0, prev + (next ? 1 : -1)))
    try {
      await window.api.data.setStarred(item.id, next)
      if (starredOnly && !next) {
        // 收藏筛选下取消收藏 → 行不再匹配，本地移除
        setItems((prev) => prev.filter((i) => i.id !== item.id))
        setTotal((prev) => Math.max(0, prev - 1))
        setSelected((prev) => {
          const n = new Set(prev)
          n.delete(item.id)
          return n
        })
      }
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: !next } : i)))
      setStarTotal((prev) => Math.max(0, prev + (next ? -1 : 1)))
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- 删除 ---- */
  const confirmDelete = async (): Promise<void> => {
    if (deleteIds === null || deleteIds.length === 0) return
    const ids = deleteIds
    setDeleteIds(null)
    try {
      const { count } = await window.api.data.softDelete(ids)
      // 撤销：toast 上一键恢复（原型交互），恢复后 bump 版本刷新列表
      toast.success(t('movedToTrash'), {
        action: {
          label: t('undo'),
          onPress: () => {
            void (async () => {
              try {
                await window.api.data.restoreTrash(ids)
                bumpVersion()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err))
              }
            })()
          }
        }
      })
      setSelected((prev) => {
        const n = new Set(prev)
        for (const id of ids) n.delete(id)
        return n
      })
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)))
      setTotal((prev) => Math.max(0, prev - count))
      const starRes = await window.api.data.listConversations({ starredOnly: true, limit: 1 })
      setStarTotal(starRes.total)
      void refreshGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- 批量/行内 ··· 菜单 ---- */
  const openRowMenu = (e: React.MouseEvent<HTMLButtonElement>, item: ConversationListItem): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    setRowMenu({
      item,
      x: Math.max(8, rect.right - 192),
      y: rect.bottom + 4,
      anchor: e.currentTarget
    })
  }

  const openBatchAssign = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    setAssignPopup({ x: Math.max(8, rect.right - 192), y: rect.bottom + 4, anchor: e.currentTarget })
  }

  const assignToGroup = async (sessionIds: string[], groupId: string): Promise<void> => {
    const group = groups.find((g: GroupSummary) => g.id === groupId)
    try {
      await assignGroup(sessionIds, groupId)
      toast.success(`${t('movedTo')}「${group?.name ?? ''}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- 批量操作 ---- */
  const [exporting, setExporting] = useState(false)
  const [backingUp, setBackingUp] = useState(false)

  /** 批量导出选中（JSON，选择目录后落盘） */
  const handleBatchExport = async (): Promise<void> => {
    if (selected.size === 0 || exporting) return
    setExporting(true)
    try {
      const result = await window.api.data.exportConversations({
        ids: Array.from(selected),
        format: 'json'
      })
      if (result !== null)
        toast.success(tFmt('exportedToast', { n: result.written }), {
          action:
            result.firstFile !== undefined
              ? {
                  label: t('openFolder'),
                  onPress: () => void window.api.data.openInFolder(result.firstFile ?? '')
                }
              : undefined
        })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  /** 单条导出（Markdown） */
  const handleExportOne = async (item: ConversationListItem): Promise<void> => {
    if (exporting) return
    setExporting(true)
    try {
      const result = await window.api.data.exportConversations({
        ids: [item.id],
        format: 'markdown'
      })
      if (result !== null)
        toast.success(tFmt('exportedToast', { n: result.written }), {
          action:
            result.firstFile !== undefined
              ? {
                  label: t('openFolder'),
                  onPress: () => void window.api.data.openInFolder(result.firstFile ?? '')
                }
              : undefined
        })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  /** 立即备份索引库快照 */
  const handleBackup = async (): Promise<void> => {
    if (backingUp) return
    setBackingUp(true)
    try {
      const res = await window.api.data.runBackup()
      toast.success(tFmt('backupToToast', { file: res.file }), {
        action: {
          label: t('openFolder'),
          onPress: () => void window.api.data.openInFolder(res.file)
        }
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBackingUp(false)
    }
  }

  /** 批量备份选中会话（JSON → 备份目录，免对话框） */
  const handleBatchBackup = async (): Promise<void> => {
    if (selected.size === 0 || backingUp) return
    setBackingUp(true)
    try {
      const result = await window.api.data.exportConversations({
        ids: Array.from(selected),
        format: 'json',
        toBackupDir: true
      })
      if (result !== null)
        toast.success(tFmt('backupBatchToast', { n: result.written }), {
          action:
            result.firstFile !== undefined
              ? {
                  label: t('openFolder'),
                  onPress: () => void window.api.data.openInFolder(result.firstFile ?? '')
                }
              : undefined
        })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBackingUp(false)
    }
  }

  /* ---- 拖拽 ---- */
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string): void => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const handleDragEnd = (): void => setDragId(null)

  /* ---- 渲染 ---- */
  const hasActiveFilter = debouncedQuery.length > 0 || starredOnly || timeRange !== 'all' || sourceFilter !== 'all'

  return (
    <div className="da-conv-page">
      {/* 头部行（Figma y16-56）：标题 + 搜索(400) + 批量操作 */}
      <div className="da-conv-header">
        {/* TODO-i18n: 页面标题（v1 固定中文） */}
        <h1 className="da-conv-header__title">会话管理</h1>
        <div className="da-conv-search">
          <IconSearch size={16} className="da-conv-search__icon" />
          <input
            ref={searchRef}
            className="da-conv-search__input"
            placeholder={t('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="da-conv-search__clear"
              aria-label={t('clearSearch')}
              onClick={() => {
                setQuery('')
                setDebouncedQuery('')
              }}
            >
              <IconClose size={14} />
            </button>
          )}
        </div>
        <div className="da-conv-batch">
          <button
            type="button"
            className="da-btn da-btn--line"
            disabled={selectedCount === 0}
            onClick={openBatchAssign}
          >
            <img src={groupIcon} alt="" draggable={false} />
            {t('groupAction')}
          </button>
          <button
            type="button"
            className="da-btn da-btn--line"
            disabled={selectedCount === 0 || backingUp}
            onClick={() => void handleBatchBackup()}
          >
            <img src={backupIcon} alt="" draggable={false} />
            {t('backupAction')}
          </button>
          <button
            type="button"
            className="da-btn da-btn--line da-btn--line-primary"
            disabled={selectedCount === 0 || exporting}
            onClick={() => void handleBatchExport()}
          >
            <img src={exportIcon} alt="" draggable={false} />
            {t('exportAction')}
          </button>
          <button
            type="button"
            className="da-btn da-btn--line da-btn--line-danger"
            disabled={selectedCount === 0}
            onClick={() => setDeleteIds(Array.from(selected))}
          >
            <img src={deleteIcon} alt="" draggable={false} />
            {t('deleteAction')}
          </button>
        </div>
      </div>

      {/* 筛选条（Figma y92）：胶囊 + 排序提示 */}
      <div className="da-conv-toolbar">
        <div className="da-conv-chips">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={timeRange === r.key ? 'da-chip da-chip--active' : 'da-chip'}
              onClick={() => setTimeRange(r.key)}
            >
              {t(r.labelKey)}
            </button>
          ))}
          <button
            type="button"
            className={starredOnly ? 'da-chip da-chip--active da-chip--star' : 'da-chip da-chip--star'}
            onClick={() => setStarredOnly((v) => !v)}
          >
            {/* Figma E11：已收藏胶囊默认无星标图标 */}
            <span>{t('starFilter')}</span>
            <span className="da-chip__count">{starTotal}</span>
          </button>
        </div>
        <span className="da-conv-sorthint">{t('sortHint')}</span>
      </div>

      {/* 按 Agent 筛选（数据源胶囊 + 数量；与时间/收藏筛选叠加生效） */}
      <div className="da-conv-toolbar da-conv-toolbar--platform">
        <span className="da-conv-filterlabel">{t('byPlatform')}</span>
        <div className="da-conv-chips">
          <button
            type="button"
            className={sourceFilter === 'all' ? 'da-chip da-chip--active' : 'da-chip'}
            onClick={() => setSourceFilter('all')}
          >
            {t('all')}
            <span className="da-chip__count">
              {sourceCounts.reduce((sum, s) => sum + s.count, 0)}
            </span>
          </button>
          {sourceCounts.map(({ source, count }) => {
            const icon = sourceIcon(source)
            const active = sourceFilter === source
            return (
              <button
                key={source}
                type="button"
                className={active ? 'da-chip da-chip--agent da-chip--active' : 'da-chip da-chip--agent'}
                aria-pressed={active}
                onClick={() => setSourceFilter(active ? 'all' : source)}
              >
                {icon !== undefined ? (
                  <img
                    className="da-chip__icon"
                    src={icon}
                    alt=""
                    draggable={false}
                    data-mono={isSourceIconMono(source) ? 'true' : undefined}
                  />
                ) : (
                  <span
                    className="da-chip__dot"
                    style={{ background: sourceColor(source) }}
                    aria-hidden="true"
                  />
                )}
                {sourceLabel(source)}
                <span className="da-chip__count">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 选中工具条（仅存在选中项时显示，替代常驻表头行） */}
      {selectedCount > 0 && (
        <div className="da-conv-selbar">
          <button
            type="button"
            className={
              allSelected
                ? 'da-conv-check da-conv-check--on'
                : someSelected
                  ? 'da-conv-check da-conv-check--partial'
                  : 'da-conv-check'
            }
            aria-pressed={allSelected}
            title={t('selectAll')}
            onClick={toggleSelectAll}
          >
            {allSelected ? <IconCheck size={16} /> : someSelected ? <IconDash size={16} /> : null}
          </button>
          <span className="da-conv-selbar__count">
            {t('selected')} {selectedCount} {t('itemsUnit')}
          </span>
          <button type="button" className="da-btn da-btn--ghost da-btn--sm" onClick={() => setSelected(new Set())}>
            {t('cancel')}
          </button>
        </div>
      )}

      {/* 虚拟列表 */}
      <div className="da-conv-list" ref={listRef} onScroll={handleScroll}>
        {initialized && items.length === 0 ? (
          <div className="da-conv-list__empty">
            {hasActiveFilter ? (
              <EmptyState
                variant="no-result"
                title={t('noResultTitle')}
                description={
                  <>
                    {t('noMatch')}「<strong>{debouncedQuery || t('starFilter')}</strong>」
                    {t('matched')}
                  </>
                }
                action={
                  <button
                    type="button"
                    className="da-btn da-btn--ghost da-btn--sm"
                    onClick={() => {
                      setQuery('')
                      setDebouncedQuery('')
                      setTimeRange('all')
                      setStarredOnly(false)
                      setSourceFilter('all')
                    }}
                  >
                    {t('clearSearch')}
                  </button>
                }
              />
            ) : (
              <EmptyState
                variant="no-data"
                title={t('noDataTitle')}
                description={t('noData')}
                action={
                  <button
                    type="button"
                    className="da-btn da-btn--primary da-btn--sm"
                    onClick={() => navigate('scan')}
                  >
                    {t('manualRead')}
                  </button>
                }
              />
            )}
          </div>
        ) : (
          <div className="da-conv-list__canvas" style={{ height: items.length * ROW_H }}>
            {visible.map((item, i) => (
              <div
                key={item.id}
                className="da-conv-list__cell"
                style={{ transform: `translateY(${(start + i) * ROW_H}px)` }}
              >
                <ConversationRow
                  item={item}
                  selected={selected.has(item.id)}
                  dragging={dragId === item.id}
                  groupName={item.groupId !== null ? groupNameById.get(item.groupId) : undefined}
                  highlight={debouncedQuery}
                  onToggleSelect={toggleSelect}
                  onToggleStar={(it) => void toggleStar(it)}
                  onMoreClick={openRowMenu}
                  onOpen={(it) => {
                    openConversation(it.id)
                    navigate('detail')
                  }}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              </div>
            ))}
          </div>
        )}
        {loading && items.length === 0 && !initialized && (
          <div className="da-conv-list__loading">
            <span className="da-conv-list__spinner" aria-hidden="true" />
            {t('readingIng')}
          </div>
        )}
        {loadError !== null && <div className="da-conv-list__error">{loadError}</div>}
      </div>

      {/* 行内 ··· 菜单 */}
      {rowMenu !== null && (
        <RowMenu
          x={rowMenu.x}
          y={rowMenu.y}
          groups={groups}
          anchorEl={rowMenu.anchor}
          currentGroupId={rowMenu.item.groupId}
          onClose={() => setRowMenu(null)}
          onBackup={() => {
            setRowMenu(null)
            void handleBackup()
          }}
          onExport={() => {
            const item = rowMenu.item
            setRowMenu(null)
            void handleExportOne(item)
          }}
          onDelete={() => {
            const item = rowMenu.item
            setRowMenu(null)
            setDeleteIds([item.id])
          }}
          onAssign={(groupId) => {
            const item = rowMenu.item
            setRowMenu(null)
            void assignToGroup([item.id], groupId)
          }}
        />
      )}

      {/* 批量分组浮窗 */}
      {assignPopup !== null && (
        <GroupPicker
          x={assignPopup.x}
          y={assignPopup.y}
          groups={groups}
          anchorEl={assignPopup.anchor}
          activeGroupId={activeGroupId}
          onClose={() => setAssignPopup(null)}
          onPick={(groupId) => {
            setAssignPopup(null)
            void assignToGroup(Array.from(selected), groupId)
          }}
        />
      )}

      {/* 删除确认 */}
      <Modal open={deleteIds !== null} onClose={() => setDeleteIds(null)} title={t('deleteTitle')} width={420}>
        <p className="da-modal__desc">{t('deleteDesc')}</p>
        <div className="da-modal__actions">
          <button type="button" className="da-btn da-btn--ghost" onClick={() => setDeleteIds(null)}>
            {t('cancel')}
          </button>
          <button type="button" className="da-btn da-btn--danger" onClick={() => void confirmDelete()}>
            {t('confirm')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
