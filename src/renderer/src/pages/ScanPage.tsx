/**
 * AI Agent 读取页（M6）—— 三态向导：待读取 → 读取中 → 读取完成。
 *
 * - 待读取：探测全部数据源（window.api.data.detectSources）→ 摘要 + 平台胶囊 + 渐变 CTA。
 * - 读取中：保留待读取区（步骤 01 切「读取中...」+ 摘要/胶囊/说明 + CTA 槽位红色「取消读取」），
 *   其下渲染进度卡（RunningPanel：标题 + 平台计数 + 进度条 + 统计行 + 分平台日志）；
 *   startScan 在 worker 线程执行真实 ingest，进度事件驱动进度条与分平台日志，
 *   秒表 500ms 刷新「已读取 N 条会话 · 耗时 Ts」；骨架行最短 800ms。
 * - 取消/失败：scanError('cancelled') → toast + 复位待读取（保留探测）；其他错误 → toast.error。
 * - 完成：统计条（新增/覆盖平台/耗时/累计）+ 「全部」筛选 + 双列结果网格 + 查看全部（页头手动读取）；
 *   成功后 bump useDataStore.version + refreshGroups，会话管理页下次挂载即重拉。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScanDetection, ScanDonePayload, ScanProgress } from '../../../shared/data-contract'
import type { AgentSource } from '../../../shared/unified-model'
import { useAppStore } from '../stores/useAppStore'
import { useDataStore } from '../stores/useDataStore'
import { useI18n } from '../stores/useI18n'
import { useToastStore } from '../stores/useToastStore'
import { IconClickTap } from '../components/icons'
import { DetectionPanel } from '../components/scan/DetectionPanel'
import { RunningPanel } from '../components/scan/RunningPanel'
import { DonePanel, type ScannedSourceResult } from '../components/scan/DonePanel'
import type { ScanPhase, SourceLog } from '../components/scan/types'
import '../styles/scan.css'

/** 骨架行最短展示时长（原型 startScan 内 800ms） */
const SKELETON_MIN_MS = 800
/** 读取中秒表刷新间隔 */
const TICK_MS = 500

