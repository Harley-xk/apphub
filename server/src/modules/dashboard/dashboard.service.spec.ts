import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { FindOperator } from 'typeorm'

import { DashboardService } from './dashboard.service'
import { businessError } from '../../common/exceptions/business-error'
import type { AppVersionEntity } from '../appcenter/entities/app-version.entity'
import type { AppEntity } from '../appcenter/entities/app.entity'
import type { MemberEntity } from '../member/entities/member.entity'
import type { OrderEntity } from '../subscription/entities/order.entity'
import type { AppScope } from '../system/app-scope/app-scope.service'

const NOW = new Date('2026-11-06T04:00:00+08:00')

const ALL_CODES = [
  'appcenter:app:query',
  'appcenter:version:query',
  'member:member:query',
  'subscription:order:query',
  'subscription:sub:query',
]

interface DailyRow { day: string, value: string }

/** 可链式调用的 QueryBuilder 桩：记录调用并返回预设聚合结果 */
function createBuilder(rawOne: () => unknown, rawMany: () => unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'addSelect', 'where', 'andWhere', 'groupBy', 'orderBy'])
    builder[method] = jest.fn(() => builder)
  builder.getRawOne = jest.fn(() => Promise.resolve(rawOne()))
  builder.getRawMany = jest.fn(() => Promise.resolve(rawMany()))
  return builder
}

/** 服务装配桩：所有仓储按「读取 state」实现，用例通过改 state 控制返回值 */
function createHarness() {
  const state = {
    appTotal: 0,
    appEnabled: 0,
    versionTotal: 0,
    versionPublished: 0,
    memberTotal: 0,
    memberNew: 0,
    locked: 0,
    subscriptionCount: 0,
    pendingOrders: 0,
    revenueSum: '0',
    memberDaily: [] as DailyRow[],
    revenueDaily: [] as DailyRow[],
    latestOrders: [] as Partial<OrderEntity>[],
    latestMembers: [] as Partial<MemberEntity>[],
    latestVersions: [] as Partial<AppVersionEntity>[],
    latestApps: [] as Partial<AppEntity>[],
  }

  const appRepository = {
    count: jest.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(options?.where?.status === 'enabled' ? state.appEnabled : state.appTotal)),
    find: jest.fn(() => Promise.resolve(state.latestApps as AppEntity[])),
  }
  const versionRepository = {
    count: jest.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(options?.where?.status === 'published' ? state.versionPublished : state.versionTotal)),
    find: jest.fn(() => Promise.resolve(state.latestVersions as AppVersionEntity[])),
  }
  const memberRepository = {
    count: jest.fn((options?: { where?: Record<string, unknown> }) => {
      const createTime = options?.where?.createTime as { type?: string } | undefined
      if (createTime?.type === 'moreThanOrEqual')
        return Promise.resolve(state.memberNew)
      return Promise.resolve(options?.where ? 0 : state.memberTotal)
    }),
    find: jest.fn(() => Promise.resolve(state.latestMembers as MemberEntity[])),
    createQueryBuilder: jest.fn(() => createBuilder(() => null, () => state.memberDaily)),
  }
  const memberLoginLockRepository = {
    count: jest.fn(() => Promise.resolve(state.locked)),
  }
  const orderRepository = {
    count: jest.fn(() => Promise.resolve(state.pendingOrders)),
    find: jest.fn(() => Promise.resolve(state.latestOrders as OrderEntity[])),
    createQueryBuilder: jest.fn(() =>
      createBuilder(() => ({ value: state.revenueSum }), () => state.revenueDaily)),
  }
  const subscriptionRepository = {
    // 记录 where 供「到期条件排除永久哨兵」用例断言
    count: jest.fn((options?: { where?: Record<string, unknown> }) => {
      void options
      return Promise.resolve(state.subscriptionCount)
    }),
  }
  const permissionService = {
    getUserPermissionCodes: jest.fn(() => Promise.resolve<string[]>([])),
  }
  const appScopeService = {
    resolve: jest.fn(() => Promise.resolve<AppScope>({ mode: 'all' })),
  }

  const service = new DashboardService(
    appRepository as never,
    versionRepository as never,
    memberRepository as never,
    memberLoginLockRepository as never,
    orderRepository as never,
    subscriptionRepository as never,
    permissionService as never,
    appScopeService as never,
  )

  return {
    service,
    state,
    appRepository,
    versionRepository,
    memberRepository,
    memberLoginLockRepository,
    orderRepository,
    subscriptionRepository,
    permissionService,
    appScopeService,
  }
}

