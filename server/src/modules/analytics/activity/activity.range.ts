/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 活跃度统计的日期换算纯函数：Asia/Shanghai 自然日、查询区间展开与保留期截断（设计 §2 / §3.3）
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Asia/Shanghai 固定 UTC+8（无夏令时），与服务端其余统计口径一致 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 日期串（YYYY-MM-DD）→ UTC 零点毫秒（日期串本身无时区，按 UTC 做纯日历运算） */
function dateKeyToUtcMs(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`)
}

/** 毫秒 → 日期串（UTC 日历日） */
function utcMsToDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** 瞬时时间 → Asia/Shanghai 自然日（`occurred_at` 的归属日） */
export function toShanghaiDateKey(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

/** 日期串是否为真实存在的日历日（正则通过但 2026-02-30 之类应拒绝） */
export function isValidDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey))
    return false
  return utcMsToDateKey(dateKeyToUtcMs(dateKey)) === dateKey
}

/** 区间自然日数（含首尾）；非法日期或倒序返回 0 */
export function countDateKeys(startDate: string, endDate: string): number {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate))
    return 0
  const diff = Math.round((dateKeyToUtcMs(endDate) - dateKeyToUtcMs(startDate)) / DAY_MS) + 1
  return diff > 0 ? diff : 0
}

/** 展开区间为升序日期轴（含首尾，调用方已确保区间合法） */
export function buildDateKeys(startDate: string, endDate: string): string[] {
  const count = countDateKeys(startDate, endDate)
  const startMs = dateKeyToUtcMs(startDate)
  return Array.from({ length: count }, (_, index) => utcMsToDateKey(startMs + index * DAY_MS))
}

/** 日期串 → Asia/Shanghai 当日 00:00 的 UTC 瞬时（timestamptz 条件边界） */
export function shanghaiDayStart(dateKey: string): Date {
  return new Date(Date.parse(`${dateKey}T00:00:00+08:00`))
}

/** 日期串 → 次日 Asia/Shanghai 00:00 的 UTC 瞬时（半开区间右边界） */
export function shanghaiDayEndExclusive(dateKey: string): Date {
  return new Date(Date.parse(`${dateKey}T00:00:00+08:00`) + DAY_MS)
}

/** 日期串减 N 个日历月（月末钳制：2026-03-31 减 1 月 → 2026-02-28），用于保留期截断 */
export function subtractMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const targetMonthIndex = month - 1 - months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  // 目标月最后一天：下月 0 号
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const clampedDay = Math.min(day, lastDay)
  const date = new Date(Date.UTC(targetYear, targetMonth, clampedDay))
  return date.toISOString().slice(0, 10)
}
