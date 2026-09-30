/**
 * 剪贴板写入 —— 优先 navigator.clipboard（Electron file:// 属安全上下文，可用），
 * 失败时回退隐藏 textarea + document.execCommand('copy')（Electron 兼容路径）。
 * 保证所有复制入口（复制全部 / 代码块 / 成果文件名）都不会抛出未处理异常。
 */
export async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* 回退到 execCommand */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  let ok: boolean
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  if (!ok) throw new Error('clipboard write failed')
}
