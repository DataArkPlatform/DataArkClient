/**
 * 页面占位卡 —— M1 阶段各页面仅需可验证路由的占位内容。
 */
export function PagePlaceholder({ milestone }: { milestone: string }): React.JSX.Element {
  return (
    <div className="da-placeholder-card">
      <span className="da-placeholder-card__tag">{milestone}</span>
      <span className="da-placeholder-card__text">实现此页面</span>
    </div>
  )
}
