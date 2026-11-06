/*
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台统计区间换算纯函数：按 Asia/Shanghai 自然日计算起点与 sparkline 日期轴（设计 §6）
 */

/** 区间枚举：近 7 天 / 近 30 天（含今天，共 N 个自然日） */
export type DashboardRange = '7d' | '30d'

/** 区间 → 自然日数 */
export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = {
  '7d': 7,
  '30d': 30,
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Asia/Shanghai 固定 UTC+8（无夏令时），按毫秒偏移换算自然日 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 区间换算结果：起点含当天本地 00:00，days 为自然日数 */
export interface DashboardRangeWindow {
  /** 自然日数（7 / 30） */
  days: number
  /** 区间起点（UTC 瞬时值，对应 Asia/Shanghai 本地 00:00，含） */
  start: Date
}

/**
 * 将「当前时刻 + 区间」换算为上海时区自然日窗口。
 *
 * 近 N 天包含今天，起点为 N-1 天前的本地 00:00：
 * `(date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - (N-1) * interval '1 day') AT TIME ZONE 'Asia/Shanghai'`
 */
export function resolveDashboardRange(range: DashboardRange, now: Date = new Date()): DashboardRangeWindow {
  const days = DASHBOARD_RANGE_DAYS[range]
  const localNowMs = now.getTime() + SHANGHAI_OFFSET_MS
  const todayStartMs = Math.floor(localNowMs / DAY_MS) * DAY_MS
  const startMs = todayStartMs - (days - 1) * DAY_MS - SHANGHAI_OFFSET_MS
  return { days, start: new Date(startMs) }
}

/**
 * 生成 sparkline 日期轴（`YYYY-MM-DD`，Asia/Shanghai 自然日，含今天、升序、恰好 N 个点）。
 * 与 resolveDashboardRange 共用同一套自然日换算，确保「区间起点」与「补齐日期」不漂移。
 */
export function buildDayKeys(days: number, now: Date = new Date()): string[] {
  const localNowMs = now.getTime() + SHANGHAI_OFFSET_MS
  const todayStartMs = Math.floor(localNowMs / DAY_MS) * DAY_MS
  return Array.from({ length: days }, (_, index) => {
    const dayMs = todayStartMs - (days - 1 - index) * DAY_MS
    return new Date(dayMs).toISOString().slice(0, 10)
  })
}
