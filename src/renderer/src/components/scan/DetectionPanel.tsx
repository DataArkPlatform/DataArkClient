/**
 * 待读取/读取中态顶部区（AI Agent-1 / AI Agent-2 共用）——
 * 居中步骤区（上下分隔线）+ 左摘要列 + 右上 CTA。
 * 读取中态：步骤 01 标签「读取中...」、CTA 变为红色渐变「取消读取」（Figma 1660:1397），
 * 进度卡由 RunningPanel 渲染在其下方。
 */
import type { ScanDetection } from '../../../../shared/data-contract'
import type { AgentSource } from '../../../../shared/unified-model'
import { useI18n } from '../../stores/useI18n'
import { isSourceIconMono, sourceColor, sourceIcon, sourceLabel } from '../../utils/source'
import scanningIcon from '../../assets/icons/scanning.svg'
import { ScanSteps } from './ScanSteps'
import type { DetectionSummary } from './types'

interface DetectionPanelProps {
  summary: DetectionSummary
  loading: boolean
  /** 手动扫描范围勾选（默认全部可用源） */
  selectedSources: ReadonlySet<AgentSource>
  onToggleSource: (source: AgentSource) => void
  onStart: () => void
  /** 读取中态：步骤标签 + CTA 切为取消读取 */
  running?: boolean
  onCancel?: () => void
  /** 完成过渡：随进度卡一起淡出 */
  className?: string
}

function getUnavailableTitle(reason?: string): string {
  switch (reason) {
    case 'not_implemented':
      return '暂不支持该平台'
    case 'no_data':
      return '未检测到数据，点击前往设置配置路径'
    case 'access_denied':
      return '权限不足，请检查文件权限'
    case 'corrupted':
      return '数据损坏，请检查源文件'
    case 'detect_error':
      return '检测出错，请稍后重试'
    default:
      return '不可用'
  }
}

function getUnavailableText(reason?: string): string {
  switch (reason) {
    case 'not_implemented':
      return '即将支持'
    case 'no_data':
      return '未检测到数据'
    case 'access_denied':
      return '权限不足'
    case 'corrupted':
      return '数据损坏'
    case 'detect_error':
      return '检测失败'
    default:
      return '不可用'
  }
}

/** 胶囊平台标识：有图标则渲染 20px logo，未知源回退彩色圆点（Figma 1914:226） */
function PillIcon({ source }: { source: string }): React.JSX.Element {
  const icon = sourceIcon(source)
  if (icon === undefined) {
    return (
      <span className="da-scan-pill__dot" style={{ background: sourceColor(source) }} aria-hidden="true" />
    )
  }
  return (
    <img
      className="da-scan-pill__icon"
      src={icon}
      alt=""
      draggable={false}
      data-mono={isSourceIconMono(source) ? 'true' : undefined}
    />
  )
}

export function DetectionPanel({
  summary,
  loading,
  selectedSources,
  onToggleSource,
  onStart,
  running = false,
  onCancel,
  className
}: DetectionPanelProps): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const { detections, sourceCount, totalSessions } = summary
  const hasSources = sourceCount > 0
  const selectedAvailable = detections.filter(
    (d) => d.available && selectedSources.has(d.source)
  ).length

  return (
    <div className={`da-scan-idle ${className || ''}`}>
      {/* 步骤指示器（Figma：01 手动读取/读取中 → 02 读取完成） */}
      <ScanSteps active={1} running={running} />

      <div className="da-scan-body">
        <div className="da-scan-body__main">
          <p className="da-scan-detect-desc">{t('detectDesc')}</p>
          <p className="da-scan-detect-found">
            {t('detectFoundA')}
            <strong>{sourceCount}</strong>
            {t('detectFoundB')}
            <strong>{totalSessions}</strong>
            {t('detectFoundC')}
          </p>

          {loading ? (
            <div className="da-scan-skel" aria-hidden="true">
              <span className="da-scan-skel__bar" style={{ maxWidth: 420 }} />
            </div>
          ) : hasSources ? (
            <div className="da-scan-pills">
              {detections.map((d: ScanDetection) =>
                d.available ? (
                  <button
                    key={d.source}
                    type="button"
                    className={
                      selectedSources.has(d.source) ? 'da-scan-pill' : 'da-scan-pill da-scan-pill--off'
                    }
                    aria-pressed={selectedSources.has(d.source)}
                    title={selectedSources.has(d.source) ? '点击排除本次读取' : '点击加入本次读取'}
                    onClick={() => onToggleSource(d.source)}
                  >
                    <PillIcon source={d.source} />
                    {sourceLabel(d.source)}
                    <span className="da-scan-pill__count">
                      {d.sessionCount ?? 0}
                      <span className="da-scan-pill__unit">{t('pillUnit')}</span>
                    </span>
                  </button>
                ) : (
                  <button
                    key={d.source}
                    type="button"
                    className={`da-scan-pill da-scan-pill--unavailable ${d.unavailableReason === 'not_implemented' ? 'da-scan-pill--not-implemented' : ''}`}
                    disabled={d.unavailableReason === 'not_implemented'}
                    title={getUnavailableTitle(d.unavailableReason)}
                    onClick={() => d.unavailableReason === 'no_data' && onToggleSource(d.source)}
                  >
                    <PillIcon source={d.source} />
                    {sourceLabel(d.source)}
                    <span className="da-scan-pill__unavailable-text">
                      {getUnavailableText(d.unavailableReason)}
                    </span>
                  </button>
                )
              )}
            </div>
          ) : (
            <p className="da-scan-nosources">{t('noSourcesFound')}</p>
          )}

          <p className="da-scan-modelnote">{t('modelNote')}</p>
        </div>

        <div className="da-scan-body__side">
          {/* CTA（Figma：悬停底容器 r12 p8 内嵌深色/红色渐变按钮） */}
          <div className="da-scan-cta-wrap">
            {running ? (
              <button
                type="button"
                className="da-scan-cta da-scan-cta--cancel"
                onClick={onCancel}
                aria-label={t('cancelRead')}
              >
                <img src={scanningIcon} alt="" draggable={false} />
                {t('cancelRead')}
              </button>
            ) : (
              <button
                type="button"
                className="da-scan-cta da-scan-cta--dark"
                disabled={!hasSources || selectedAvailable === 0}
                onClick={onStart}
                aria-label={t('startReading')}
              >
                <img src={scanningIcon} alt="" draggable={false} />
                {t('startReading')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}