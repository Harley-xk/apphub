import { describe, expect, it } from '@jest/globals'

import { buildDayKeys, resolveDashboardRange } from './dashboard.range'

describe('resolveDashboardRange', () => {
  it('近 7 天应包含今天，起点为 6 天前的上海本地 00:00', () => {
    const now = new Date('2026-11-06T00:00:00+08:00')
    const { days, start } = resolveDashboardRange('7d', now)
    expect(days).toBe(7)
    // 上海 2026-10-31 00:00 = UTC 2026-10-30T16:00:00Z
    expect(start.toISOString()).toBe('2026-10-30T16:00:00.000Z')
  })

  it('近 30 天应跨月换算正确', () => {
    const now = new Date('2026-11-06T12:00:00+08:00')
    const { days, start } = resolveDashboardRange('30d', now)
    expect(days).toBe(30)
    // 上海 2026-10-08 00:00 = UTC 2026-10-07T16:00:00Z
    expect(start.toISOString()).toBe('2026-10-07T16:00:00.000Z')
  })

  it('近 7 天应跨年换算正确', () => {
    const now = new Date('2027-01-01T08:00:00+08:00')
    const { start } = resolveDashboardRange('7d', now)
    // 上海 2026-12-26 00:00 = UTC 2026-12-25T16:00:00Z
    expect(start.toISOString()).toBe('2026-12-25T16:00:00.000Z')
  })

  it('本地 00:00 边界应恰好切到当天（前一毫秒仍算前一天）', () => {
    const beforeMidnight = new Date('2026-11-05T23:59:59.999+08:00')
    const atMidnight = new Date('2026-11-06T00:00:00.000+08:00')
    // 前一天 23:59:59.999：窗口为 10-30 ~ 11-05
    expect(resolveDashboardRange('7d', beforeMidnight).start.toISOString()).toBe('2026-10-29T16:00:00.000Z')
    // 恰好 00:00：窗口切换为 10-31 ~ 11-06
    expect(resolveDashboardRange('7d', atMidnight).start.toISOString()).toBe('2026-10-30T16:00:00.000Z')
  })
})

describe('buildDayKeys', () => {
  it('应返回含今天、升序、恰好 N 个自然日', () => {
    const now = new Date('2026-11-06T12:00:00+08:00')
    expect(buildDayKeys(7, now)).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ])
    expect(buildDayKeys(30, now)).toHaveLength(30)
  })

  it('日期轴应与区间起点同源（首日等于起点当日）', () => {
    const now = new Date('2027-01-01T08:00:00+08:00')
    const { start } = resolveDashboardRange('7d', now)
    expect(buildDayKeys(7, now)[0]).toBe('2026-12-26')
    expect(start.toISOString()).toBe('2026-12-25T16:00:00.000Z')
  })
})
