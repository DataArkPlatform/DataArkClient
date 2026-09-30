import { useEffect } from 'react'
import { useAppStore } from './stores/useAppStore'
import { Titlebar } from './components/Titlebar'
import { AppShell } from './components/AppShell'
import { ToastHost } from './components/ToastHost'
import { OnboardingPage } from './pages/OnboardingPage'

/**
 * 应用根 —— 标题栏常驻；onboarding 为全窗覆盖页，其余进入应用外壳。
 * booted 前（引导检查 IPC 未返回）只渲染空壳，避免已完成的用户看到引导页闪一帧。
 */
function App(): React.JSX.Element {
  const currentPage = useAppStore((s) => s.currentPage)
  const booted = useAppStore((s) => s.booted)
  const initOnboarding = useAppStore((s) => s.initOnboarding)

  useEffect(() => {
    initOnboarding()
  }, [initOnboarding])

  return (
    <div className="da-app">
      <Titlebar />
      {booted && (currentPage === 'onboarding' ? <OnboardingPage /> : <AppShell />)}
      <ToastHost />
    </div>
  )
}

export default App
