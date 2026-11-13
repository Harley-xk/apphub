import { describe, expect, it } from '@jest/globals'
import type { Repository } from 'typeorm'

import { ActivityService } from './activity.service'
import type { AppScope } from '../../system/app-scope/app-scope.service'
import { AppScopeService } from '../../system/app-scope/app-scope.service'
import { AnalyticsDeviceDayEntity } from '../entities/analytics-device-day.entity'
import { AnalyticsDeviceEntity } from '../entities/analytics-device.entity'
import { AnalyticsErrorCode } from '../error-codes'
import type { ActivityDistributionQueryDto, ActivityRangeQueryDto } from './dto/activity.dto'

interface RepoOptions {
  daily?: Record<string, string>[]
  active?: Record<string, string> | null
  distribution?: Record<string, string | null>[]
  newDevices?: string
}

/** 链式 QueryBuilder 桩：所有方法返回自身，聚合结果由 options 注入 */
function createRepository(options: RepoOptions = {}) {
  const calls = { queryBuilder: 0 }
  const repository = {
    createQueryBuilder: () => {
      calls.queryBuilder += 1
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'addSelect', 'where', 'andWhere', 'setParameter', 'groupBy', 'orderBy', 'addOrderBy'])
        builder[method] = () => builder
      builder.getRawMany = () => Promise.resolve(options.distribution ?? options.daily ?? [])
      builder.getRawOne = () => Promise.resolve(options.active ?? (options.newDevices ? { count: options.newDevices } : null))
      return builder
    },
  } as unknown as Repository<AnalyticsDeviceDayEntity>
  return { repository, calls }
}

function createService(
  scope: AppScope,
  dayOptions: RepoOptions = {},
  deviceOptions: RepoOptions = {},
) {
  const day = createRepository(dayOptions)
  const device = createRepository(deviceOptions)
  const appScopeService = {
    resolve: () => Promise.resolve(scope),
  } as unknown as AppScopeService
  return new ActivityService(
    day.repository,
    device.repository as unknown as Repository<AnalyticsDeviceEntity>,
    appScopeService,
  )
}

const RANGE: ActivityRangeQueryDto = {
  startDate: '2026-11-01',
  endDate: '2026-11-07',
}

describe('ActivityService', () => {
  it('区间超过 180 天应抛 DATE_RANGE_TOO_LARGE', async () => {
    const service = createService({ mode: 'all' })
    await expect(service.getSummary({ startDate: '2026-01-01', endDate: '2026-12-31' }, 'u1'))
      .rejects.toMatchObject({ code: AnalyticsErrorCode.DATE_RANGE_TOO_LARGE.code })
  })

  it('开始日期晚于结束日期应按参数错误拒绝', async () => {
    const service = createService({ mode: 'all' })
    await expect(service.getSummary({ startDate: '2026-11-08', endDate: '2026-11-07' }, 'u1'))
      .rejects.toMatchObject({ code: 400 })
  })

  it('显式 appId 不在授权范围内应抛 007300005（403）', async () => {
    const service = createService({ mode: 'scoped', appIds: ['app-a'] })
    await expect(service.getSummary({ ...RANGE, appId: 'app-b' }, 'u1'))
      .rejects.toMatchObject({ code: AnalyticsErrorCode.APP_SCOPE_FORBIDDEN.code, status: 403 })
  })

  it('数据范围为空集应 fail-closed 返回全 0 与定长趋势，不触库', async () => {
    const service = createService({ mode: 'scoped', appIds: [] })
    const result = await service.getSummary(RANGE, 'u1')
    expect(result).toEqual({
      deviceDau: 0,
      memberDau: 0,
      deviceActive: 0,
      memberActive: 0,
      newDevices: 0,
      trend: [
        { date: '2026-11-01', deviceDau: 0, memberDau: 0 },
        { date: '2026-11-02', deviceDau: 0, memberDau: 0 },
        { date: '2026-11-03', deviceDau: 0, memberDau: 0 },
        { date: '2026-11-04', deviceDau: 0, memberDau: 0 },
        { date: '2026-11-05', deviceDau: 0, memberDau: 0 },
        { date: '2026-11-06', deviceDau: 0, memberDau: 0 },
        { date: '2026-11-07', deviceDau: 0, memberDau: 0 },
      ],
    })
  })

  it('概览应取区间最后一天日活、区间去重活跃与新增设备，并补齐趋势', async () => {
    const service = createService(
      { mode: 'all' },
      {
        daily: [
          { day: '2026-11-06', device_count: '2', member_count: '1' },
          { day: '2026-11-07', device_count: '5', member_count: '2' },
        ],
        active: { device_count: '10', member_count: '3' },
      },
      { newDevices: '4' },
    )
    const result = await service.getSummary(RANGE, 'u1')
    expect(result.deviceDau).toBe(5)
    expect(result.memberDau).toBe(2)
    expect(result.deviceActive).toBe(10)
    expect(result.memberActive).toBe(3)
    expect(result.newDevices).toBe(4)
    expect(result.trend).toHaveLength(7)
    expect(result.trend[0]).toEqual({ date: '2026-11-01', deviceDau: 0, memberDau: 0 })
    expect(result.trend[6]).toEqual({ date: '2026-11-07', deviceDau: 5, memberDau: 2 })
  })

  it('分布查询应映射为 key / deviceCount / memberCount（空值 key 归一为空串）', async () => {
    const service = createService({ mode: 'all' }, {
      distribution: [
        { key: 'windows', device_count: '3', member_count: '1' },
        { key: null, device_count: '1', member_count: '0' },
      ],
    })
    const query: ActivityDistributionQueryDto = { ...RANGE, dimension: 'platform' }
    const result = await service.getDistribution(query, 'u1')
    expect(result).toEqual([
      { key: 'windows', deviceCount: 3, memberCount: 1 },
      { key: '', deviceCount: 1, memberCount: 0 },
    ])
  })

  it('数据范围为空集时分布应返回空数组', async () => {
    const service = createService({ mode: 'scoped', appIds: [] })
    const result = await service.getDistribution({ ...RANGE, dimension: 'version' }, 'u1')
    expect(result).toEqual([])
  })
})
