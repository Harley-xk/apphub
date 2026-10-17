/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 轮询顺带查单节流（在线支付渠道接入附录 §5.2 / P5 第二层 / PY3）：
 * 内存 Map 按 orderNo 10s 一查，订单终态清除条目；sweep 兜底查询不受节流限制
 */
import { Injectable } from '@nestjs/common'

/** 同一订单两次渠道查单的最小间隔（毫秒） */
export const PAY_QUERY_THROTTLE_MS = 10_000

/** 订单创建后多少毫秒内轮询不触发渠道查单（刚下单即轮询的密集窗口无查单价值） */
export const PAY_QUERY_MIN_AGE_MS = 10_000

@Injectable()
export class PayQueryThrottleService {
  private readonly lastQueryAt = new Map<string, number>()

  /** 是否允许向渠道发起查单（10s 内同一订单只查一次；允许时记录时间戳） */
  allow(orderNo: string): boolean {
    const now = Date.now()
    const last = this.lastQueryAt.get(orderNo)
    if (last !== undefined && now - last < PAY_QUERY_THROTTLE_MS)
      return false
    this.lastQueryAt.set(orderNo, now)
    return true
  }

  /** 订单终态（paid / closed）清除条目，防内存随订单量累积 */
  clear(orderNo: string): void {
    this.lastQueryAt.delete(orderNo)
  }
}
