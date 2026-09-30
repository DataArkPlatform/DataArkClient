/**
 * SettingsCard —— 设置页卡片容器（原型 .card：surface 底、radius-lg、
 * 20px 内边距、卡片间距 16px）。
 */
interface SettingsCardProps {
  title: string
  children: React.ReactNode
}

export function SettingsCard({ title, children }: SettingsCardProps): React.JSX.Element {
  return (
    <div className="da-settings-card">
      <div className="da-settings-card__title">{title}</div>
      {children}
    </div>
  )
}
