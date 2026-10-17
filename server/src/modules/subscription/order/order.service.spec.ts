import { describe, expect, it, jest } from '@jest/globals'

import { OrderService } from './order.service'
import { OrderEntity } from '../entities/order.entity'
import { SubPlanEntity } from '../entities/sub-plan.entity'
import { SubscriptionEntity } from '../entities/subscription.entity'
import { PayQueryThrottleService } from '../pay/pay-query-throttle.service'
import type { PaymentProvider } from '../pay/payment-provider'
import { PaymentProviderRegistry } from '../pay/payment-provider.registry'
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
    createTime: new Date('2026-10-17T10:00:00.000Z'),
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

/** 渠道适配器桩（查单 / 预下单行为由用例覆写） */
const makeProvider = (overrides: Partial<PaymentProvider> = {}): PaymentProvider =>
  ({
    createQrOrder: jest.fn(() => Promise.resolve({ qrCodeUrl: 'mock://pay/AH1' })),
    queryOrder: jest.fn(() => Promise.resolve({ paid: false, channelStatus: 'NOTPAY' })),
    closeChannelOrder: jest.fn(() => Promise.resolve()),
    ...overrides,
  })

/**
 * 装配被测服务：仓储全部桩化，renewService 为 spy（顺延引擎另有专门 spec 全覆盖）；
 * 渠道注册表与查单节流为受控桩（默认查单恒未支付、节流恒放行——真实节流逻辑另有专门 spec）
 */
const makeService = (fixtures: {
  order?: OrderEntity | null
  orders?: OrderEntity[]
  plan?: SubPlanEntity | null
  subscription?: SubscriptionEntity | null
  member?: object | null
  app?: { appKey: string } | null
  provider?: Partial<PaymentProvider>
  channelRegistered?: boolean
}) => {
  const provider = makeProvider(fixtures.provider)
  const providerRegistry = {
    hasChannel: jest.fn(() => fixtures.channelRegistered ?? true),
    getProvider: jest.fn(() => provider),
    buildNotifyUrl: jest.fn(() => undefined),
  } as unknown as PaymentProviderRegistry
  const queryThrottle = { allow: jest.fn(() => true), clear: jest.fn() }
  const insert = jest.fn((entity: OrderEntity) => void entity)
  const orderRepo = {
    findOne: jest.fn(() => Promise.resolve(fixtures.order ?? null)),
    find: jest.fn(() => Promise.resolve(fixtures.orders ?? [])),
    findAndCount: jest.fn(() => Promise.resolve([[], 0] as [OrderEntity[], number])),
    // 在线下单直接 insert（非事务路径）；参数签名供关单用例解构断言（void 消费规避 no-unused-vars）
    insert,
    update: jest.fn((where: Record<string, unknown>, changes: Record<string, unknown>) => {
      void where
      void changes
      return Promise.resolve({ affected: 1, raw: [], generatedMaps: [] })
    }),
  }
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
    findOne: jest.fn(() => Promise.resolve(fixtures.app ?? null)),
    find: jest.fn(() => Promise.resolve([])),
  }
  // 事务 manager 的仓储与外部 orderRepo 同源并补 insert 桩（备案路径在事务内 insert 订单）
  const manager = { getRepository: jest.fn(() => ({ ...orderRepo, insert })) }
  const dataSource = { transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager)) }
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
    providerRegistry,
    queryThrottle as unknown as PayQueryThrottleService,
  )
  return {
    service,
    orderRepo,
    insert,
    planRepo,
    appRepo,
    providerRegistry,
    provider,
    queryThrottle,
    renewInTx,
  }
}

/** 开放下单用会员身份（令牌绑定应用 appKey=a_key_1） */
const MEMBER = { id: 'm1', appKey: 'a_key_1' }

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

