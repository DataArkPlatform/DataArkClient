import { useEffect, useState } from 'react'
import { useAppStore, type PageKey } from '../stores/useAppStore'
import { useDataStore } from '../stores/useDataStore'
import { useI18n } from '../stores/useI18n'
import { useThemeStore } from '../stores/useThemeStore'
import { GroupsTree } from './GroupsTree'
import { IconChevronDown, IconSettings } from './icons'
import logoMark from '../assets/logo/logo-mark-24.png'
import robotIcon from '../assets/icons/robot.svg'
import commentsIcon from '../assets/icons/comments.svg'
import trashIcon from '../assets/icons/trash-nav.svg'
import paletteIcon from '../assets/icons/appearance.svg'

interface NavItem {
  page: 'scan' | 'conversations'
  icon: string
  labelKey: 'aiAgent' | 'conversations'
  badge?: string
}

export function Sidebar(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const currentPage = useAppStore((s) => s.currentPage)
  const navigate = useAppStore((s) => s.navigate)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const conversationTotal = useDataStore((s) => s.conversationTotal)
  const setConversationTotal = useDataStore((s) => s.setConversationTotal)
  const refreshGroups = useDataStore((s) => s.refreshGroups)
  const version = useDataStore((s) => s.version)

  /* ---- 折叠模式（56px 图标态，持久化） ---- */
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem('dataark-sidebar-collapsed') === '1'
  )
  const toggleCollapsed = (): void => {
    setCollapsed((v) => {
      localStorage.setItem('dataark-sidebar-collapsed', v ? '0' : '1')
      return !v
    })
  }

  // 回收站计数徽标：挂载 + 数据版本变化时刷新
  const [trashCount, setTrashCount] = useState<number>(0)
  useEffect(() => {
    void (async () => {
      try {
        const items = await window.api.data.listTrash()
        setTrashCount(items.length)
      } catch {
        /* 徽标非关键，失败静默 */
      }
    })()
  }, [version])

  // 挂载即拉取分组树 + 会话总数徽标
  useEffect(() => {
    void refreshGroups()
    void (async () => {
      try {
        const res = await window.api.data.listConversations({ limit: 1 })
        setConversationTotal(res.total)
      } catch (err) {
        console.error('[sidebar] 会话计数获取失败', err)
      }
    })()
  }, [refreshGroups, setConversationTotal])

  const isActive = (page: PageKey): boolean => currentPage === page

  const topNav: NavItem[] = [
    { page: 'scan', icon: robotIcon, labelKey: 'aiAgent' },
    {
      page: 'conversations',
      icon: commentsIcon,
      labelKey: 'conversations',
      badge: conversationTotal !== null ? String(conversationTotal) : undefined
    }
  ]

  return (
    <aside className={collapsed ? 'da-sidebar da-sidebar--collapsed' : 'da-sidebar'}>
      <nav className="da-sidebar__nav" aria-label="主导航">
        {topNav.map((item) => (
          <button
            key={item.page}
            type="button"
            title={t(item.labelKey)}
            className={isActive(item.page) ? 'da-nav-item da-nav-item--active' : 'da-nav-item'}
            onClick={() => navigate(item.page)}
          >
            <span className="da-nav-item__icon">
              <img src={item.icon} alt="" draggable={false} />
            </span>
            <span className="da-nav-item__label">{t(item.labelKey)}</span>
            {item.badge !== undefined && <span className="da-nav-item__badge">{item.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="da-sidebar__divider" role="separator" />

      <GroupsTree />

      <div className="da-sidebar__spacer" />

      <div className="da-sidebar__bottom">
        {/* 回收站 */}
        <button
          type="button"
          title={t('trash')}
          className={isActive('trash') ? 'da-nav-item da-nav-item--active' : 'da-nav-item'}
          onClick={() => navigate('trash')}
        >
          <span className="da-nav-item__icon">
            <img src={trashIcon} alt="" draggable={false} />
          </span>
          <span className="da-nav-item__label">{t('trash')}</span>
          {trashCount > 0 && <span className="da-nav-item__badge">{trashCount}</span>}
        </button>

        {/* 外观（Figma：回收站之后、设置之前） */}
        <div className="da-appearance">
          <span className="da-appearance__label">
            <img src={paletteIcon} alt="" draggable={false} />
            {t('appearance')}
          </span>
          <div className="da-appearance__segmented" role="radiogroup" aria-label={t('appearance')}>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'light'}
              className={theme === 'light' ? 'da-segment da-segment--active' : 'da-segment'}
              onClick={() => setTheme('light')}
            >
              {t('lightMode')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'dark'}
              className={theme === 'dark' ? 'da-segment da-segment--active' : 'da-segment'}
              onClick={() => setTheme('dark')}
            >
              {t('darkMode')}
            </button>
          </div>
        </div>

        {/* 设置（设计稿此处图标为 Delete 占位，沿用齿轮 IconSettings） */}
        <button
          type="button"
          title={t('settings')}
          className={isActive('settings') ? 'da-nav-item da-nav-item--active' : 'da-nav-item'}
          onClick={() => navigate('settings')}
        >
          <span className="da-nav-item__icon">
            <IconSettings size={14} />
          </span>
          <span className="da-nav-item__label">{t('settings')}</span>
        </button>

        {/* 折叠模式切换（原有功能，仅样式对齐） */}
        <button
          type="button"
          className="da-nav-item da-sidebar__collapse"
          title={collapsed ? t('expand') : t('collapse')}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          <span
            className="da-nav-item__icon da-sidebar__collapse-icon"
            style={{ transform: collapsed ? 'rotate(90deg)' : 'rotate(-90deg)' }}
            aria-hidden="true"
          >
            <IconChevronDown size={16} />
          </span>
          <span className="da-nav-item__label">{collapsed ? t('expand') : t('collapse')}</span>
        </button>

        {/* 底部个人资料行（Figma：28px 头像 + 语料方舟 v1.0.0·MIT 同行 + 帮助） */}
        <div className="da-sidebar__profile">
          <span className="da-sidebar__avatar" aria-hidden="true">
            <img src={logoMark} alt="" draggable={false} />
          </span>
          <div className="da-sidebar__profile-info">
            <span className="da-sidebar__profile-name">语料方舟</span>
            <span className="da-sidebar__profile-version">v1.0.0-MIT</span>
          </div>
        
        </div>
      </div>
    </aside>
  )
}
