/**
 * 读取完成态（AI Agent-3）—— 步骤指示器（02 激活）+ 统计条（含「查看全部会话」深色按钮）
 * + 平台筛选 + 双列卡片网格。无底部操作（手动读取在页面头部行）。
 */
import { useMemo, useState } from 'react'
import type { AgentSource } from '../../../../shared/unified-model'
import type { ScanDoneCard, ScanDonePayload } from '../../../../shared/data-contract'
import { useI18n } from '../../stores/useI18n'
import { isSourceIconMono, sourceColor, sourceIcon, sourceLabel } from '../../utils/source'
import { IconChat } from '../icons'
import { ScanSteps } from './ScanSteps'

interface DonePanelProps {
  payload: ScanDonePayload
  /** 本次实际读取的数据源明细（顺序 = 读取顺序；ok=该源无错误，newCount=该源新增会话数） */
  scanned: ReadonlyArray<ScannedSourceResult>
  /** 库内累计会话数（renderer 完成时查询） */
  cumulativeTotal: number | null
  /** 本次读取总耗时（ms） */
  totalMs: number
  onViewAll: () => void
}

/** 单次扫描中某个数据源的结果（覆盖平台统计 + 平台筛选依据） */
export interface ScannedSourceResult {
  source: AgentSource
  ok: boolean
  newCount: number
}

/** 图标缩写兜底：平台 logo 缺失时以两字母标识 */
const SOURCE_ABBR: Record<AgentSource, string> = {
  opencode: 'OC',
  codex: 'CX',
  'claude-code': 'CC',
  copilot: 'CP',
  'gemini-cli': 'GC',
  qoder: 'QD',
  'deepseek-harness': 'DS'
}

export function DonePanel({
  payload,
  scanned,
  cumulativeTotal,
  totalMs,
  onViewAll
}: DonePanelProps): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const { report, cards } = payload
  const allOk = report.errors.length === 0
  // 覆盖平台 = 本次实际读取且无错误的数据源数 / 本次读取的数据源总数
  const sourceTotal = scanned.length
  const covered = scanned.filter((s) => s.ok).length

  /* 平台筛选：全部 + 本次读取过的数据源各一枚胶囊，客户端过滤结果卡 */
  const [platformFilter, setPlatformFilter] = useState<'all' | AgentSource>('all')
  const presentSources = useMemo(
    () => Array.from(new Set(scanned.map((s) => s.source))),
    [scanned]
  )
  const visibleCards = useMemo(
    () => (platformFilter === 'all' ? cards : cards.filter((c) => c.source === platformFilter)),
    [cards, platformFilter]
  )
  // 数量口径：本次新增会话数（按源），而非结果卡条数（卡片上限 12）
  const newCountOf = useMemo(() => {
    const map = new Map<AgentSource, number>()
    for (const s of scanned) map.set(s.source, (map.get(s.source) ?? 0) + s.newCount)
    return map
  }, [scanned])
  const countOf = (source: 'all' | AgentSource): number =>
    source === 'all' ? report.scannedNew : (newCountOf.get(source) ?? 0)

  return (
    <div className="da-scan-done">
      {/* 步骤指示器：01 未激活 → 02 激活（AI Agent-3 保留在顶部） */}
      <ScanSteps active={2} />

      <div className="da-scan-stats">
        <div className="da-scan-stat">
          <span className="da-scan-stat__label">{t('newAdded')}</span>
          <span className="da-scan-stat__value">{report.scannedNew}</span>
          <span className="da-scan-stat__unit">条</span>
        </div>
        <span className="da-scan-stat__divider" aria-hidden="true" />
        <div className="da-scan-stat">
          <span className="da-scan-stat__label">{t('coveredPlatform')}</span>
          <span className="da-scan-stat__value">
            {covered}/{sourceTotal}
          </span>
          {allOk && <span className="da-scan-stat__tag">{t('allSuccess')}</span>}
        </div>
        <span className="da-scan-stat__divider" aria-hidden="true" />
        <div className="da-scan-stat">
          <span className="da-scan-stat__label">{t('elapsed')}</span>
          <span className="da-scan-stat__value">{(totalMs / 1000).toFixed(1)}</span>
          <span className="da-scan-stat__unit">s</span>
        </div>
        <span className="da-scan-stat__divider" aria-hidden="true" />
        <div className="da-scan-stat">
          <span className="da-scan-stat__label">{t('cumulative')}</span>
          <span className="da-scan-stat__value">{cumulativeTotal ?? report.scannedNew}</span>
          <span className="da-scan-stat__unit">条</span>
        </div>
        {/* 统计条右侧嵌入「查看全部会话」深色按钮（Figma：Comments 图标 + 文案） */}
        <div className="da-scan-stats__cta">
          <button type="button" className="da-btn da-btn--dark" onClick={onViewAll}>
            <IconChat size={20} />
            {t('viewAll')}
          </button>
        </div>
      </div>

      <div className="da-scan-filter">
        <span className="da-scan-filter__label">{t('byPlatform')}</span>
        {(['all', ...presentSources] as const).map((source) => {
          const icon = source === 'all' ? undefined : sourceIcon(source)
          return (
            <button
              key={source}
              type="button"
              className={
                platformFilter === source
                  ? 'da-scan-filter__pill da-scan-filter__pill--active'
                  : 'da-scan-filter__pill'
              }
              onClick={() => setPlatformFilter(source)}
            >
              {icon !== undefined ? (
                <img
                  className="da-scan-filter__icon"
                  src={icon}
                  alt=""
                  draggable={false}
                  data-mono={isSourceIconMono(source)}
                />
              ) : source === 'all' ? null : (
                <span
                  className="da-scan-filter__dot"
                  style={{ background: sourceColor(source) }}
                  aria-hidden="true"
                />
              )}
              <span className="da-scan-filter__name">{source === 'all' ? t('all') : sourceLabel(source)}</span>
              <span className="da-scan-filter__count">{countOf(source)}</span>
            </button>
          )
        })}
      </div>

      {cards.length === 0 ? (
        <p className="da-scan-nocard">{t('noNewSessions')}</p>
      ) : visibleCards.length === 0 ? (
        <p className="da-scan-nocard">{t('noNewForPlatform')}</p>
      ) : (
        <div className="da-scan-grid">
          {visibleCards.map((card: ScanDoneCard) => {
            const icon = sourceIcon(card.source)
            return (
            <button
              key={card.id}
              type="button"
              className="da-scan-card"
              onClick={onViewAll}
              title={card.title}
            >
              <span className="da-scan-card__icon" aria-hidden="true">
                {icon !== undefined ? (
                  <img className="da-scan-card__logo" src={icon} alt="" draggable={false} />
                ) : (
                  <span style={{ color: sourceColor(card.source) }}>
                    {SOURCE_ABBR[card.source] ?? card.source.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="da-scan-card__info">
                <span className="da-scan-card__title">{card.title}</span>
                <span className="da-scan-card__meta">
                  {sourceLabel(card.source)} · {card.msgCount} {t('msgUnit')}
                </span>
              </span>
              <span className="da-scan-card__new">NEW</span>
            </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