export function ScanPage(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const t = useI18n((s) => s.t)

  const [phase, setPhase] = useState<ScanPhase>('idle')
  const [detections, setDetections] = useState<ScanDetection[]>([])
  const [detectionLoading, setDetectionLoading] = useState(true)
  const [logs, setLogs] = useState<SourceLog[]>([])
  const [progressPct, setProgressPct] = useState(0)
  const [processedCount, setProcessedCount] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [donePayload, setDonePayload] = useState<ScanDonePayload | null>(null)
  const [cumulativeTotal, setCumulativeTotal] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState(0)

  const startedAtRef = useRef<number | null>(null)
  const sourceStartRef = useRef<Map<string, number>>(new Map())
  const firstProgressRef = useRef(false)
  const startingRef = useRef(false)
  const tickRef = useRef<number | null>(null)
  /** 多源顺序读取队列（一键读取全部已检测平台，载荷累加合并） */
  const pendingSourcesRef = useRef<AgentSource[]>([])
  const accumRef = useRef<ScanDonePayload | null>(null)
  /** 手动扫描范围勾选（默认全部可用源，页面临时态不持久化） */
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<AgentSource>>(new Set())
  /** 完成过渡：读取中 UI 淡出（250ms transition）后切换完成态 */
  const [progressHiding, setProgressHiding] = useState(false)
  const progressHideTimerRef = useRef<number | null>(null)
  /** 已完成的平台数（多源全局进度分子，回退口径） */
  const completedSourcesRef = useRef(0)
  /** 本次待读取平台总数（= 队列长度，handleStart 时确定） */
  const totalSourcesRef = useRef(0)
  /** 各平台本次待读字节量（discover 事件上报后记录） */
  const sourceWeightRef = useRef<Map<string, number>>(new Map())
  /** 已发现的全部平台待读字节总量（分母） */
  const totalWeightRef = useRef(0)
  /** 已完成平台的字节总量（分子，handleResult 时累加） */
  const completedWeightRef = useRef(0)
  /** 本次读取的数据源顺序（覆盖平台统计 + 平台筛选的基准） */
  const scannedOrderRef = useRef<AgentSource[]>([])
  /** 各数据源本次读取结果（ok=无错误，newCount=新增会话数） */
  const doneBySourceRef = useRef<Map<AgentSource, ScannedSourceResult>>(new Map())

  /* ---- 探测（挂载即跑；导航回本页会重新挂载刷新） ---- */
  useEffect(() => {
    let cancelled = false
    setDetectionLoading(true)
    window.api.data
      .detectSources()
      .then((result) => {
        if (cancelled) return
        setDetections(result)
        setSelectedSources(new Set(result.filter((d) => d.available).map((d) => d.source)))
        setDetectionLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[scan] detectSources 失败', err)
        setDetectionLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* ---- 复位到待读取态（取消/失败/再次读取共用，保留探测结果） ---- */
  const resetToIdle = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (progressHideTimerRef.current !== null) {
      window.clearTimeout(progressHideTimerRef.current)
      progressHideTimerRef.current = null
    }
    setProgressHiding(false)
    startedAtRef.current = null
    sourceStartRef.current.clear()
    firstProgressRef.current = false
    startingRef.current = false
    pendingSourcesRef.current = []
    accumRef.current = null
    completedSourcesRef.current = 0
    totalSourcesRef.current = 0
    sourceWeightRef.current.clear()
    totalWeightRef.current = 0
    completedWeightRef.current = 0
    scannedOrderRef.current = []
    doneBySourceRef.current.clear()
    setPhase('idle')
    setLogs([])
    setDonePayload(null)
    setCumulativeTotal(null)
    setTotalMs(0)
    setProgressPct(0)
    setProcessedCount(0)
    setElapsedSec(0)
  }, [])

  /* ---- 进度事件：驱动分平台日志 + 进度条 + 已读计数 ---- */
  const handleProgress = useCallback((evt: ScanProgress) => {
    firstProgressRef.current = true
    if (!sourceStartRef.current.has(evt.source)) {
      sourceStartRef.current.set(evt.source, Date.now())
    }
    setLogs((prev) => {
      let next = prev
      if (!next.some((l) => l.source === evt.source)) {
        next = [
          ...next,
          { source: evt.source, status: 'active' as const, count: 0, total: 0, elapsedMs: 0 }
        ]
      }
      return next.map((log) => {
        if (log.source !== evt.source) return log
        if (evt.phase === 'done') {
          const start = sourceStartRef.current.get(evt.source) ?? Date.now()
          return {
            ...log,
            status: 'done' as const,
            count: evt.current,
            total: evt.total,
            elapsedMs: Date.now() - start
          }
        }
        return {
          ...log,
          status: log.status === 'done' ? log.status : ('active' as const),
          count: evt.current,
          total: evt.total
        }
      })
    })
    setProcessedCount(evt.current)
    // 记录各平台待读字节量（discover 事件上报，只记一次）
    if (evt.weightTotal !== undefined && !sourceWeightRef.current.has(evt.source)) {
      sourceWeightRef.current.set(evt.source, evt.weightTotal)
      totalWeightRef.current += evt.weightTotal
    }
    const totalPlatforms = Math.max(1, totalSourcesRef.current)
    if (evt.phase === 'done') {
      setProgressPct((prev) => Math.max(prev, 100))
    } else if (totalWeightRef.current > 0) {
      // 字节加权真实进度：已完成平台字节 + 当前平台已读字节 / 已知总量，只增不减
      const global = Math.round(
        ((completedWeightRef.current + (evt.weightCurrent ?? 0)) / totalWeightRef.current) * 100
      )
      setProgressPct((prev) => Math.max(prev, global))
    } else if (evt.phase === 'discover') {
      // 无权重信息（旧数据源）回退：随已完成平台数递增的下限（首源 ≥4%，保证瞬时扫描也可见）
      const floor = Math.max(4, Math.round((completedSourcesRef.current / totalPlatforms) * 100) + 1)
      setProgressPct((prev) => Math.max(prev, floor))
    } else if (evt.total > 0) {
      const global = Math.round(
        (completedSourcesRef.current * 100 + (evt.current / evt.total) * 100) / totalPlatforms
      )
      setProgressPct((prev) => Math.max(prev, global))
    }
  }, [])

  /* ---- 完成事件：统计 + 累计查询 + 共享刷新信号 ---- */
  const handleResult = useCallback((payload: ScanDonePayload) => {
    // 记录该平台完成（先于下一个源的首个进度事件，保证全局进度分子正确）
    completedSourcesRef.current += 1
    completedWeightRef.current += sourceWeightRef.current.get(payload.source) ?? 0
    // 记录该源结果（覆盖平台统计：无错误即覆盖成功；newCount 供平台筛选计数）
    doneBySourceRef.current.set(payload.source, {
      source: payload.source,
      ok: payload.report.errors.length === 0,
      newCount: payload.report.scannedNew
    })
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (startedAtRef.current !== null) {
      setTotalMs(Date.now() - startedAtRef.current)
    }
    const prev = accumRef.current
    const merged: ScanDonePayload =
      prev === null
        ? payload
        : {
            source: prev.source,
            report: {
              scannedNew: prev.report.scannedNew + payload.report.scannedNew,
              scannedUpdated: prev.report.scannedUpdated + payload.report.scannedUpdated,
              skipped: prev.report.skipped + payload.report.skipped,
              errors: [...prev.report.errors, ...payload.report.errors]
            },
            newExtIds: [...prev.newExtIds, ...payload.newExtIds],
            cards: [...prev.cards, ...payload.cards]
          }
    accumRef.current = merged
    setProgressPct(100)

    const nextSource = pendingSourcesRef.current.shift()
    if (nextSource !== undefined) {
      startingRef.current = false
      void (async () => {
        try {
          await window.api.data.startScan(nextSource)
        } catch (err) {
          useToastStore.getState().error(err instanceof Error ? err.message : String(err))
          resetToIdle()
        }
      })()
      return
    }

    // 触发读取中 UI 淡出（250ms transition，元素保持挂载），400ms 后切换完成态
    // （DonePanel 自带入场动画，完成平滑过渡而非页面塌缩+生硬弹出）
    setProgressHiding(true)
    progressHideTimerRef.current = window.setTimeout(() => {
      setDonePayload(merged)
      setPhase('done')
      startingRef.current = false
    }, 400) // 等待淡出动画完成
  }, [resetToIdle])

  /* ---- 累计会话数 + 通知会话管理页数据已变更（版本号 +1 + 重拉分组计数） ---- */
  void window.api.data
      .listConversations({ limit: 1 })
      .then((res) => {
        setCumulativeTotal(res.total)
        const store = useDataStore.getState()
        store.setConversationTotal(res.total)
        useDataStore.setState((s) => ({ version: s.version + 1 }))
        void store.refreshGroups()
      })
.catch(() => {
        // 累计统计失败不阻断完成态展示
      })

  /* ---- 失败/取消事件 ---- */
  const handleError = useCallback(
    (payload: { error: string }) => {
      const toast = useToastStore.getState()
      if (payload.error === 'cancelled') {
        toast.warning(useI18n.getState().t('readCancelled'))
      } else {
        toast.error(payload.error)
      }
      resetToIdle()
    },
    [resetToIdle]
  )

  /* ---- IPC 订阅 ---- */
  useEffect(() => {
    const offProgress = window.api.data.onScanProgress(handleProgress)
    const offResult = window.api.data.onScanResult(handleResult)
    const offError = window.api.data.onScanError(handleError)
    return () => {
      offProgress()
      offResult()
      offError()
    }
  }, [handleProgress, handleResult, handleError])

  /* ---- 组件卸载时清理秒表 ---- */
  useEffect(() => {
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current)
    }
  }, [])

  /* ---- 开始读取 ---- */
const handleStart = useCallback(async (): Promise<void> => {
    const sources = detections
      .filter((d) => d.available && selectedSources.has(d.source))
      .map((d) => d.source)
    if (phase !== 'idle' || sources.length === 0 || startingRef.current) return
    startingRef.current = true
    firstProgressRef.current = false
    pendingSourcesRef.current = sources.slice(1)
    accumRef.current = null
    // 记录本次读取起点（驱动秒表 + 骨架屏 800ms 后揭示真实日志；此前缺失导致日志区永远骨架屏）
    startedAtRef.current = Date.now()
    completedSourcesRef.current = 0
    totalSourcesRef.current = sources.length
    sourceWeightRef.current.clear()
    totalWeightRef.current = 0
    completedWeightRef.current = 0
    scannedOrderRef.current = sources
    doneBySourceRef.current.clear()

    setPhase('running')
    setDonePayload(null)
    setCumulativeTotal(null)
    setTotalMs(0)
    setProgressPct(0)
    setProcessedCount(0)
    setElapsedSec(0)
    setProgressHiding(false)
    if (progressHideTimerRef.current !== null) {
      window.clearTimeout(progressHideTimerRef.current)
      progressHideTimerRef.current = null
    }

    setLogs(
      detections
        .filter((d) => d.available)
        .map((d) => ({ source: d.source, status: 'pending' as const, count: 0, total: 0, elapsedMs: 0 }))
    )
    tickRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedSec((Date.now() - startedAtRef.current) / 1000)
      }
    }, TICK_MS)

    try {
      await window.api.data.startScan(sources[0])
    } catch (err) {
      useToastStore.getState().error(err instanceof Error ? err.message : String(err))
      resetToIdle()
    }
  }, [detections, phase, selectedSources, resetToIdle])

  /* ---- 取消读取 ---- */
  const handleCancel = useCallback(async (): Promise<void> => {
    try {
      await window.api.data.cancelScan()
    } catch {
      // 无进行中任务时取消调用无副作用
    }
  }, [])

  /* ---- 派生：探测摘要 + 骨架揭示条件 ---- */
  const summary = useMemo(() => {
    const available = detections.filter((d) => d.available)
    return {
      detections,
      sourceCount: available.length,
      totalSessions: available.reduce((sum, d) => sum + (d.sessionCount ?? 0), 0)
    }
  }, [detections])

  const sinceStartMs = startedAtRef.current !== null ? Date.now() - startedAtRef.current : 0
  const logsRevealed = sinceStartMs >= SKELETON_MIN_MS && firstProgressRef.current
  const doneSources = logs.filter((l) => l.status === 'done').length
  const totalSources = summary.sourceCount

  /** 切换手动扫描范围勾选 */
  const toggleSource = useCallback((source: AgentSource): void => {
    setSelectedSources((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }, [])

  return (
    <div className="da-scan">
      {/* 页面头部行：标题 + 右上操作按钮（完成=手动读取；取消读取在 CTA 槽位） */}
      <div className="da-scan-head">
        {/* TODO-i18n: 页面标题（v1 固定中文） */}
        <h1 className="da-scan-title">AI Agent</h1>
        {phase === 'done' && (
          <button type="button" className="da-btn da-btn--manual" onClick={resetToIdle}>
            <IconClickTap size={20} />
            {t('manualRead')}
          </button>
        )}
      </div>

      {phase === 'idle' && (
        <DetectionPanel
          summary={summary}
          loading={detectionLoading}
          selectedSources={selectedSources}
          onToggleSource={toggleSource}
          onStart={() => void handleStart()}
        />
      )}

      {phase === 'running' && (
        <>
          <DetectionPanel
            summary={summary}
            loading={detectionLoading}
            selectedSources={selectedSources}
            onToggleSource={toggleSource}
            onStart={() => void handleStart()}
            running
            onCancel={() => void handleCancel()}
            className={progressHiding ? 'da-scan-idle--hiding' : ''}
          />
          <RunningPanel
            className={progressHiding ? 'da-scan-progress--hiding' : ''}
            logs={logs}
            doneSources={doneSources}
            totalSources={totalSources}
            progressPct={progressPct}
            processedCount={processedCount}
            elapsedSec={elapsedSec}
            logsRevealed={logsRevealed}
          />
        </>
      )}

      {phase === 'done' && donePayload !== null && (
        <DonePanel
          payload={donePayload}
          scanned={scannedOrderRef.current
            .map((s) => doneBySourceRef.current.get(s))
            .filter((s): s is ScannedSourceResult => s !== undefined)}
          cumulativeTotal={cumulativeTotal}
          totalMs={totalMs}
          onViewAll={() => navigate('conversations')}
        />
      )}
    </div>
  )
}
