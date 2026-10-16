import { describe, expect, it, jest } from '@jest/globals'
import { FindOperator } from 'typeorm'

import { OrderService } from './order.service'
import { OrderEntity } from '../entities/order.entity'
import { SubPlanEntity } from '../entities/sub-plan.entity'
import { SubscriptionEntity } from '../entities/subscription.entity'
import type { SubscriptionRenewService } from '../sub/subscription-renew.service'
import { PERMANENT_EXPIRE_AT } from '../subscription.constants'

/** 线下备案订单桩 */
const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity =>
  ({
    id: 'o1',
    orderNo: 'AH261017100000ABC123',
    memberId: 'm1',
    appId: 'a1',
    planId: 'p1',
    planName: '专业版 · 年付',
    periodType: 'yearly',
    amount: 99000,
    channel: 'offline',
    status: 'pending',
    transactionId: null,
    paidAt: null,
    expireAt: new Date('2026-10-17T12:00:00.000Z'),
    offlineNote: null,
    ...overrides,
  }) as OrderEntity

const makePlan = (overrides: Partial<SubPlanEntity> = {}): SubPlanEntity =>
  ({
    id: 'p1',
    appId: 'a1',
    name: '专业版 · 年付',
    periodType: 'yearly',
    durationMonths: 12,
    price: 99000,
    status: 'on',
    ...overrides,
  }) as SubPlanEntity

/** 装配被测服务：仓储全部桩化，renewService 为 spy（顺延引擎另有专门 spec 全覆盖） */
const makeService = (fixtures: {
  order?: OrderEntity | null
  plan?: SubPlanEntity | null
  subscription?: SubscriptionEntity | null
  member?: object | null
}) => {
  const orderRepo = {
    findOne: jest.fn(() => Promise.resolve(fixtures.order ?? null)),
    findAndCount: jest.fn(() => Promise.resolve([[], 0] as [OrderEntity[], number])),
    // 参数签名供兜底关单用例解构断言（void 消费规避 no-unused-vars）
    update: jest.fn((where: Record<string, unknown>, changes: Record<string, unknown>) => {
      void where
      void changes
      return Promise.resolve({ affected: 1, raw: [], generatedMaps: [] })
    }),
  }
  const insert = jest.fn(() => undefined)
  const planRepo = {
    findOne: jest.fn(() => Promise.resolve(fixtures.plan ?? null)),
    find: jest.fn(() => Promise.resolve([] as SubPlanEntity[])),
  }
  const subscriptionRepo = {
    findOne: jest.fn(() => Promise.resolve(fixtures.subscription ?? null)),
    find: jest.fn(() => Promise.resolve([] as SubscriptionEntity[])),
  }
  const memberRepo = {
    findOne: jest.fn(() => Promise.resolve(fixtures.member ?? null)),
    find: jest.fn(() => Promise.resolve([])),
  }
  const appRepo = {
    findOne: jest.fn(() => Promise.resolve(null)),
    find: jest.fn(() => Promise.resolve([])),
  }
  // 事务 manager 的仓储与外部 orderRepo 同源并补 insert 桩（备案路径在事务内 insert 订单）
  const manager = { getRepository: jest.fn(() => ({ ...orderRepo, insert })) }
  const dataSource = { transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager)) }
  // 参数签名仅为 mock.calls[0][1] 断言提供类型（void 消费规避 no-unused-vars）
  const renewInTx = jest.fn((manager: unknown, order: OrderEntity, now: Date) => {
    void manager
    void order
    void now
    return Promise.resolve('applied' as const)
  })
  const renewService = { renewInTx } as unknown as SubscriptionRenewService
  const service = new OrderService(
    dataSource as never,
    orderRepo as never,
    planRepo as never,
    subscriptionRepo as never,
    memberRepo as never,
    appRepo as never,
    renewService,
  )
  return { service, orderRepo, insert, planRepo, subscriptionRepo, memberRepo, manager, renewInTx }
}

