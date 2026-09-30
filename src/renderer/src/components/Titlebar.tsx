import { useEffect, useState } from 'react'
import { useI18n } from '../stores/useI18n'
import { IconClose, IconMaximize, IconMaximizeRestore, IconMinimize } from './icons'
import logoMark from '../assets/logo/logo-mark-24.png'

/**
 * 自定义标题栏 —— 整条为拖拽区，右侧窗口控制为 no-drag 区。
 * 最大化按钮按窗口状态切换图标（□ ↔ 双叠方块），初始值查询 + 订阅主进程推送。
 */
export function Titlebar(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let disposed = false
    void window.api.isMaximized().then((value) => {
      if (!disposed) setMaximized(value)
    })
    const off = window.api.onMaximizedChange(setMaximized)
    return () => {
      disposed = true
      off()
    }
  }, [])

  return (
    <header className="da-titlebar">
      <div className="da-titlebar__left">
        <img className="da-titlebar__logo" src={logoMark} alt="" aria-hidden="true" />
        {/* Figma：DataArk - 语料方舟（水平单行，14px Medium + 12px） */}
        <div className="da-titlebar__titles">
          <span className="da-titlebar__brand">DataArk</span>
          <span className="da-titlebar__sep">-</span>
          <span className="da-titlebar__title">语料方舟</span>
        </div>
      </div>

      <div className="da-titlebar__right">
        <button
          type="button"
          className="da-titlebar__btn"
          title={t('minimize')}
          onClick={() => void window.api.minimize()}
        >
          <IconMinimize size={14} />
        </button>
        <button
          type="button"
          className="da-titlebar__btn"
          title={maximized ? t('restore') : t('maximize')}
          onClick={() => void window.api.toggleMaximize()}
        >
          {maximized ? <IconMaximizeRestore size={14} /> : <IconMaximize size={14} />}
        </button>
        <button
          type="button"
          className="da-titlebar__btn da-titlebar__btn--close"
          title={t('close')}
          onClick={() => void window.api.close()}
        >
          <IconClose size={14} />
        </button>
      </div>
    </header>
  )
}
