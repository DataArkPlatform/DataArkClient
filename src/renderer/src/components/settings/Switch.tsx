/**
 * Switch —— 设置页开关（原型 toggle：40×22 圆角轨道 + 18px 白色旋钮，
 * ON 态品牌色填充 + 旋钮右移 150ms 动画）。
 */
interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 无障碍标签（有 label 文案时用 label） */
  'aria-label'?: string
  disabled?: boolean
}

export function Switch({
  checked,
  onChange,
  'aria-label': ariaLabel,
  disabled
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={checked ? 'da-switch da-switch--on' : 'da-switch'}
      onClick={() => onChange(!checked)}
    >
      <span className="da-switch__knob" />
    </button>
  )
}
