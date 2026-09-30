import { create } from 'zustand'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'dataark-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(THEME_KEY)
  return saved === 'dark' ? 'dark' : 'light'
}

const initialTheme = getInitialTheme()

// 首帧渲染前应用主题，避免闪白
if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = initialTheme
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
    set({ theme })
  },
  toggle: () =>
    set((state) => {
      const next: Theme = state.theme === 'light' ? 'dark' : 'light'
      document.documentElement.dataset.theme = next
      window.localStorage.setItem(THEME_KEY, next)
      return { theme: next }
    })
}))