describe('在线下单（createOnlineOrder，附录 §5.1 / PY10 / PY11）', () => {
  it('渠道未注册（生产未配置）应拒绝 005200005（P10）', async () => {
    const { service } = makeService({ plan: makePlan(), app: { appKey: 'a_key_1' }, channelRegistered: false })
    await expect(
      service.createOnlineOrder(MEMBER, { planId: 'p1', channel: 'wechat' }),
    ).rejects.toMatchObject({ code: 500200005 })
  })

  it('计划不属于令牌应用应拒绝（005100003 跨域下单校验）', async () => {
    const { service } = makeService({ plan: makePlan(), app: { appKey: 'other_key' } })
    await expect(
      service.createOnlineOrder(MEMBER, { planId: 'p1', channel: 'wechat' }),
    ).rejects.toMatchObject({ code: 500100003 })
  })

  it('周期类计划不可续到永久实例（S5 主拦截）', async () => {
    const subscription = { memberId: 'm1', appId: 'a1', expireAt: new Date(PERMANENT_EXPIRE_AT) } as SubscriptionEntity
    const { service, insert } = makeService({
      plan: makePlan(),
      app: { appKey: 'a_key_1' },
      subscription,
    })
    await expect(
      service.createOnlineOrder(MEMBER, { planId: 'p1', channel: 'wechat' }),
    ).rejects.toMatchObject({ code: 500300002 })
    expect(insert).not.toHaveBeenCalled()
  })

  it('成功下单应落库 pending 再预下单，金额取计划价快照', async () => {
    const { service, insert, provider } = makeService({ plan: makePlan(), app: { appKey: 'a_key_1' } })
    const vo = await service.createOnlineOrder(MEMBER, { planId: 'p1', channel: 'alipay' })
    expect(vo.qrCodeUrl).toBe('mock://pay/AH1')
    expect(vo.amount).toBe(99000)
    expect(typeof vo.expireAt).toBe('string')
    const order = insert.mock.calls[0][0]
    expect(order.status).toBe('pending')
    expect(order.channel).toBe('alipay')
    expect(order.amount).toBe(99000)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.createQrOrder).toHaveBeenCalledTimes(1)
  })

  it('预下单失败应立即关单留痕并抛 005200005（PY10：渠道侧无孤儿单）', async () => {
    const { service, orderRepo, insert } = makeService({
      plan: makePlan(),
      app: { appKey: 'a_key_1' },
      provider: { createQrOrder: jest.fn(() => Promise.reject(new Error('渠道超时'))) },
    })
    await expect(
      service.createOnlineOrder(MEMBER, { planId: 'p1', channel: 'wechat' }),
    ).rejects.toMatchObject({ code: 500200005 })
    expect(insert).toHaveBeenCalledTimes(1)
    // 落库的 pending 单被立即置 closed（关单 update 以订单 id 定位）
    const closeCall = orderRepo.update.mock.calls.find(([, changes]) => changes.status === 'closed')
    expect(closeCall).toBeTruthy()
  })
})