describe('DashboardService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('无任何业务权限时所有块应为 null，且不发起业务查询', async () => {
    const { service, appRepository, appScopeService, permissionService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce([])

    const result = await service.getOverview('7d', 'u-1')

    expect(result.generatedAt).toBe(NOW.getTime())
    expect(result.range).toBe('7d')
    expect(result.todos).toEqual({ expiringSubscriptions: null, pendingOrders: null, lockedMembers: null })
    expect(result.metrics).toEqual({
      appTotal: null,
      appEnabled: null,
      versionTotal: null,
      versionPublished: null,
      memberTotal: null,
      memberNewInRange: null,
      subscriptionActive: null,
      subscriptionExpiringSoon: null,
      revenueInRange: null,
    })
    expect(result.sparkline).toEqual({ memberDaily: null, revenueDaily: null })
    expect(result.latest).toEqual({ orders: null, members: null, versions: null })
    expect(appScopeService.resolve).not.toHaveBeenCalled()
    expect(appRepository.count).not.toHaveBeenCalled()
  })

  it('scoped 空集应 fail-closed：计数为 0、列表为空数组，且不查库', async () => {
    const { service, state, appRepository, versionRepository, orderRepository, subscriptionRepository, appScopeService, permissionService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce(ALL_CODES)
    appScopeService.resolve.mockResolvedValue({ mode: 'scoped', appIds: [] })
    state.memberTotal = 0

    const result = await service.getOverview('7d', 'u-1')

    expect(result.metrics.appTotal).toBe(0)
    expect(result.metrics.versionTotal).toBe(0)
    expect(result.metrics.subscriptionActive).toBe(0)
    expect(result.metrics.revenueInRange).toBe(0)
    expect(result.todos.expiringSubscriptions).toBe(0)
    expect(result.todos.pendingOrders).toBe(0)
    expect(result.latest.orders).toEqual([])
    expect(result.latest.versions).toEqual([])
    expect(result.sparkline.revenueDaily).toHaveLength(7)
    expect(result.sparkline.revenueDaily?.every(point => point.amount === 0)).toBe(true)
    // 范围空集不触库
    expect(appRepository.count).not.toHaveBeenCalled()
    expect(versionRepository.count).not.toHaveBeenCalled()
    expect(orderRepository.count).not.toHaveBeenCalled()
    expect(subscriptionRepository.count).not.toHaveBeenCalled()
  })

  it('mode=all 时应用 / 版本查询不应追加 appId 条件', async () => {
    const { service, state, appRepository, versionRepository, appScopeService, permissionService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce([
      'appcenter:app:query',
      'appcenter:version:query',
    ])
    appScopeService.resolve.mockResolvedValue({ mode: 'all' })
    state.appTotal = 5
    state.appEnabled = 3
    state.versionTotal = 8
    state.versionPublished = 6

    const result = await service.getOverview('7d', 'u-1')

    expect(result.metrics.appTotal).toBe(5)
    expect(result.metrics.appEnabled).toBe(3)
    expect(result.metrics.versionTotal).toBe(8)
    expect(result.metrics.versionPublished).toBe(6)
    expect(appRepository.count.mock.calls[0][0]).toEqual({ where: {} })
    expect(appRepository.count.mock.calls[1][0]).toEqual({ where: { status: 'enabled' } })
    expect(versionRepository.count.mock.calls[0][0]).toEqual({ where: {} })
    expect(versionRepository.count.mock.calls[1][0]).toEqual({ where: { status: 'published' } })
  })

  it('resolveScopeSafe 应捕获 403 业务异常并按空集处理', async () => {
    const { service, appRepository, appScopeService, permissionService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce(['appcenter:app:query'])
    appScopeService.resolve.mockRejectedValueOnce(businessError('应用范围不足', { status: 403 }))

    const result = await service.getOverview('7d', 'u-1')

    expect(result.metrics.appTotal).toBe(0)
    expect(result.metrics.appEnabled).toBe(0)
    expect(appRepository.count).not.toHaveBeenCalled()
  })

  it('非 403 异常应照常抛出（不吞成空数据）', async () => {
    const { service, appScopeService, permissionService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce(['appcenter:app:query'])
    appScopeService.resolve.mockRejectedValueOnce(new Error('数据库不可用'))

    await expect(service.getOverview('7d', 'u-1')).rejects.toThrow('数据库不可用')
  })

  it('区间收入应按分求和，sparkline 应补齐缺失日期为定长 N 点', async () => {
    const { service, state, permissionService, appScopeService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce(['member:member:query', 'subscription:order:query'])
    appScopeService.resolve.mockResolvedValue({ mode: 'all' })
    state.revenueSum = '1234'
    state.revenueDaily = [{ day: '2026-11-03', value: '500' }]
    state.memberDaily = [{ day: '2026-11-06', value: '3' }]

    const result = await service.getOverview('7d', 'u-1')

    expect(result.metrics.revenueInRange).toBe(1234)
    const revenueDaily = result.sparkline.revenueDaily!
    expect(revenueDaily).toHaveLength(7)
    expect(revenueDaily[0]).toEqual({ date: '2026-10-31', amount: 0 })
    expect(revenueDaily.find(point => point.date === '2026-11-03')?.amount).toBe(500)
    expect(revenueDaily.find(point => point.date === '2026-11-06')?.amount).toBe(0)

    const memberDaily = result.sparkline.memberDaily!
    expect(memberDaily).toHaveLength(7)
    expect(memberDaily.find(point => point.date === '2026-11-06')?.count).toBe(3)
    expect(memberDaily.filter(point => point.count === 0)).toHaveLength(6)
  })

  it('到期与新增条件应显式排除永久哨兵、按区间起点过滤', async () => {
    const { service, subscriptionRepository, memberRepository, permissionService, appScopeService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce(['member:member:query', 'subscription:sub:query'])
    appScopeService.resolve.mockResolvedValue({ mode: 'all' })

    await service.getOverview('7d', 'u-1')

    const expiringCall = subscriptionRepository.count.mock.calls[1][0] as {
      where: { expireAt: FindOperator<Date> }
    }
    const expireOperator = expiringCall.where.expireAt
    expect(expireOperator.type).toBe('and')
    expect((expireOperator.value as unknown as FindOperator<Date>[]).map(child => child.type))
      .toEqual(['moreThan', 'lessThanOrEqual', 'lessThan'])

    const memberNewCall = memberRepository.count.mock.calls[1][0] as {
      where: { createTime: FindOperator<Date> }
    }
    expect(memberNewCall.where.createTime.type).toBe('moreThanOrEqual')
  })

  it('最新订单应批量映射昵称与应用名，已删除应用以 - 占位', async () => {
    const { service, state, permissionService, appScopeService } = createHarness()
    permissionService.getUserPermissionCodes.mockResolvedValueOnce(['subscription:order:query'])
    appScopeService.resolve.mockResolvedValue({ mode: 'all' })
    state.latestOrders = [{
      id: 'o-1',
      orderNo: 'AH202611060001',
      memberId: 'm-1',
      appId: 'a-1',
      amount: 1500,
      channel: 'offline',
      status: 'paid',
      createTime: new Date('2026-11-06T02:00:00+08:00'),
    }]
    state.latestMembers = [{ id: 'm-1', nickname: '小明' }]
    state.latestApps = [{ id: 'a-1', name: '已删除应用', deletedAt: new Date('2026-11-01T00:00:00+08:00') }]

    const result = await service.getOverview('7d', 'u-1')

    expect(result.latest.orders).toEqual([{
      id: 'o-1',
      orderNo: 'AH202611060001',
      memberNickname: '小明',
      appName: '-',
      amount: 1500,
      channel: 'offline',
      status: 'paid',
      createTime: new Date('2026-11-06T02:00:00+08:00').getTime(),
    }])
  })
})
