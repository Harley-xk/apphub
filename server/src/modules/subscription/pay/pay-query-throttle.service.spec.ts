import { describe, expect, it, jest } from '@jest/globals'

import { PAY_QUERY_THROTTLE_MS, PayQueryThrottleService } from './pay-query-throttle.service'

describe('轮询查单节流（PY3）', () => {
  it('10s 窗口内同一订单只放行一次', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const throttle = new PayQueryThrottleService()
      expect(throttle.allow('AH1')).toBe(true)
      expect(throttle.allow('AH1')).toBe(false)
      // 窗口内推进仍不放行
      now.mockReturnValue(1_700_000_000_000 + PAY_QUERY_THROTTLE_MS - 1)
      expect(throttle.allow('AH1')).toBe(false)
      // 超窗放行并刷新计时
      now.mockReturnValue(1_700_000_000_000 + PAY_QUERY_THROTTLE_MS)
      expect(throttle.allow('AH1')).toBe(true)
    }
    finally {
      now.mockRestore()
    }
  })

  it('不同订单互不影响', () => {
    const throttle = new PayQueryThrottleService()
    expect(throttle.allow('AH1')).toBe(true)
    expect(throttle.allow('AH2')).toBe(true)
  })

  it('终态清除条目后立即可再查（且防条目累积）', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const throttle = new PayQueryThrottleService()
      expect(throttle.allow('AH1')).toBe(true)
      throttle.clear('AH1')
      expect(throttle.allow('AH1')).toBe(true)
    }
    finally {
      now.mockRestore()
    }
  })
})
