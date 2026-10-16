import { describe, expect, it, jest } from '@jest/globals'

import { SubscriptionRenewService } from './subscription-renew.service'
import type { OrderEntity } from '../entities/order.entity'
import { SubscriptionEntity } from '../entities/subscription.entity'
import { calcExpireAt } from '../subscription-period'
import { PERMANENT_EXPIRE_AT } from '../subscription.constants'

const NOW = new Date('2026-10-17T10:00:00.000Z')

/** 构造订单（快照驱动：续费只依赖 periodType / planId / memberId / appId / orderNo） */
const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity =>
  ({ orderNo: 'AH261017100000ABC123', memberId: 'm1', appId: 'a1', planId: 'p1', periodType: 'monthly', ...overrides }) as OrderEntity

/** 构造既有实例 */
const makeExisting = (expireAt: Date): SubscriptionEntity => {
  const entity = new SubscriptionEntity()
  entity.memberId = 'm1'
  entity.appId = 'a1'
  entity.planId = 'p0'
  entity.startAt = new Date('2026-01-01T00:00:00.000Z')
  entity.expireAt = expireAt
  entity.lastRenewAt = null
  return entity
}

/** 事务 manager 桩：只 mock 边界（仓储定位）；参数签名供 mock.calls 断言取值（void 消费规避 no-unused-vars） */
const makeManager = (existing: SubscriptionEntity | null) => {
  const insert = jest.fn((entity: SubscriptionEntity) => {
    void entity
  })
  const save = jest.fn((entity: SubscriptionEntity) => {
    void entity
  })
  const findOne = jest.fn((options: unknown) => {
    void options
    return Promise.resolve(existing)
  })
  const manager = {
    getRepository: jest.fn(() => ({ findOne, insert, save })),
  }
  return { manager, insert, save, findOne }
}

describe('订阅顺延引擎（D20 单实例顺延四分支）', () => {
  const service = new SubscriptionRenewService()

  it('无实例时应创建：start_at = now，expire_at 按 S1 从 now 起算', async () => {
    const { manager, insert } = makeManager(null)
    const outcome = await service.renewInTx(manager as never, makeOrder(), NOW)
    expect(outcome).toBe('created')
    expect(insert).toHaveBeenCalledTimes(1)
    const entity = insert.mock.calls[0][0]
    expect(entity.startAt).toBe(NOW)
    expect(entity.expireAt.getTime()).toBe(calcExpireAt(NOW, 1).getTime())
    expect(entity.planId).toBe('p1')
    expect(entity.lastRenewAt).toBe(NOW)
  })

  it('实例未过期时应在原到期时刻上顺延（T = 原 expire_at，顺延不满不亏）', async () => {
    const originalExpire = new Date('2026-11-16T14:30:00.000Z')
    const { manager, save } = makeManager(makeExisting(originalExpire))
    const outcome = await service.renewInTx(manager as never, makeOrder(), NOW)
    expect(outcome).toBe('extended')
    expect(save).toHaveBeenCalledTimes(1)
    const entity = save.mock.calls[0][0]
    expect(entity.expireAt.getTime()).toBe(calcExpireAt(originalExpire, 1).getTime())
    expect(entity.planId).toBe('p1')
  })

  it('实例已过期时应复活（T = now 从当下起算）', async () => {
    const expiredAt = new Date('2026-10-01T00:00:00.000Z')
    const { manager, save } = makeManager(makeExisting(expiredAt))
    const outcome = await service.renewInTx(manager as never, makeOrder(), NOW)
    expect(outcome).toBe('revived')
    const entity = save.mock.calls[0][0]
    expect(entity.expireAt.getTime()).toBe(calcExpireAt(NOW, 1).getTime())
  })

  it('购买永久档应写哨兵值覆盖（无实例与有实例均如此）', async () => {
    const created = makeManager(null)
    expect(await service.renewInTx(created.manager as never, makeOrder({ periodType: 'permanent' }), NOW)).toBe('created')
    expect((created.insert.mock.calls[0][0]).expireAt).toBe(PERMANENT_EXPIRE_AT)

    const kept = makeManager(makeExisting(new Date('2026-11-16T14:30:00.000Z')))
    expect(await service.renewInTx(kept.manager as never, makeOrder({ periodType: 'permanent' }), NOW)).toBe('permanent_kept')
    expect((kept.save.mock.calls[0][0]).expireAt).toBe(PERMANENT_EXPIRE_AT)
  })

  it('周期类订单遇永久实例应 conflict（S5 兜底：订阅保持永久，不改数据）', async () => {
    const { manager, insert, save } = makeManager(makeExisting(new Date(PERMANENT_EXPIRE_AT)))
    const outcome = await service.renewInTx(manager as never, makeOrder(), NOW)
    expect(outcome).toBe('conflict')
    expect(insert).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('订单周期快照异常（非四档）应防御性拒绝（005003003）', async () => {
    const { manager } = makeManager(null)
    await expect(
      service.renewInTx(manager as never, makeOrder({ periodType: 'weekly' }), NOW),
    ).rejects.toMatchObject({ code: 500300003 })
  })
})
