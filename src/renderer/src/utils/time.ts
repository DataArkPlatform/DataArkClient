/**
 * 相对时间格式化 —— 「刚刚 / N分钟前 / N小时前 / 昨天 / N天前 / YYYY-MM-DD」
 */

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** 两位补零 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 固定日期 YYYY-MM-DD（本地时区） */
export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 相对时间（相对 now，默认当前时刻） */
export function formatRelativeTime(ts: number | null | undefined, now: number = Date.now()): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return '—'
  const diff = now - ts
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`
  if (diff < 2 * DAY) return '昨天'
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}天前`
  return formatDate(ts)
}