describe('线下收款备案（createOfflineOrder）', () => {
  it('计划不存在应拒绝（005001001）', async () => {
    const { service } = makeService({ plan: null, member: { id: 'm1' } })
    await expect(
      service.createOfflineOrder({ memberId: 'm1', planId: 'p1', amount: 99000 }),
    ).rejects.toMatchObject({ code: 500100001 })
  })

  it('计划已下架应拒绝（005001002）——存量订阅不受影响，但不可新购', async () => {
    const { service } = makeService({ plan: makePlan({ status: 'off' }), member: { id: 'm1' } })
    await expect(
      service.createOfflineOrder({ memberId: 'm1', planId: 'p1', amount: 99000 }),
    ).rejects.toMatchObject({ code: 500100002 })
  })

  it('会员不存在应拒绝（member 域错误码）', async () => {
    const { service } = makeService({ plan: makePlan(), member: null })
    await expect(
      service.createOfflineOrder({ memberId: 'm1', planId: 'p1', amount: 99000 }),
    ).rejects.toMatchObject({ code: 400100001 })
  })

  it('周期类计划不可续到永久实例（S5 主拦截 005003002）', async () => {
    const subscription = { memberId: 'm1', appId: 'a1', expireAt: new Date(PERMANENT_EXPIRE_AT) } as SubscriptionEntity
    const { service, orderRepo } = makeService({ plan: makePlan(), member: { id: 'm1' }, subscription })
    await expect(
      service.createOfflineOrder({ memberId: 'm1', planId: 'p1', amount: 99000 }),
    ).rejects.toMatchObject({ code: 500300002 })
    expect(orderRepo.update).not.toHaveBeenCalled()
  })

  it('永久计划续到永久实例应放行（幂等覆盖语义）', async () => {
    const subscription = { memberId: 'm1', appId: 'a1', expireAt: new Date(PERMANENT_EXPIRE_AT) } as SubscriptionEntity
    const { service, renewInTx } = makeService({
      plan: makePlan({ periodType: 'permanent', durationMonths: null }),
      member: { id: 'm1' },
      subscription,
    })
    await service.createOfflineOrder({ memberId: 'm1', planId: 'p1', amount: 199000 })
    expect(renewInTx).toHaveBeenCalledTimes(1)
  })

  it('成功备案应直接 paid 并事务内顺延（金额快照以录入为准）', async () => {
    const { service, insert, renewInTx } = makeService({ plan: makePlan(), member: { id: 'm1', nickname: '小明' } })
    const vo = await service.createOfflineOrder({
      memberId: 'm1',
      planId: 'p1',
      amount: 88000,
      transactionId: 'FLOW-001',
      offlineNote: '银行转账',
    })
    expect(vo.status).toBe('paid')
    expect(vo.paidAt).toBeInstanceOf(Date)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(renewInTx).toHaveBeenCalledTimes(1)
    const order = renewInTx.mock.calls[0][1]
    // 订单号格式：AH + 12 位时间 + 6 位随机（去易混字符）
    expect(order.orderNo).toMatch(/^AH\d{12}[A-HJ-NP-Z2-9]{6}$/)
    expect(order.planName).toBe('专业版 · 年付')
    expect(order.amount).toBe(88000)
    expect(order.channel).toBe('offline')
  })
})

describe('markPaid 状态机（回调 / 兜底查单共用幂等入口）', () => {
  it('订单不存在应拒绝（005200001）', async () => {
    const { service } = makeService({})
    await expect(service.markPaid('AH_NOPE', 'TX1', null)).rejects.toMatchObject({ code: 500200001 })
  })

  it('金额与订单不符应拒绝且不动状态（005002004）', async () => {
    const { service, orderRepo } = makeService({ order: makeOrder({ amount: 99000 }) })
    await expect(service.markPaid('AH261017100000ABC123', 'TX1', 98000)).rejects.toMatchObject({ code: 500200004 })
    expect(orderRepo.update).not.toHaveBeenCalled()
  })

  it('已 paid 订单重复回调应幂等返回 duplicate（不重复顺延）', async () => {
    const { service, renewInTx } = makeService({ order: makeOrder({ status: 'paid' }) })
    await expect(service.markPaid('AH261017100000ABC123', 'TX1', 99000)).resolves.toBe('duplicate')
    expect(renewInTx).not.toHaveBeenCalled()
  })

  it('超时关单后回调到达应留痕受理 closed_stale（不重开不抛错）', async () => {
    const { service, orderRepo } = makeService({ order: makeOrder({ status: 'closed' }) })
    await expect(service.markPaid('AH261017100000ABC123', 'TX1', 99000)).resolves.toBe('closed_stale')
    expect(orderRepo.update).not.toHaveBeenCalled()
  })

  it('pending 订单支付成功应事务内 paid + 顺延（applied）', async () => {
    const { service, orderRepo, renewInTx } = makeService({ order: makeOrder() })
    await expect(service.markPaid('AH261017100000ABC123', 'TX9', 99000)).resolves.toBe('applied')
    expect(orderRepo.update).toHaveBeenCalledWith(
      { id: 'o1' },
      expect.objectContaining({ status: 'paid', transactionId: 'TX9' }),
    )
    expect(renewInTx).toHaveBeenCalledTimes(1)
  })

  it('超时未关的 pending 单收到回调应照常受理（回调即支付证据，惰性关单只在查询路径）', async () => {
    const overdue = makeOrder({ expireAt: new Date('2026-10-17T09:00:00.000Z') })
    const { service } = makeService({ order: overdue })
    await expect(service.markPaid('AH261017100000ABC123', 'TX1', 99000)).resolves.toBe('applied')
  })
})

describe('关单（closeOrder / closeExpiredPending）', () => {
  it('手动关闭非 pending 订单应拒绝（005002002）', async () => {
    const { service } = makeService({ order: makeOrder({ status: 'paid' }) })
    await expect(service.closeOrder('o1')).rejects.toMatchObject({ code: 500200002 })
  })

  it('手动关闭 pending 订单应置 closed', async () => {
    const { service, orderRepo } = makeService({ order: makeOrder() })
    await service.closeOrder('o1')
    expect(orderRepo.update).toHaveBeenCalledWith({ id: 'o1' }, { status: 'closed' })
  })

  it('兜底关单应按 status=pending 且 expire_at 已过期批量关闭', async () => {
    const { service, orderRepo } = makeService({})
    await service.closeExpiredPending()
    const [where, changes] = orderRepo.update.mock.calls[0]
    expect(where.status).toBe('pending')
    expect(where.expireAt).toBeInstanceOf(FindOperator) // LessThan 操作符
    expect((where.expireAt as FindOperator<Date>).value).toBeInstanceOf(Date)
    expect(changes).toEqual({ status: 'closed' })
  })
})
