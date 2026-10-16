/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅周期到期计算（主张 S1）：日历月加法 + N×30 天保底取大，全程 UTC；
 * 边界行为（1-31 → 3-02、2-28 → 3-30 等）由同目录 spec 守护，改动前先看用例
 */
import { PERMANENT_EXPIRE_AT } from './subscription.constants'

const DAY_MS = 24 * 60 * 60 * 1000

/** 每周期保底天数（短月场景日历加法不足额时顺延，保证每个周期至少 30 天 / 月） */
const MIN_DAYS_PER_MONTH = 30

/** 日历月加法：同日同时分秒，目标月无同日时钳制到月末日 */
export function addMonthsClamped(start: Date, months: number): Date {
  const target = new Date(start.getTime())
  // 先落到 1 日再进位，避免 setUTCMonth 的溢出语义（1-31 + 1 月会滚到 3-03 而非钳制 2-28）
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + months)
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(start.getUTCDate(), daysInTargetMonth))
  return target
}

/**
 * S1 周期计算：expire = max(T + N 个日历月, T + N×30 天保底)
 * - 常规走日历月（2026-10-16 14:30 月付 → 2026-11-16 14:30）
 * - 短月不足额时保底顺延（1-31 月付 → 3-02；2-28 月付 → 3-30；闰年 2-29 → 3-30）
 */
export function calcExpireAt(start: Date, months: number): Date {
  const calendar = addMonthsClamped(start, months)
  const floor = new Date(start.getTime() + months * MIN_DAYS_PER_MONTH * DAY_MS)
  return calendar >= floor ? calendar : floor
}

/** 是否永久档（哨兵值及更晚一律视为永久，防比较方式差异） */
export function isPermanentExpire(expireAt: Date): boolean {
  return expireAt.getTime() >= PERMANENT_EXPIRE_AT.getTime()
}
