/**
 * scanService —— 读取任务（ingest）的统一入口（M7 从 ipc.ts 提取）。
 *
 * 设计：
 * - 实际 ingest 永远在 worker 线程（scanner.worker，独立 rollup input）内执行，
 *   主进程只负责 spawn / 透传进度 / 收尾 terminate，绝不在主线程跑 ingest。
 * - 全局同一时刻只允许一个读取任务（手动扫描与定时自动读取共用同一把锁），
 *   避免两个 worker 同时写索引库。
 * - 手动扫描（ipc.ts）与自动读取（scheduler.ts）都经 runIngest() 进入。
 */
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { AgentSource } from '../../shared/unified-model'
import type {
  IngestReport,
  ScanProgress,
  ScannerPortMessage
} from '../../shared/data-contract'

export interface RunIngestOptions {
  source: AgentSource
  /** 索引库路径；缺省用主进程默认位置（getDefaultDbPath） */
  dbPath?: string
  /** 进度回调（手动扫描透传给 renderer；自动读取静默不传） */
  onProgress?: (progress: ScanProgress) => void
}

export type RunIngestResult =
  | { ok: true; report: IngestReport; newExtIds: string[] }
  | { ok: false; error: string }

/** 当前进行中的读取 worker（手动扫描与自动读取共用） */
let activeWorker: Worker | null = null
/** 本次取消标记：worker 因用户取消而被 terminate 时，exit 事件不视为异常 */
let cancelledFlag = false
/**
 * 取消握手：terminate() 是异步的，旧 worker 的 DB 连接要等 exit 事件才真正关闭。
 * 握手期间 isIngestRunning() 保持 true，拒绝新任务，避免新旧 worker 并发写索引库。
 */
let cancelling = false

/** 是否已有读取任务进行中 */
export function isIngestRunning(): boolean {
  return activeWorker !== null || cancelling
}

/**
 * 终止当前进行中的读取 worker；无任务时返回 false。
 * 调用方负责向 renderer 发送 scanError('cancelled')；
 * 本函数的 Promise 会以 error='cancelled' settle，调用方应静默忽略。
 */
export function cancelActiveIngest(): boolean {
  const worker = activeWorker
  if (worker === null || cancelling) return false
  cancelledFlag = true
  cancelling = true
  activeWorker = null
  void worker.terminate()
  return true
}

/**
 * 在 worker 线程执行一次 ingest。并发任务直接拒绝（ok:false，error='已有读取任务进行中'）。
 * Promise 总会 settle：成功 → ok:true（report + 新入库 extId）；失败 → ok:false。
 */
export function runIngest(options: RunIngestOptions): Promise<RunIngestResult> {
  if (activeWorker !== null || cancelling) {
    return Promise.resolve({ ok: false, error: '已有读取任务进行中' })
  }
  cancelledFlag = false
  return new Promise<RunIngestResult>((resolve) => {
    const worker = new Worker(join(__dirname, 'workers', 'scanner.worker.js'))
    activeWorker = worker
    let settled = false

    const settle = (result: RunIngestResult): void => {
      if (settled) return
      settled = true
      if (activeWorker === worker) activeWorker = null
      resolve(result)
    }

    worker.on('message', (message: ScannerPortMessage) => {
      if (message.type === 'progress') {
        options.onProgress?.(message.payload)
        return
      }
      settle(message.payload)
      void worker.terminate()
    })

    worker.on('error', (error) => {
      settle({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    })

    // 兜底：worker 未走正常消息流退出（外部 kill / 未捕获异常 / 用户取消）
    worker.on('exit', (code) => {
      if (cancelling || cancelledFlag) {
        // 取消握手完成：旧 worker 已确认退出，放行后续任务
        cancelling = false
        cancelledFlag = false
        settle({ ok: false, error: 'cancelled' })
        return
      }
      if (!settled) {
        settle({
          ok: false,
          error:
            code !== 0 ? `读取线程异常退出（code ${code}）` : '读取线程提前退出'
        })
      }
    })

    // dbPath 必须由主进程显式下发：worker 线程内 require('electron') 不可用，
    // 其 getDefaultDbPath() 会错误回退到 process.cwd()（快捷方式启动时为 System32，不可写）
    worker.postMessage({
      cmd: 'ingest',
      source: options.source,
      ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {})
    })
  })
}
