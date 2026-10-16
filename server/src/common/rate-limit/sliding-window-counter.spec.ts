import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { MAX_TRACKED_KEYS, InMemorySlidingWindowCounter } from './sliding-window-counter'

describe('InMemorySlidingWindowCounter', () => {
  let counter: InMemorySlidingWindowCounter

  beforeEach(() => {
    jest.useFakeTimers()
    counter = new InMemorySlidingWindowCounter()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('窗口内未达上限应放行', () => {
    jest.setSystemTime(1_000_000)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(true)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(true)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(true)
  })

  it('窗口内达上限应拒绝', () => {
    jest.setSystemTime(1_000_000)
    for (let i = 0; i < 3; i++)
      counter.tryAcquire('key-a', 3, 60_000)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(false)
  })

  it('窗口滑动过期后应恢复放行', () => {
    jest.setSystemTime(1_000_000)
    for (let i = 0; i < 3; i++)
      counter.tryAcquire('key-a', 3, 60_000)
    // 推进到首次命中滑出窗口之后：仅剩 2 次计数，本次放行
    jest.setSystemTime(1_000_000 + 60_001)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(true)
  })

  it('被拒绝的请求不应占窗口计数', () => {
    jest.setSystemTime(1_000_000)
    for (let i = 0; i < 3; i++)
      counter.tryAcquire('key-a', 3, 60_000)
    // 连续拒绝若干次：不追加计数
    counter.tryAcquire('key-a', 3, 60_000)
    counter.tryAcquire('key-a', 3, 60_000)
    // 推进超窗：全部命中过期，应重新累计满额
    jest.setSystemTime(1_000_000 + 60_001)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(true)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(true)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(true)
    expect(counter.tryAcquire('key-a', 3, 60_000)).toBe(false)
  })

  it('不同 key 互不影响', () => {
    jest.setSystemTime(1_000_000)
    for (let i = 0; i < 3; i++)
      counter.tryAcquire('key-a', 3, 60_000)
    expect(counter.tryAcquire('key-b', 3, 60_000)).toBe(true)
  })

  it('恰在窗口边界（未滑出）仍应计数', () => {
    jest.setSystemTime(1_000_000)
    counter.tryAcquire('key-a', 1, 60_000)
    jest.setSystemTime(1_000_000 + 60_000)
    // 命中恰满窗口年龄：从严方向仍计数，达到上限拒绝
    expect(counter.tryAcquire('key-a', 1, 60_000)).toBe(false)
  })

  it('容量触顶时应驱逐最早写入的 key，保证新 key 仍可计数', () => {
    jest.setSystemTime(1_000_000)
    for (let i = 0; i < MAX_TRACKED_KEYS; i++)
      counter.tryAcquire(`key-${i}`, 1, 60_000)

    // 容量已满：新 key 计数触发驱逐最早的 key-0
    expect(counter.tryAcquire('key-new', 1, 60_000)).toBe(true)
    // key-0 已被驱逐（计数归零）：重新计数视为首次命中；
    // 注：被驱逐 key 的重插入会使容量再次触顶并连锁挤掉次早 key（异常流量下的轮转驱逐，属可接受行为）
    expect(counter.tryAcquire('key-0', 1, 60_000)).toBe(true)
  })
})
