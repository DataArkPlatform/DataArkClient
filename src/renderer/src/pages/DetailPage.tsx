/**
 * 会话详情页（M5）——
 * 顶部操作行（返回/复制全部/收藏/导出/移动分组/移除出分组/成果面板开关）+
 * 消息气泡流（user/assistant + 8 类内容块）+ 成果文件浮窗。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationDetail, ConversationMessage } from '../../../shared/data-contract'
import { useAppStore } from '../stores/useAppStore'
import { useDataStore } from '../stores/useDataStore'
import { useI18n, type I18nKey } from '../stores/useI18n'
import { useToastStore } from '../stores/useToastStore'
import { EmptyState } from '../components/conversations/EmptyState'
import { GroupPicker } from '../components/conversations/GroupPicker'
import { Modal } from '../components/Modal'
import { ArtifactsPanel, collectArtifacts } from '../components/detail/ArtifactsPanel'
import { MessageThread } from '../components/detail/MessageThread'
import { IconArrowLeft, IconChevronRight, IconStar } from '../components/icons'
import { copyText } from '../utils/clipboard'
import { formatDate } from '../utils/time'
import { sourceLabel } from '../utils/source'
import copyIcon from '../assets/icons/copy.svg'
import exportIcon from '../assets/icons/export.svg'
import groupIcon from '../assets/icons/group.svg'
import deleteIcon from '../assets/icons/delete.svg'

interface AssignPopupState {
  x: number
  y: number
  anchor: HTMLElement
}

/** 角色行文案（与气泡内一致） */
function transcriptRoleLabel(msg: ConversationMessage, t: (key: I18nKey) => string): string {
  if (msg.role === 'user') return t('userRole')
  const parts = [msg.agentName, msg.modelName].filter(
    (v): v is string => v !== null && v !== undefined
  )
  return parts.join(' · ') || 'Assistant'
}

/** 复制全部：纯文本转写（text/reasoning 原文；工具类给占位行） */
function buildTranscript(detail: ConversationDetail, t: (key: I18nKey) => string): string {
  const lines: string[] = []
  for (const msg of detail.messages) {
    const label = transcriptRoleLabel(msg, t)
    const parts: string[] = []
    for (const b of msg.blocks) {
      switch (b.type) {
        case 'text':
          parts.push(b.text)
          break
        case 'reasoning':
          parts.push(b.text)
          break
        case 'tool_call':
          parts.push(`[${t('toolCallLabel')}] ${b.tool}`)
          break
        case 'tool_result':
          parts.push(`[${t('toolOutput')}]\n${b.output}`)
          break
        case 'patch':
          parts.push(`[patch] ${b.files.join(', ')}`)
          break
        case 'file_ref':
          parts.push(`[${t('artifacts')}] ${b.filename}`)
          break
        case 'compaction':
          if (b.summary !== undefined) parts.push(b.summary)
          break
        case 'step_marker':
          break
      }
    }
    lines.push(`[${label}]\n${parts.join('\n\n')}`)
  }
  return lines.join('\n\n')
}

function Skeleton(): React.JSX.Element {
  return (
    <div className="da-detail__skeleton" aria-hidden="true">
      <div className="da-skel da-skel--w38" />
      <div className="da-skel da-skel--w72" />
      <div className="da-skel da-skel--w55" />
      <div className="da-skel da-skel--w30" />
      <div className="da-skel da-skel--w64" />
    </div>
  )
}

