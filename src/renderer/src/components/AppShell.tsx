import { useAppStore, type PageKey } from '../stores/useAppStore'
import { Sidebar } from './Sidebar'
import { ScanPage } from '../pages/ScanPage'
import { ConversationsPage } from '../pages/ConversationsPage'
import { DetailPage } from '../pages/DetailPage'
import { TrashPage } from '../pages/TrashPage'
import { SettingsPage } from '../pages/SettingsPage'

function renderPage(page: PageKey): React.JSX.Element {
  switch (page) {
    case 'scan':
      return <ScanPage />
    case 'conversations':
      return <ConversationsPage />
    case 'detail':
      return <DetailPage />
    case 'trash':
      return <TrashPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <ScanPage />
  }
}

/**
 * 主区域外壳 —— 侧边栏 + 可滚动内容区。
 * 页面标题由各页自带（按 Figma 各帧的行内布局：标题与工具行同排）。
 * 设置页为浮层（H1）：来源页保持挂载在遮罩之下，关闭后原样返回。
 */
export function AppShell(): React.JSX.Element {
  const currentPage = useAppStore((s) => s.currentPage)
  const previousPage = useAppStore((s) => s.previousPage)

  const isSettings = currentPage === 'settings'
  const basePage = isSettings ? (previousPage ?? 'scan') : currentPage

  return (
    <div className="da-shell">
      <Sidebar />
      <main className="da-main">
        <div className="da-main__content">{renderPage(basePage)}</div>
      </main>
      {isSettings && <SettingsPage />}
    </div>
  )
}