describe('订单轮询（queryOnlineOrderStatus，附录 §5.2 / PY2 / PY3）', () => {
  const ownedApp = { appKey: 'a_key_1' }

  it('订单不存在应拒绝（005200001）', async () => {
    const { service } = makeService({})
    await expect(service.queryOnlineOrderStatus(MEMBER, 'AH_NOPE')).rejects.toMatchObject({ code: 500200001 })
  })

  it('跨会员订单按不存在处理（PY2 防枚举，不泄露存在性）', async () => {
    const { service } = makeService({ order: makeOrder({ memberId: 'm2' }), app: ownedApp })
    await expect(service.queryOnlineOrderStatus(MEMBER, 'AH261017100000ABC123')).rejects.toMatchObject({ code: 500200001 })
  })

  it('跨应用订单按不存在处理（订单应用 appKey 与令牌不符）', async () => {
    const { service } = makeService({ order: makeOrder(), app: { appKey: 'other_key' } })
    await expect(service.queryOnlineOrderStatus(MEMBER, 'AH261017100000ABC123')).rejects.toMatchObject({ code: 500200001 })
  })

  it('刚创建的订单轮询不触发渠道查单（10s 冷却窗）', async () => {
    const fresh = makeOrder({ createTime: new Date() })
    const { service, provider } = makeService({ order: fresh, app: ownedApp })
    const vo = await service.queryOnlineOrderStatus(MEMBER, fresh.orderNo)
    expect(vo.status).toBe('pending')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.queryOrder).not.toHaveBeenCalled()
  })

  it('pending 超过 10s 时轮询顺带查单，渠道已支付则受理转 paid（P5 第二层）', async () => {
    const mature = makeOrder({ channel: 'wechat', createTime: new Date(Date.now() - 60_000) })
    const paidOrder = makeOrder({ status: 'paid', paidAt: new Date() })
    const { service, provider, orderRepo, queryThrottle } = makeService({
      // 默认（受理后刷新查询）返回 paid 态；前两次（外层 + markPaid 内部）返回 pending 成熟单
      order: paidOrder,
      app: ownedApp,
      provider: {
        queryOrder: jest.fn(() => Promise.resolve({
          paid: true,
          transactionId: 'WX-TX-1',
          paidAmountFen: 99000,
          channelStatus: 'SUCCESS',
        })),
      },
    })
    orderRepo.findOne
      .mockReturnValueOnce(Promise.resolve(mature))
      .mockReturnValueOnce(Promise.resolve(mature))
    const vo = await service.queryOnlineOrderStatus(MEMBER, mature.orderNo)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.queryOrder).toHaveBeenCalledWith(mature.orderNo)
    expect(vo.status).toBe('paid')
    expect(queryThrottle.clear).toHaveBeenCalled()
  })

  it('节流窗口内不重复查单（PY3）', async () => {
    const mature = makeOrder({ channel: 'wechat', createTime: new Date(Date.now() - 60_000) })
    const { service, provider, queryThrottle } = makeService({ order: mature, app: ownedApp })
    ;(queryThrottle.allow as jest.Mock).mockReturnValue(false)
    await service.queryOnlineOrderStatus(MEMBER, mature.orderNo)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.queryOrder).not.toHaveBeenCalled()
  })

  it('渠道查单异常不向轮询传播（下次轮询重试）', async () => {
    const mature = makeOrder({ channel: 'wechat', createTime: new Date(Date.now() - 60_000) })
    const { service } = makeService({
      order: mature,
      app: ownedApp,
      provider: { queryOrder: jest.fn(() => Promise.reject(new Error('渠道网络错误'))) },
    })
    const vo = await service.queryOnlineOrderStatus(MEMBER, mature.orderNo)
    expect(vo.status).toBe('pending')
  })

  it('终态订单直接返回并清除节流条目', async () => {
    const paid = makeOrder({ status: 'paid', paidAt: new Date() })
    const { service, provider, queryThrottle } = makeService({ order: paid, app: ownedApp })
    const vo = await service.queryOnlineOrderStatus(MEMBER, paid.orderNo)
    expect(vo.status).toBe('paid')
    expect(typeof vo.paidAt).toBe('string')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.queryOrder).not.toHaveBeenCalled()
    expect(queryThrottle.clear).toHaveBeenCalledWith(paid.orderNo)
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

describe('关单防护（closeOrder / closeExpiredPending，附录 §6 / PY4）', () => {
  it('手动关闭非 pending 订单应拒绝（005002002）', async () => {
    const { service } = makeService({ order: makeOrder({ status: 'paid' }) })
    await expect(service.closeOrder('o1')).rejects.toMatchObject({ code: 500200002 })
  })

  it('手动关闭 pending 订单：渠道未支付才关（关单前查单防护）', async () => {
    const { service, orderRepo, provider } = makeService({
      order: makeOrder({ channel: 'wechat' }),
      provider: { queryOrder: jest.fn(() => Promise.resolve({ paid: false, channelStatus: 'NOTPAY' })) },
    })
    await service.closeOrder('o1')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.queryOrder).toHaveBeenCalledWith('AH261017100000ABC123')
    expect(orderRepo.update).toHaveBeenCalledWith({ id: 'o1' }, { status: 'closed' })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.closeChannelOrder).toHaveBeenCalledWith('AH261017100000ABC123')
  })

  it('手动关单时渠道已支付：受理转 paid 后按状态冲突提示（防「已付被关」）', async () => {
    const { service, orderRepo, renewInTx } = makeService({
      order: makeOrder({ channel: 'wechat' }),
      provider: {
        queryOrder: jest.fn(() => Promise.resolve({
          paid: true,
          transactionId: 'WX-TX-2',
          paidAmountFen: 99000,
          channelStatus: 'SUCCESS',
        })),
      },
    })
    await expect(service.closeOrder('o1')).rejects.toMatchObject({ code: 500200002 })
    expect(orderRepo.update).toHaveBeenCalledWith(
      { id: 'o1' },
      expect.objectContaining({ status: 'paid', transactionId: 'WX-TX-2' }),
    )
    expect(renewInTx).toHaveBeenCalledTimes(1)
  })

  it('手动关单时渠道查单异常应拒绝关单（资金安全优先，稍后重试）', async () => {
    const { service, orderRepo } = makeService({
      order: makeOrder({ channel: 'wechat' }),
      provider: { queryOrder: jest.fn(() => Promise.reject(new Error('渠道超时'))) },
    })
    await expect(service.closeOrder('o1')).rejects.toMatchObject({ code: 500200005 })
    expect(orderRepo.update).not.toHaveBeenCalled()
  })

  it('兜底关单：渠道未支付的过期单逐单关闭并同步关渠道单', async () => {
    const expired = makeOrder({
      channel: 'wechat',
      status: 'pending',
      expireAt: new Date('2026-10-17T09:00:00.000Z'),
    })
    const { service, orderRepo, provider } = makeService({
      orders: [expired],
      order: expired,
      provider: { queryOrder: jest.fn(() => Promise.resolve({ paid: false, channelStatus: 'NOTPAY' })) },
    })
    const closed = await service.closeExpiredPending()
    expect(closed).toBe(1)
    expect(orderRepo.update).toHaveBeenCalledWith({ id: 'o1' }, { status: 'closed' })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.closeChannelOrder).toHaveBeenCalledWith(expired.orderNo)
  })

  it('兜底关单：渠道已支付的过期单受理转 paid 而非关闭', async () => {
    const expired = makeOrder({
      channel: 'alipay',
      status: 'pending',
      expireAt: new Date('2026-10-17T09:00:00.000Z'),
    })
    const { service, orderRepo, renewInTx } = makeService({
      orders: [expired],
      order: expired,
      provider: {
        queryOrder: jest.fn(() => Promise.resolve({
          paid: true,
          transactionId: 'ALI-TX-3',
          paidAmountFen: 99000,
          channelStatus: 'TRADE_SUCCESS',
        })),
      },
    })
    const closed = await service.closeExpiredPending()
    expect(closed).toBe(0)
    expect(orderRepo.update).toHaveBeenCalledWith(
      { id: 'o1' },
      expect.objectContaining({ status: 'paid', transactionId: 'ALI-TX-3' }),
    )
    expect(renewInTx).toHaveBeenCalledTimes(1)
  })

  it('兜底关单：渠道查单异常跳过该单不关（留待下轮，宁可不关不可错关）', async () => {
    const expired = makeOrder({
      channel: 'wechat',
      status: 'pending',
      expireAt: new Date('2026-10-17T09:00:00.000Z'),
    })
    const { service, orderRepo } = makeService({
      orders: [expired],
      order: expired,
      provider: { queryOrder: jest.fn(() => Promise.reject(new Error('渠道 5xx'))) },
    })
    const closed = await service.closeExpiredPending()
    expect(closed).toBe(0)
    expect(orderRepo.update).not.toHaveBeenCalled()
  })

  it('兜底关单：在线渠道未装配（异常态）跳过留痕不关', async () => {
    const expired = makeOrder({
      channel: 'wechat',
      status: 'pending',
      expireAt: new Date('2026-10-17T09:00:00.000Z'),
    })
    const { service, orderRepo, providerRegistry } = makeService({
      orders: [expired],
      order: expired,
      channelRegistered: false,
    })
    // getProvider 未注册返回 undefined
    ;(providerRegistry.getProvider as jest.Mock).mockReturnValue(undefined)
    const closed = await service.closeExpiredPending()
    expect(closed).toBe(0)
    expect(orderRepo.update).not.toHaveBeenCalled()
  })

  it('线下单（offline）无渠道侧状态：过期 pending 兜底直接关单，不经渠道核验', async () => {
    const expired = makeOrder({
      channel: 'offline',
      status: 'pending',
      expireAt: new Date('2026-10-17T09:00:00.000Z'),
    })
    const { service, orderRepo, providerRegistry } = makeService({
      orders: [expired],
      order: expired,
      channelRegistered: false,
    })
    const closed = await service.closeExpiredPending()
    expect(closed).toBe(1)
    expect(orderRepo.update).toHaveBeenCalledWith({ id: 'o1' }, { status: 'closed' })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(providerRegistry.getProvider).not.toHaveBeenCalled()
  })
})
