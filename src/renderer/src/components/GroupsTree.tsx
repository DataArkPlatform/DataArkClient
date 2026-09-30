/**
 * 侧栏「我的项目」分组树（M4 实时版 + L3 分组成员）——
 * 分组列表 / 新建浮窗（预设名标签）/ 重命名（行内输入）/ 移除分组（确认弹窗）/
 * 拖拽会话入组（虚线高亮）/ 分组成员展开（点击跳详情、··· 移除/移动到其他组）。
 * 点击分组头 → 会话列表按该分组过滤（再点取消）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ConversationListItem, GroupSummary } from '../../../shared/data-contract'
import { useAppStore } from '../stores/useAppStore'
import { useDataStore } from '../stores/useDataStore'
import { useI18n } from '../stores/useI18n'
import { useToastStore } from '../stores/useToastStore'
import { sourceColor } from '../utils/source'
import { Modal } from './Modal'
import { Popup } from './Popup'
import {
  IconChevronDown,
  IconFolder,
  IconMore,
  IconPencil,
  IconPlus,
  IconTrash
} from './icons'
import folderFrameIcon from '../assets/icons/folder-frame.svg'
import folderOpenIcon from '../assets/icons/folder-open.svg'
import folderMinusIcon from '../assets/icons/folder-minus.svg'

const PRESET_NAMES = ['代码', '技术', '标准', '生活', '旅游', '学习', '写作', '设计']

export function GroupsTree(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const tFmt = useI18n((s) => s.tFmt)
  const toast = useToastStore((s) => s)
  const navigate = useAppStore((s) => s.navigate)
  const groups = useDataStore((s) => s.groups)
  const activeGroupId = useDataStore((s) => s.activeGroupId)
  const setActiveGroupId = useDataStore((s) => s.setActiveGroupId)
  const createGroup = useDataStore((s) => s.createGroup)
  const renameGroup = useDataStore((s) => s.renameGroup)
  const removeGroup = useDataStore((s) => s.removeGroup)
  const assignGroup = useDataStore((s) => s.assignGroup)
  const openConversation = useDataStore((s) => s.openConversation)
  const version = useDataStore((s) => s.version)

  const [open, setOpen] = useState(true)
  const [dragOver, setDragOver] = useState<string | null>(null)

  /* ---- L3 · 分组成员展开 ---- */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [membersByGroup, setMembersByGroup] = useState<
    Record<string, ConversationListItem[]>
  >({})
  const [memberMenu, setMemberMenu] = useState<{
    item: ConversationListItem
    groupId: string
    x: number
    y: number
    anchor: HTMLElement
  } | null>(null)

  const loadMembers = useCallback(async (groupId: string): Promise<void> => {
    try {
      const items = await window.api.data.listGroupMembers(groupId)
      setMembersByGroup((prev) => ({ ...prev, [groupId]: items }))
    } catch {
      /* 成员树非关键路径，失败静默 */
    }
  }, [])

  // 展开的分组：挂载 / 版本变化 / 展开集合变化时刷新成员
  useEffect(() => {
    if (!open) return
    expandedGroups.forEach((id) => void loadMembers(id))
  }, [open, expandedGroups, version, loadMembers])

  const toggleExpand = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openMember = (item: ConversationListItem): void => {
    openConversation(item.id)
    navigate('detail')
  }

  const removeMember = async (
    item: ConversationListItem,
    groupId: string
  ): Promise<void> => {
    const groupName = groups.find((g) => g.id === groupId)?.name ?? ''
    try {
      await assignGroup([item.id], null)
      toast.success(tFmt('removedFromGroupToast', { group: groupName }))
    } catch (err) {
      toast.error(String(err))
    }
  }

  const moveMemberTo = async (
    item: ConversationListItem,
    target: GroupSummary
  ): Promise<void> => {
    try {
      await assignGroup([item.id], target.id)
      toast.success(`${t('movedTo')}「${target.name}」`)
    } catch (err) {
      toast.error(String(err))
    }
  }

  const openMemberMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    item: ConversationListItem,
    groupId: string
  ): void => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setMemberMenu({
      item,
      groupId,
      x: Math.max(8, rect.right - 176),
      y: rect.bottom + 4,
      anchor: e.currentTarget
    })
  }

  // 新建分组浮窗
  const [newOpen, setNewOpen] = useState(false)
  const [newAnchor, setNewAnchor] = useState<HTMLElement | null>(null)
  const [newName, setNewName] = useState('')

  // 分组 ··· 菜单 / 行内重命名 / 移除确认
  const [menu, setMenu] = useState<{ group: GroupSummary; x: number; y: number; anchor: HTMLElement } | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<GroupSummary | null>(null)

  const openNewGroup = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const anchor = e.currentTarget
    if (newOpen) {
      setNewOpen(false)
      return
    }
    setNewAnchor(anchor)
    setNewName('')
    setNewOpen(true)
  }

  const submitNew = async (): Promise<void> => {
    const name = newName.trim()
    if (name.length === 0) return
    setNewOpen(false)
    setNewName('')
    try {
      await createGroup(name)
      toast.success(`「${name}」${t('created')}`)
    } catch (err) {
      toast.error(String(err))
    }
  }

  const openGroupMenu = (e: React.MouseEvent<HTMLButtonElement>, g: GroupSummary): void => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setMenu({
      group: g,
      x: Math.max(8, rect.right - 176),
      y: rect.bottom + 4,
      anchor: e.currentTarget
    })
  }

  const commitRename = (): void => {
    if (!editing) return
    const { id, name } = editing
    const prev = groups.find((g) => g.id === id)?.name ?? ''
    setEditing(null)
    const trimmed = name.trim()
    if (trimmed.length === 0 || trimmed === prev) return
    void (async () => {
      try {
        await renameGroup(id, trimmed)
        toast.success(`${t('renameTo')}「${trimmed}」`)
      } catch (err) {
        toast.error(String(err))
      }
    })()
  }

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget) return
    const target = removeTarget
    setRemoveTarget(null)
    try {
      await removeGroup(target.id)
      toast.info(`「${target.name}」${t('deleted')}`)
    } catch (err) {
      toast.error(String(err))
    }
  }

  const toggleFilter = (id: string): void => {
    setActiveGroupId(activeGroupId === id ? null : id)
  }

  /* ---- 拖拽：会话行 → 分组头 ---- */
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, id: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(id)
  }
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    // 指针进入子元素不算离开
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(null)
  }
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, g: GroupSummary): void => {
    e.preventDefault()
    setDragOver(null)
    const sessionId = e.dataTransfer.getData('text/plain')
    if (sessionId.length === 0) return
    void (async () => {
      try {
        await assignGroup([sessionId], g.id)
        toast.success(`${t('movedTo')}「${g.name}」`)
      } catch (err) {
        toast.error(String(err))
      }
    })()
  }

  const newPos = (() => {
    if (!newAnchor) return { x: 0, y: 0 }
    const rect = newAnchor.getBoundingClientRect()
    return {
      x: Math.max(8, Math.min(rect.left - 232, window.innerWidth - 248)),
      y: Math.min(rect.bottom + 4, window.innerHeight - 320)
    }
  })()

  const memberPos = (() => {
    if (!memberMenu) return { x: 0, y: 0 }
    return {
      x: Math.min(memberMenu.x, window.innerWidth - 192),
      y: Math.min(memberMenu.y, window.innerHeight - 240)
    }
  })()

  return (
    <div className="da-projects">
      <div className="da-projects-header">
        <button
          type="button"
          className="da-projects-header__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <img className="da-projects-header__icon" src={folderFrameIcon} alt="" draggable={false} />
          <span className="da-projects-header__label">{t('myProjects')}</span>
          <IconChevronDown
            size={10}
            className={open ? 'da-projects-header__arrow da-projects-header__arrow--open' : 'da-projects-header__arrow'}
          />
        </button>
        <button type="button" className="da-projects-header__add" title={t('newProject')} onClick={openNewGroup}>
          <IconPlus size={12} />
        </button>
      </div>

      {open && (
        <div className="da-projects-tree">
          {groups.length === 0 ? (
            <div className="da-projects-empty">{t('emptyGroup')}</div>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="da-project-group">
                <div
                  className={
                    [
                      'da-project-group__header',
                      activeGroupId === g.id ? 'da-project-group__header--active' : '',
                      dragOver === g.id ? 'da-project-group__header--drop' : ''
                    ].join(' ')
                  }
                  role="button"
                  tabIndex={0}
                  title={t('groupAction')}
                  onClick={() => toggleFilter(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') toggleFilter(g.id)
                  }}
                  onDragOver={(e) => handleDragOver(e, g.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, g)}
                >
                  <img
                    className="da-project-group__folder"
                    src={expandedGroups.has(g.id) ? folderOpenIcon : folderMinusIcon}
                    alt=""
                    draggable={false}
                  />
                  {editing?.id === g.id ? (
                    <input
                      className="da-project-group__rename"
                      value={editing.name}
                      autoFocus
                      placeholder={t('inputGroupName')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditing({ id: g.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <span className="da-project-group__name">{g.name}</span>
                  )}
                  <button
                    type="button"
                    className="da-project-group__exp"
                    aria-expanded={expandedGroups.has(g.id)}
                    title={expandedGroups.has(g.id) ? t('collapse') : t('expand')}
                    onClick={(e) => toggleExpand(e, g.id)}
                  >
                    <IconChevronDown
                      size={10}
                      style={{ transform: expandedGroups.has(g.id) ? 'none' : 'rotate(-90deg)' }}
                    />
                  </button>
                  <span className="da-project-group__count">{g.count}</span>
                  <button
                    type="button"
                    className="da-project-group__more"
                    title={t('more')}
                    onClick={(e) => openGroupMenu(e, g)}
                  >
                    <IconMore size={14} />
                  </button>
                </div>

                {/* L3 · 分组成员行 */}
                {expandedGroups.has(g.id) && (
                  <div className="da-tree-members">
                    {(membersByGroup[g.id] ?? []).length === 0 ? (
                      <div className="da-tree-member__empty">{t('emptyGroup')}</div>
                    ) : (
                      (membersByGroup[g.id] ?? []).map((mItem) => (
                        <div
                          key={mItem.id}
                          className="da-tree-member"
                          title={mItem.title}
                          onClick={() => openMember(mItem)}
                        >
                          <span
                            className="da-tree-member__dot"
                            style={{ background: sourceColor(mItem.source) }}
                            aria-hidden="true"
                          />
                          <span className="da-tree-member__title">{mItem.title}</span>
                          <button
                            type="button"
                            className="da-tree-member__more"
                            title={t('more')}
                            onClick={(e) => openMemberMenu(e, mItem, g.id)}
                          >
                            <IconMore size={12} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {newOpen && (
        <Popup
          x={newPos.x}
          y={newPos.y}
          width={240}
          onClose={() => setNewOpen(false)}
          anchorEl={newAnchor}
          className="da-popup da-popup--panel"
        >
          <div className="da-popup__title">{t('newProject')}</div>
          <input
            className="da-popup__input"
            placeholder={t('inputGroupName')}
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNew()
            }}
          />
          <div className="da-popup__chips">
            {PRESET_NAMES.map((p) => (
              <button key={p} type="button" className="da-chip" onClick={() => setNewName(p)}>
                {p}
              </button>
            ))}
          </div>
          <div className="da-popup__footer">
            <button type="button" className="da-btn da-btn--ghost" onClick={() => setNewOpen(false)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className="da-btn da-btn--primary"
              disabled={newName.trim().length === 0}
              onClick={() => void submitNew()}
            >
              {t('create')}
            </button>
          </div>
        </Popup>
      )}

      {menu !== null && (
        <Popup
          x={menu.x}
          y={menu.y}
          width={176}
          onClose={() => setMenu(null)}
          anchorEl={menu.anchor}
          className="da-popup da-popup--menu"
        >
          <button
            type="button"
            className="da-popup__item"
            onClick={() => {
              setEditing({ id: menu.group.id, name: menu.group.name })
              setMenu(null)
            }}
          >
            <IconPencil size={14} />
            <span className="da-popup__label">{t('renameGroup')}</span>
          </button>
          <button
            type="button"
            className="da-popup__item da-popup__item--danger"
            onClick={() => {
              setRemoveTarget(menu.group)
              setMenu(null)
            }}
          >
            <IconTrash size={14} />
            <span className="da-popup__label">{t('removeGroup')}</span>
          </button>
        </Popup>
      )}

      {memberMenu !== null &&
        (() => {
          const others = groups.filter((g) => g.id !== memberMenu.groupId)
          return (
            <Popup
              x={memberPos.x}
              y={memberPos.y}
              width={176}
              onClose={() => setMemberMenu(null)}
              anchorEl={memberMenu.anchor}
              className="da-popup da-popup--menu"
            >
              <button
                type="button"
                className="da-popup__item da-popup__item--danger"
                onClick={() => {
                  const { item, groupId } = memberMenu
                  setMemberMenu(null)
                  void removeMember(item, groupId)
                }}
              >
                <IconTrash size={14} />
                <span className="da-popup__label">{t('removeFromGroupAction')}</span>
              </button>
              <div className="da-popup__title">{t('moveMemberMenu')}</div>
              {others.length === 0 ? (
                <div className="da-popup__title">{t('noGroupYet')}</div>
              ) : (
                others.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="da-popup__item"
                    onClick={() => {
                      const { item } = memberMenu
                      setMemberMenu(null)
                      void moveMemberTo(item, g)
                    }}
                  >
                    <IconFolder size={14} />
                    <span className="da-popup__label">{g.name}</span>
                  </button>
                ))
              )}
            </Popup>
          )
        })()}

      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} title={t('removeGroup')} width={420}>
        <p className="da-modal__desc">{t('removeGroupDesc')}</p>
        <div className="da-modal__actions">
          <button type="button" className="da-btn da-btn--ghost" onClick={() => setRemoveTarget(null)}>
            {t('cancel')}
          </button>
          <button type="button" className="da-btn da-btn--danger" onClick={() => void confirmRemove()}>
            {t('remove')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
