import { create } from 'zustand'

export type PageKey =
  | 'onboarding'
  | 'scan'
  | 'conversations'
  | 'detail'
  | 'trash'
  | 'settings'

interface AppState {
  currentPage: PageKey
  /** 用于侧边栏/页面内返回导航 */
  previousPage: PageKey | null
  /** 启动引导检查是否完成（完成前不渲染内容页，避免引导页闪一帧再跳转） */
  booted: boolean
  navigate: (page: PageKey) => void
  back: () => void
  /** 检查并初始化引导页完成状态（应用启动时调用一次） */
  initOnboarding: () => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'onboarding',
  previousPage: null,
  booted: false,
  navigate: (page) =>
    set((state) => ({
      currentPage: page,
      previousPage: page === state.currentPage ? state.previousPage : state.currentPage
    })),
  back: () =>
    set((state) =>
      state.previousPage === null
        ? state
        : { currentPage: state.previousPage, previousPage: null }
    ),
  initOnboarding: async () => {
    try {
      const completed = await window.api.data.getSetting('onboarding.completed')
      if (completed === true) {
        set({ currentPage: 'conversations' })
      }
    } catch (err) {
      // 读取失败按未完成处理（回到引导页），但打日志便于排查（如 DB 损坏等）
      console.error('[app] 读取引导完成状态失败，按未完成处理', err)
    } finally {
      // 无论成功失败都必须放行渲染，避免卡在空白页
      set({ booted: true })
    }
  }
}))
