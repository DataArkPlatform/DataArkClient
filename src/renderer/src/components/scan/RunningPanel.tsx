/**
 * 读取中态（AI Agent-2）—— 单张进度卡（对齐 Figma 1660:239）：
 * 标题行（正在读取 + 平台计数）→ 24px 渐变进度条（滑块内嵌 logo + 中段扫描细线）
 * → 统计行（DINPro 数字）→ 分隔线 → 内嵌日志面板（rgba(222,222,222,0.2) 圆角8）。
 * 取消入口在顶部 CTA 槽位（DetectionPanel running 态红色「取消读取」），本组件不重复渲染取消按钮。
 */
import { useI18n, type I18nKey } from '../../stores/useI18n'
import { isSourceIconMono, sourceColor, sourceIcon, sourceLabel } from '../../utils/source'
import logoMark from '../../assets/logo/logo-mark-24.png'
import type { SourceLog } from './types'

/** 日志行平台标识：有图标则渲染 16px logo，未知源回退彩色圆点（对齐 Figma 1660:239） */
function LogIcon({ source }: { source: string }): React.JSX.Element {
  const icon = sourceIcon(source)
  if (icon === undefined) {
    return (
      <span className="da-scan-log__dot" aria-hidden="true" style={{ backgroundColor: sourceColor(source) }} />
    )
  }
  return (
    <img
      className="da-scan-log__icon"
      src={icon}
      alt=""
      draggable={false}
      data-mono={isSourceIconMono(source) ? 'true' : undefined}
    />
  )
}

interface RunningPanelProps {
  logs: SourceLog[]
  doneSources: number
  totalSources: number
  progressPct: number
  processedCount: number
  elapsedSec: number
  logsRevealed: boolean
  className?: string
}

/** 状态说明部分（来源名由 .da-scan-log__source 独立渲染，深色下双色区分） */
function logDetail(log: SourceLog, t: (key: I18nKey) => string): string {
  if (log.status === 'done') {
    return `${t('scanDoneLog')} ${log.count} ${t('sessions')}（${(log.elapsedMs / 1000).toFixed(1)}s）`
  }
  if (log.status === 'active') {
    // 读取中实时展示已处理会话数（count===total 为探测期/首会话，不显示以免误读为已完成）
    if (log.total > 0 && log.count < log.total) {
      return `${t('readingIng')} ${log.count}/${log.total}`
    }
    return t('readingIng')
  }
  return t('waiting')
}

export function RunningPanel({
  logs,
  doneSources,
  totalSources,
  progressPct,
  processedCount,
  elapsedSec,
  logsRevealed,
  className
}: RunningPanelProps): React.JSX.Element {
  const t = useI18n((s) => s.t)

  return (
    <div className={`da-scan-running ${className || ''}`}>
      <div className="da-scan-progress">
        <div className="da-scan-progress__head">
          <span className="da-scan-progress__title">{t('reading')}</span>
          <span className="da-scan-progress__counter">
            {t('readingProgress')} {doneSources}/{totalSources} {t('platforms')}
          </span>
        </div>

        <div className="da-scan-progress__track" role="progressbar" aria-valuenow={progressPct}>
          <div
            className="da-scan-progress__fill"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          >
            {/* 中段扫描细线（纯装饰，随进度推进） */}
            <span className="da-scan-progress__scanlines" aria-hidden="true" />
            {/* 滑块：白色圆钮 + 内嵌 logo */}
            <span className="da-scan-progress__knob" aria-hidden="true">
              <img src={logoMark} alt="" draggable={false} />
            </span>
          </div>
        </div>

        <div className="da-scan-progress__stats">
          <span className="da-scan-stat">
            <span className="da-scan-stat__label">{t('doneLog')}</span>
            <strong className="da-scan-stat__num">{processedCount}</strong>
            <span className="da-scan-stat__unit">{t('sessions')}</span>
          </span>
          <span className="da-scan-stat">
            <span className="da-scan-stat__label">{t('elapsed')}</span>
            <strong className="da-scan-stat__num">{elapsedSec.toFixed(1)}</strong>
            <span className="da-scan-stat__unit">s</span>
          </span>
        </div>

        <div className="da-scan-progress__divider" aria-hidden="true" />

        <div className="da-scan-progress__logs">
          {logsRevealed
            ? logs.map((log) => (
                <div key={log.source} className="da-scan-log" data-status={log.status}>
                  <LogIcon source={log.source} />
                  <span className="da-scan-log__text">
                    <span className="da-scan-log__source">{sourceLabel(log.source)}</span>
                    {' — '}
                    {logDetail(log, t)}
                  </span>
                </div>
              ))
            : [0, 1, 2].map((i) => (
                <div key={i} className="da-scan-skel" aria-hidden="true">
                  <span className="da-scan-skel__bar" style={{ maxWidth: i === 1 ? 320 : undefined }} />
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}