export function DetailPage(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const tFmt = useI18n((s) => s.tFmt)
  const toast = useToastStore((s) => s)
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const previousPage = useAppStore((s) => s.previousPage)
  const currentConvId = useDataStore((s) => s.currentConvId)
  const groups = useDataStore((s) => s.groups)
  const assignGroup = useDataStore((s) => s.assignGroup)

  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [assignPopup, setAssignPopup] = useState<AssignPopupState | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [exporting, setExporting] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const fetchSeq = useRef(0)

  /* ---- 拉取会话详情 ---- */
  useEffect(() => {
    const id = currentConvId
    if (id === null) {
      setDetail(null)
      setLoading(false)
      return
    }
    const seq = ++fetchSeq.current
    setLoading(true)
    window.api.data
      .getConversation(id)
      .then((d) => {
        if (fetchSeq.current !== seq) return
        setDetail(d)
        setLoading(false)
      })
      .catch((err) => {
        if (fetchSeq.current !== seq) return
        console.error('[detail] 加载会话失败', err)
        setDetail(null)
        setLoading(false)
      })
  }, [currentConvId])

  /* ---- 成果文件派生 ---- */
  const artifacts = useMemo(() => (detail !== null ? collectArtifacts(detail.messages) : []), [detail])

  /* ---- 加载完成后滚动到底部 ---- */
  useEffect(() => {
    if (loading || detail === null) return
    const el = threadRef.current
    if (el !== null) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    }
  }, [loading, detail, currentConvId])

  /* ---- 返回 ---- */
  const handleBack = (): void => {
    if (previousPage !== null) back()
    else navigate('conversations')
  }

  /* ---- 收藏（乐观更新） ---- */
  const toggleStar = async (): Promise<void> => {
    if (detail === null) return
    const next = !detail.starred
    setDetail({ ...detail, starred: next })
    try {
      await window.api.data.setStarred(detail.id, next)
      toast.success(next ? t('starAction') : t('unstarAction'))
    } catch (err) {
      setDetail({ ...detail, starred: !next })
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- 复制全部 ---- */
  const copyAll = async (): Promise<void> => {
    if (detail === null) return
    try {
      await copyText(buildTranscript(detail, t))
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  /* ---- 导出（单条 Markdown，选择目录后落盘） ---- */
  const handleExport = async (): Promise<void> => {
    if (detail === null || exporting) return
    setExporting(true)
    try {
      const result = await window.api.data.exportConversations({
        ids: [detail.id],
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

  /* ---- 移动分组 ---- */
  const openAssignPopup = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    setAssignPopup({ x: Math.max(8, rect.right - 192), y: rect.bottom + 4, anchor: e.currentTarget })
  }

  const handlePickGroup = async (groupId: string): Promise<void> => {
    if (detail === null) return
    setAssignPopup(null)
    const group = groups.find((g) => g.id === groupId)
    try {
      await assignGroup([detail.id], groupId)
      setDetail({ ...detail, groupId })
      toast.success(`${t('movedTo')}「${group?.name ?? ''}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- 移除出分组（确认后） ---- */
  const confirmRemoveFromGroup = async (): Promise<void> => {
    if (detail === null || detail.groupId === null) return
    const groupName = groups.find((g) => g.id === detail.groupId)?.name
    setConfirmRemove(false)
    try {
      await assignGroup([detail.id], null)
      setDetail({ ...detail, groupId: null })
      toast.success(`${t('removed')}「${groupName ?? ''}」${t('remove')}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---- 内容区状态 ---- */
  let body: React.JSX.Element
  if (currentConvId === null) {
    body = (
      <div className="da-detail__states">
        {/* 未选择会话 */}
        <EmptyState variant="no-data" title={t('pickFromConversations')} description="" />
      </div>
    )
  } else if (loading) {
    body = <Skeleton />
  } else if (detail === null) {
    body = (
      <div className="da-detail__states">
        <EmptyState
          variant="no-result"
          title={t('convNotFoundTitle')}
          description=""
          action={
            <button
              type="button"
              className="da-btn da-btn--ghost da-btn--sm"
              onClick={() => navigate('conversations')}
            >
              {t('back')}
            </button>
          }
        />
      </div>
    )
  } else {
    body = (
      <>
        <div className="da-detail__main" ref={threadRef}>
          <h1 className="da-detail__title">{detail.title.length > 0 ? detail.title : t('unnamed')}</h1>
          <MessageThread messages={detail.messages} />
        </div>
        {panelOpen && artifacts.length > 0 && <ArtifactsPanel artifacts={artifacts} />}
      </>
    )
  }

  return (
    <div className="da-detail">
      {/* 顶部操作行（Figma y16-56：返回+元信息 | 图标钮+线性按钮） */}
      <div className="da-detail__header">
        <div className="da-detail__nav">
          <button
            type="button"
            className="da-detail__iconbtn"
            title={t('back')}
            aria-label={t('back')}
            onClick={handleBack}
          >
            <IconArrowLeft size={20} />
          </button>
          {detail !== null && (
            <span className="da-detail__meta">
              {sourceLabel(detail.source)} · {detail.msgCount} {t('msgUnit')} ·{' '}
              {formatDate(detail.startedAt ?? detail.updatedAt ?? Date.now())} {t('collectedAt')}
            </span>
          )}
        </div>
        <div className="da-detail__actions">
          <button
            type="button"
            className="da-detail__iconbtn"
            disabled={detail === null}
            title={t('copyAll')}
            aria-label={t('copyAll')}
            onClick={() => void copyAll()}
          >
            <img src={copyIcon} alt="" draggable={false} />
          </button>
          <button
            type="button"
            className={
              detail?.starred === true ? 'da-detail__iconbtn da-detail__iconbtn--on' : 'da-detail__iconbtn'
            }
            disabled={detail === null}
            title={detail?.starred === true ? t('unstarAction') : t('starAction')}
            aria-label={detail?.starred === true ? t('unstarAction') : t('starAction')}
            onClick={() => void toggleStar()}
          >
            <IconStar size={16} fill={detail?.starred === true ? 'var(--color-star-active)' : 'none'} stroke={detail?.starred === true ? 'var(--color-star-active)' : 'currentColor'} />
          </button>
          <button
            type="button"
            className="da-btn da-btn--line"
            disabled={detail === null || exporting}
            onClick={() => void handleExport()}
          >
            <img src={exportIcon} alt="" draggable={false} />
            {t('exportAction')}
          </button>
          <button
            type="button"
            className="da-btn da-btn--line"
            disabled={detail === null}
            onClick={openAssignPopup}
          >
            <img src={groupIcon} alt="" draggable={false} />
            {t('moveToGroup')}
          </button>
          {detail?.groupId !== null && detail !== null && (
            <button
              type="button"
              className="da-btn da-btn--line da-btn--line-danger"
              onClick={() => setConfirmRemove(true)}
            >
              <img src={deleteIcon} alt="" draggable={false} />
              {t('removeFromGroupAction')}
            </button>
          )}
          {artifacts.length > 0 && (
            <button
              type="button"
              className={
                panelOpen
                  ? 'da-detail__panel-toggle'
                  : 'da-detail__panel-toggle da-detail__panel-toggle--collapsed'
              }
              title={panelOpen ? t('collapsePanel') : t('expandPanel')}
              aria-label={panelOpen ? t('collapsePanel') : t('expandPanel')}
              onClick={() => setPanelOpen((v) => !v)}
            >
              <IconChevronRight />
            </button>
          )}
        </div>
      </div>

      {/* 内容区：消息流 + 成果面板 */}
      <div className="da-detail__body">{body}</div>

      {/* 移动分组浮窗 */}
      {assignPopup !== null && (
        <GroupPicker
          x={assignPopup.x}
          y={assignPopup.y}
          groups={groups}
          anchorEl={assignPopup.anchor}
          activeGroupId={detail?.groupId ?? null}
          onClose={() => setAssignPopup(null)}
          onPick={(groupId) => void handlePickGroup(groupId)}
        />
      )}

      {/* 移除出分组确认 */}
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t('removeFromGroupAction')}
        width={420}
      >
        {/* 移出分组说明：无专用 i18n 键，v1 固定中文 */}
        <p className="da-modal__desc">{t('removeFromGroupDesc')}</p>
        <div className="da-modal__actions">
          <button type="button" className="da-btn da-btn--ghost" onClick={() => setConfirmRemove(false)}>
            {t('cancel')}
          </button>
          <button type="button" className="da-btn da-btn--danger" onClick={() => void confirmRemoveFromGroup()}>
            {t('remove')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
