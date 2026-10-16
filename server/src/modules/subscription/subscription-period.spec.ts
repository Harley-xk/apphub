import { describe, expect, it } from '@jest/globals'

import { addMonthsClamped, calcExpireAt, isPermanentExpire } from './subscription-period'
import { PERMANENT_EXPIRE_AT } from './subscription.constants'

/** 固定时刻构造（UTC），避免用例受运行时区影响 */
const at = (iso: string) => new Date(iso)

describe('日历月加法（addMonthsClamped）', () => {
  it('常规场景应保持同日同时分秒', () => {
    expect(addMonthsClamped(at('2026-10-16T14:30:05Z'), 1).toISOString())
      .toBe('2026-11-16T14:30:05.000Z')
    expect(addMonthsClamped(at('2026-10-16T14:30:05Z'), 12).toISOString())
      .toBe('2027-10-16T14:30:05.000Z')
  })

  it('目标月无同日时应钳制到月末日', () => {
    // 1-31 月付：2 月无 31 日 → 2-28（非闰年）
    expect(addMonthsClamped(at('2026-01-31T08:00:00Z'), 1).toISOString())
      .toBe('2026-02-28T08:00:00.000Z')
    // 闰年 1-31 → 2-29
    expect(addMonthsClamped(at('2028-01-31T08:00:00Z'), 1).toISOString())
      .toBe('2028-02-29T08:00:00.000Z')
    // 3-31 季付（+3 月 → 6-30）
    expect(addMonthsClamped(at('2026-03-31T00:00:00Z'), 3).toISOString())
      .toBe('2026-06-30T00:00:00.000Z')
  })

  it('跨年加法应正确进位年份', () => {
    expect(addMonthsClamped(at('2026-11-15T23:59:59Z'), 3).toISOString())
      .toBe('2027-02-15T23:59:59.000Z')
  })
})

describe('S1 周期计算（calcExpireAt，保底取大）', () => {
  it('常规月付应走日历月（2026-10-16 14:30 → 2026-11-16 14:30，31 天 ≥ 30 天保底）', () => {
    expect(calcExpireAt(at('2026-10-16T14:30:00Z'), 1).toISOString())
      .toBe('2026-11-16T14:30:00.000Z')
  })

  it('1-31 月付应触发保底顺延到 3-02（日历钳制 2-28 仅 28 天）', () => {
    expect(calcExpireAt(at('2026-01-31T00:00:00Z'), 1).toISOString())
      .toBe('2026-03-02T00:00:00.000Z')
  })

  it('2-28 月付应顺延到 3-30（日历 3-28 仅 28 天，不触发钳制但不足保底）', () => {
    expect(calcExpireAt(at('2026-02-28T00:00:00Z'), 1).toISOString())
      .toBe('2026-03-30T00:00:00.000Z')
  })

  it('闰年 2-29 月付应顺延到 3-30', () => {
    expect(calcExpireAt(at('2028-02-29T12:00:00Z'), 1).toISOString())
      .toBe('2028-03-30T12:00:00.000Z')
  })

  it('恰好 30 天的月份（4-15 月付 → 5-15）应不触发保底（等于保底取日历）', () => {
    expect(calcExpireAt(at('2026-04-15T00:00:00Z'), 1).toISOString())
      .toBe('2026-05-15T00:00:00.000Z')
  })

  it('年付应按 12 个日历月计算（365/366 天 ≥ 360 天保底，不触发）', () => {
    expect(calcExpireAt(at('2026-05-20T09:00:00Z'), 12).toISOString())
      .toBe('2027-05-20T09:00:00.000Z')
  })

  it('季付短月链（11-30 → 次年 2-28 钳制，90 天 < 91 天保底）应取保底', () => {
    // 日历：2026-11-30 + 3 月 → 2027-02-28（2 月无 30 日钳制），共 90 天
    // 保底：2026-11-30 + 90 天 → 2027-02-28（同年 11 月余 0 天 + 12 月 31 + 1 月 31 + 2 月 28 = 90）
    // 两者同为 2027-02-28——保底与钳制重合的边界，断言稳定结果
    expect(calcExpireAt(at('2026-11-30T00:00:00Z'), 3).toISOString())
      .toBe('2027-02-28T00:00:00.000Z')
  })

  it('续费起算时刻为原到期时刻时（未过期顺延，T=expire_at）算法不变', () => {
    // 原到期 2027-03-02 00:00（保底产物），再续 1 月：日历 4-02（31 天 ≥ 30）
    expect(calcExpireAt(at('2027-03-02T00:00:00Z'), 1).toISOString())
      .toBe('2027-04-02T00:00:00.000Z')
  })
})

describe('永久档判定（isPermanentExpire）', () => {
  it('哨兵值应判定为永久', () => {
    expect(isPermanentExpire(PERMANENT_EXPIRE_AT)).toBe(true)
  })

  it('普通到期时刻应判定为非永久', () => {
    expect(isPermanentExpire(at('2027-10-16T00:00:00Z'))).toBe(false)
  })
})
