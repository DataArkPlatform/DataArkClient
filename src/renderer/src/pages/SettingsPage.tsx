/**
 * 设置页（H1：704×724 白色浮层，来源页保持在遮罩之下）——
 * 自动备份（开关 + 目录选择）/ 自动读取（开关 + 频率 + 新会话通知）/
 * 语言（分段控件）/ 关于（版本·协议·技术栈）。
 *
 * 设置读写走 settings DAO（JSON 键值）；自动读取设置变更即时生效
 * （主进程 settingsSet 处理器会重排 scheduler 定时器）。
 * 关闭（右上角 / 遮罩 / Esc）= 返回来源页（useAppStore.back）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ScanDetection } from '../../../shared/data-contract'
import type { AgentSource } from '../../../shared/unified-model'
import { useAppStore } from '../stores/useAppStore'
import { useI18n } from '../stores/useI18n'
import { useToastStore } from '../stores/useToastStore'
import { sourceLabel } from '../utils/source'
import { Switch } from '../components/settings/Switch'
import { SettingsCard } from '../components/settings/SettingsCard'
import { IconClose } from '../components/icons'

const FREQ_OPTIONS = [1, 2, 4, 6, 12, 24]

export function SettingsPage(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const toast = useToastStore((s) => s)
  const navigate = useAppStore((s) => s.navigate)

  const [loading, setLoading] = useState(true)
  const [backupEnabled, setBackupEnabled] = useState(false)
  const [backupDir, setBackupDir] = useState('')
  const [readEnabled, setReadEnabled] = useState(false)
  const [intervalHours, setIntervalHours] = useState(4)
  const [notify, setNotify] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  /** 平台探测结果（读取范围勾选数据源） */
  const [detections, setDetections] = useState<ScanDetection[]>([])
  /** 定时读取范围（'autoRead.sources'；空数组=用户显式全不勾） */
  const [autoSources, setAutoSources] = useState<AgentSource[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  /** 关闭浮层 → 返回来源页；返回目标失效（null / onboarding）时兜底，保证浮层永远可关闭 */
  const closeSettings = (): void => {
    const { previousPage, back, navigate } = useAppStore.getState()
    if (previousPage === null || previousPage === 'onboarding') {
      navigate('scan')
    } else {
      back()
    }
  }

  /* ---- 挂载：聚焦面板 + Esc 关闭 ---- */
  useEffect(() => {
    panelRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  /* ---- 挂载加载全部设置 + 版本 ---- */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [be, bd, re, ih, nf, ver] = await Promise.all([
          window.api.data.getSetting('autoBackup.enabled'),
          window.api.data.getSetting('autoBackup.dir'),
          window.api.data.getSetting('autoRead.enabled'),
          window.api.data.getSetting('autoRead.intervalHours'),
          window.api.data.getSetting('autoRead.notify'),
          window.api.data.appVersion()
        ])
        if (cancelled) return
        setBackupEnabled(be === true)
        setBackupDir(typeof bd === 'string' ? bd : '')
        setReadEnabled(re === true)
        setIntervalHours(typeof ih === 'number' ? ih : 4)
        setNotify(nf !== false)
        setAppVersion(typeof ver === 'string' ? ver : '1.0.0')
        setLoading(false)
      } catch (err) {
        console.error('[settings] 加载设置失败', err)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ---- 平台探测 + 定时范围加载（设置加载完成后） ---- */
  useEffect(() => {
    if (loading) return
    void (async () => {
      try {
        const [dets, rawSources] = await Promise.all([
          window.api.data.detectSources(),
          window.api.data.getSetting('autoRead.sources')
        ])
        setDetections(dets)
        if (Array.isArray(rawSources)) {
          setAutoSources(rawSources.filter((s): s is AgentSource => typeof s === 'string'))
        } else {
          // 从未配置过：默认全部可用源
          setAutoSources(dets.filter((d) => d.available).map((d) => d.source))
        }
      } catch {
        /* 探测失败不阻塞设置页 */
      }
    })()
  }, [loading])

  /** 切换定时读取范围并即时持久化 */
  const toggleAutoSource = (source: AgentSource): void => {
    const next = autoSources.includes(source)
      ? autoSources.filter((s) => s !== source)
      : [...autoSources, source]
    setAutoSources(next)
    void window.api.data.setSetting('autoRead.sources', next).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }

  const toggleBackup = (value: boolean): void => {
    setBackupEnabled(value)
    void window.api.data.setSetting('autoBackup.enabled', value).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
      setBackupEnabled(!value)
    })
  }

  const toggleRead = (value: boolean): void => {
    setReadEnabled(value)
    void window.api.data.setSetting('autoRead.enabled', value).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
      setReadEnabled(!value)
    })
  }

  const changeFreq = (hours: number): void => {
    setIntervalHours(hours)
    void window.api.data.setSetting('autoRead.intervalHours', hours).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }

  const toggleNotify = (value: boolean): void => {
    setNotify(value)
    void window.api.data.setSetting('autoRead.notify', value).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }

  const handlePickBackupDir = async (): Promise<void> => {
    try {
      const dir = await window.api.data.pickBackupDir()
      if (dir !== null) {
        setBackupDir(dir)
        await window.api.data.setSetting('autoBackup.dir', dir)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /** 点击遮罩（非面板本体）关闭 */
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) closeSettings()
  }

  return (
    <div className="da-settings-overlay" onClick={handleOverlayClick}>
      <div
        ref={panelRef}
        className="da-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
      >
        {/* 面板头部（Figma：标题 16px/24 + 右上 24×24 关闭 + y48 分隔线） */}
        <div className="da-settings-modal__head">
          <h1 className="da-settings-modal__title">设置</h1>
          <button
            type="button"
            className="da-settings-modal__close"
            aria-label="关闭"
            onClick={closeSettings}
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="da-settings-modal__divider" aria-hidden="true" />

        {loading ? (
          <div className="da-settings-modal__loading">
            <span className="da-conv-list__spinner" aria-hidden="true" />
          </div>
        ) : (
          <div className="da-settings-modal__body">
            {/* 自动备份 */}
            <SettingsCard title={t('autoBackup')}>
              <div className="da-settings-row">
                <Switch
                  checked={backupEnabled}
                  onChange={toggleBackup}
                  aria-label={t('enableAutoBackup')}
                />
                <span className="da-settings-row__label">{t('enableAutoBackup')}</span>
              </div>
              {backupEnabled && (
                <div className="da-settings-subsection">
                  <label className="da-settings-label">{t('backupPath')}</label>
                  <div className="da-settings-dirline">
                    <input
                      type="text"
                      className="da-settings-input"
                      value={backupDir}
                      readOnly
                      title={backupDir}
                    />
                    <button
                      type="button"
                      className="da-settings-change"
                      onClick={() => void handlePickBackupDir()}
                    >
                      {t('changeAction')}
                    </button>
                  </div>
                  <p className="da-settings-hint">{t('autoBackupHint')}</p>
                </div>
              )}
            </SettingsCard>

            {/* 自动读取 */}
            <SettingsCard title={t('autoRead')}>
              <div className="da-settings-row">
                <Switch checked={readEnabled} onChange={toggleRead} aria-label={t('enableAutoRead')} />
                <span className="da-settings-row__label">{t('enableAutoRead')}</span>
              </div>
              {readEnabled && (
                <div className="da-settings-subsection">
                  <div className="da-settings-field">
                    {/* TODO-i18n: 读取范围（v1 固定中文） */}
                    <label className="da-settings-label">读取范围（定时仅扫描勾选平台）</label>
                    <div className="da-settings-sources">
                      {detections.map((d) => {
                        const checked = autoSources.includes(d.source)
                        return (
                          <button
                            key={d.source}
                            type="button"
                            disabled={!d.available}
                            className={checked ? 'da-chip da-chip--active' : 'da-chip'}
                            aria-pressed={checked}
                            title={d.available ? undefined : '未检测到该平台'}
                            onClick={() => toggleAutoSource(d.source)}
                          >
                            {sourceLabel(d.source)}
                            {!d.available &&
                              (d.unavailableReason === 'detect_error' ? '（检测失败）' : '（未检测到）')}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="da-settings-field">
                    <label className="da-settings-label" htmlFor="da-settings-freq">
                      {t('readFreq')}
                    </label>
                    <select
                      id="da-settings-freq"
                      className="da-settings-select"
                      value={intervalHours}
                      onChange={(e) => changeFreq(Number(e.target.value))}
                    >
                      {FREQ_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {t('perHour')} {h} {t('hour')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="da-settings-row">
                    <Switch checked={notify} onChange={toggleNotify} aria-label={t('newConvNotify')} />
                    <span className="da-settings-row__label">{t('newConvNotify')}</span>
                  </div>
                </div>
              )}
            </SettingsCard>

            {/* 语言（H11：分段控件与标题同行，容器 #EBEBEB） */}
            <div className="da-settings-card da-settings-card--row">
              <span className="da-settings-card__title">{t('language')}</span>
              <div className="da-settings-lang" role="radiogroup" aria-label={t('language')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked
                  className="da-settings-lang__seg da-settings-lang__seg--active"
                >
                  中文（简体）
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={false}
                  className="da-settings-lang__seg"
                  onClick={() => toast.info(t('langZhOnlyToast'))}
                >
                  English
                </button>
              </div>
            </div>

            {/* 关于 */}
            <SettingsCard title={t('about')}>
              <div className="da-settings-about">
                <div className="da-settings-about__row">
                  <span className="da-settings-about__label">{t('toolName')}</span>
                  <span className="da-settings-about__value">
                    语料方舟 DataArt — AI 会话管理工具
                  </span>
                </div>
                <div className="da-settings-about__row">
                  <span className="da-settings-about__label">{t('version')}</span>
                  <span className="da-settings-about__value">v{appVersion}</span>
                </div>
                <div className="da-settings-about__row">
                  <span className="da-settings-about__label">{t('license')}</span>
                  <span className="da-settings-about__value">MIT</span>
                </div>
                <div className="da-settings-about__row">
                  <span className="da-settings-about__label">{t('techStack')}</span>
                  <span className="da-settings-about__value">Electron + React + TypeScript</span>
                </div>
                <div className="da-settings-about__row">
                  <span className="da-settings-about__label">GitHub：</span>
                  <a
                    className="da-settings-link da-settings-about__value"
                    href="https://github.com/DataArkPlatform/DataArkClient"
                    target="_blank"
                    rel="noreferrer"
                  >
                    github.com/DataArkPlatform/DataArkClient
                  </a>
                </div>
              </div>
              <div className="da-settings-about__guide">
                <button
                  type="button"
                  className="da-btn da-btn--ghost da-btn--sm"
                  onClick={() => navigate('onboarding')}
                >
                  {t('viewGuideAgain')}
                </button>
              </div>
            </SettingsCard>
          </div>
        )}
      </div>
    </div>
  )
}
