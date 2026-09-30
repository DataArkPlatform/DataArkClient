/**
 * 主进程极简文件日志 —— 追加写入 userData/logs/dataark-YYYYMMDD.log
 * 打包环境下 console 输出不可见，此模块保证问题可回溯。
 */
import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logDir: string | null = null

function ensureLogDir(): string | null {
  if (logDir !== null) return logDir
  try {
    logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logDir, { recursive: true })
    return logDir
  } catch {
    return null
  }
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function time(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function write(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  const dir = ensureLogDir()
  if (dir === null) return
  try {
    appendFileSync(join(dir, `dataark-${stamp()}.log`), `[${time()}] [${level}] ${message}\n`, 'utf8')
  } catch {
    /* 日志失败不影响主流程 */
  }
}

export const logger = {
  info: (message: string): void => write('INFO', message),
  warn: (message: string): void => write('WARN', message),
  error: (message: string): void => write('ERROR', message)
}
