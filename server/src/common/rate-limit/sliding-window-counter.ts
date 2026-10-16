/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 内存滑动窗口计数器：按 key 记录窗口内命中时间戳，单实例部署适用（多实例需替换为集中式存储）
 */
import { Injectable } from '@nestjs/common'

/** 滑动窗口计数器注入 token：以 useClass/useValue 覆盖即可替换实现（如 Redis） */
export const RATE_LIMIT_COUNTER = Symbol('RATE_LIMIT_COUNTER')

/** 跟踪 key 容量上限：正常流量远达不到（窗口内 1 万个 AppKey×IP 组合/实例），触顶即异常流量，触发驱逐保护（导出供单测构造触顶场景） */
export const MAX_TRACKED_KEYS = 10_000

/** 滑动窗口计数器接口 */
export interface SlidingWindowCounter {
  /**
   * 记录一次命中并判定是否放行：窗口内命中数已达上限则拒绝（不记录本次）
   * @param key 限流维度键（如 `${appKey}:${ip}`）
   * @param limit 窗口内允许的最大命中数
   * @param windowMs 窗口长度（毫秒）
   * @returns true 放行 / false 超限拒绝
   */
  tryAcquire(key: string, limit: number, windowMs: number): boolean
}

@Injectable()
export class InMemorySlidingWindowCounter implements SlidingWindowCounter {
  /** key → 窗口内命中时间戳队列（升序） */
  private readonly hits = new Map<string, number[]>()

  tryAcquire(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    const windowStart = now - windowMs
    // 惰性清理：仅过滤当前 key 的过期命中（严格小于才剔除——恰满窗口年龄的命中仍计数，从严方向）
    const queue = (this.hits.get(key) ?? []).filter(ts => ts >= windowStart)

    if (queue.length >= limit) {
      this.hits.set(key, queue)
      return false
    }

    queue.push(now)
    this.hits.set(key, queue)

    // 容量触顶：驱逐最早写入的 key（Map 迭代序即首次插入序，过期 key 的队列已收缩为空、代价最小）。
    // 被驱逐 key 的计数归零只会放宽限流（安全方向可接受），触发条件本身就是异常流量
    if (this.hits.size > MAX_TRACKED_KEYS) {
      const oldest = this.hits.keys().next().value as string | undefined
      if (oldest !== undefined)
        this.hits.delete(oldest)
    }

    return true
  }
}
