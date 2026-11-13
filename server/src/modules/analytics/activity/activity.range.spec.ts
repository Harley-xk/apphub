import { describe, expect, it } from '@jest/globals'

import {
  buildDateKeys,
  countDateKeys,
  isValidDateKey,
  shanghaiDayEndExclusive,
  shanghaiDayStart,
  subtractMonths,
  toShanghaiDateKey,
} from './activity.range'

describe('activity.range', () => {
  it('应按 Asia/Shanghai 自然日归属瞬时时间（UTC 前一日 16:00 起算次日）', () => {
    expect(toShanghaiDateKey(new Date('2026-11-12T15:59:59Z'))).toBe('2026-11-12')
    expect(toShanghaiDateKey(new Date('2026-11-12T16:00:00Z'))).toBe('2026-11-13')
    expect(toShanghaiDateKey(new Date('2026-11-13T00:30:00Z'))).toBe('2026-11-13')
  })

  it('区间自然日数应含首尾，并拒绝倒序 / 非法日历日', () => {
    expect(countDateKeys('2026-11-01', '2026-11-07')).toBe(7)
    expect(countDateKeys('2026-11-07', '2026-11-07')).toBe(1)
    expect(countDateKeys('2026-11-08', '2026-11-07')).toBe(0)
    expect(countDateKeys('2026-02-30', '2026-03-01')).toBe(0)
    expect(isValidDateKey('2026-02-28')).toBe(true)
    expect(isValidDateKey('2026-02-30')).toBe(false)
  })

  it('应展开为升序定长日期轴并跨月 / 跨年', () => {
    expect(buildDateKeys('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ])
  })

  it('上海自然日边界应为 UTC 前一日 16:00 与次日 16:00', () => {
    expect(shanghaiDayStart('2026-11-13').toISOString()).toBe('2026-11-12T16:00:00.000Z')
    expect(shanghaiDayEndExclusive('2026-11-13').toISOString()).toBe('2026-11-13T16:00:00.000Z')
  })

  it('保留期截断应按日历月并对月末钳制', () => {
    expect(subtractMonths('2026-11-13', 24)).toBe('2024-11-13')
    expect(subtractMonths('2026-03-31', 1)).toBe('2026-02-28')
    expect(subtractMonths('2026-01-15', 1)).toBe('2025-12-15')
  })
})
