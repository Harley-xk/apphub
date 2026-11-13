import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { DataSource } from 'typeorm'

import { ActivityIngestService } from './activity-ingest.service'
import { AppLookupRegistry } from '../../system/app-scope/app-lookup.port'
import type { ActivityReportDto } from '../activity/dto/activity.dto'
import { ANONYMOUS_MEMBER_ID } from '../analytics.constants'
import { AnalyticsErrorCode } from '../error-codes'
import { MemberIdentityRegistry } from '../ports/member-identity.port'

const APP_ID = '00000000-0000-4000-8000-00000000a001'
const APP_KEY = 'ah_demo0000000001'

interface QueryRecord {
  sql: string
  params: unknown[]
}

/** 记录事务内 SQL 的 DataSource 桩 */
function createDataSourceStub(records: QueryRecord[]): DataSource {
  return {
    transaction: async (callback: (manager: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
      callback({
        query: (sql, params) => {
          records.push({ sql, params })
          return Promise.resolve([])
        },
      }),
  } as unknown as DataSource
}

function createRegistries(options: { memberId?: string | null, tokenAppKey?: string } = {}) {
  const appLookup = new AppLookupRegistry()
  appLookup.register({
    assertAppsExist: () => Promise.resolve(),
    listAppsByIds: () => Promise.resolve([]),
    getByAppKey: appKey => Promise.resolve(
      appKey === APP_KEY
        ? { id: APP_ID, appKey: APP_KEY, name: '示例应用', status: 'enabled' }
        : null,
    ),
  })
  const memberIdentity = new MemberIdentityRegistry()
  memberIdentity.register({
    verifyAccessToken: () => Promise.resolve(
      options.memberId
        ? { memberId: options.memberId, appKey: options.tokenAppKey ?? APP_KEY }
        : null,
    ),
  })
  return { appLookup, memberIdentity }
}

function makeDto(overrides: Partial<ActivityReportDto> = {}): ActivityReportDto {
  return {
    deviceId: 'device-1',
    platform: 'windows',
    arch: 'x64',
    clientVersion: '1.2.3',
    events: [{ type: 'activate', occurredAt: '2026-11-13T04:00:00Z' }],
    ...overrides,
  }
}

describe('ActivityIngestService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-13T04:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function createService(records: QueryRecord[], options: { memberId?: string | null, tokenAppKey?: string } = {}) {
    const { appLookup, memberIdentity } = createRegistries(options)
    return new ActivityIngestService(createDataSourceStub(records), appLookup, memberIdentity)
  }

  it('设备标识非法应抛 DEVICE_ID_INVALID', async () => {
    const service = createService([])
    await expect(service.report(APP_KEY, undefined, makeDto({ deviceId: 'bad id!' })))
      .rejects.toMatchObject({ code: AnalyticsErrorCode.DEVICE_ID_INVALID.code })
  })

  it('单次事件超过 50 条应抛 REPORT_TOO_MANY_EVENTS', async () => {
    const service = createService([])
    const events = Array.from({ length: 51 }, () => ({ type: 'activate', occurredAt: '2026-11-13T04:00:00Z' }))
    await expect(service.report(APP_KEY, undefined, makeDto({ events })))
      .rejects.toMatchObject({ code: AnalyticsErrorCode.REPORT_TOO_MANY_EVENTS.code })
  })

  it('非 semver 客户端版本应被参数错误拒绝', async () => {
    const service = createService([])
    await expect(service.report(APP_KEY, undefined, makeDto({ clientVersion: 'v1' })))
      .rejects.toMatchObject({ code: 400 })
  })

  it('超窗（7 天前 / 未来 5 分钟）事件应丢弃并计数，且不写库', async () => {
    const records: QueryRecord[] = []
    const service = createService(records)
    const result = await service.report(APP_KEY, undefined, makeDto({
      events: [
        { type: 'activate', occurredAt: '2026-11-05T00:00:00Z' },
        { type: 'activate', occurredAt: '2026-11-13T04:10:00Z' },
      ],
    }))
    expect(result).toEqual({ accepted: 0, ignored: 2, memberResolved: false })
    expect(records).toHaveLength(0)
  })

  it('同日同维度多次事件应收敛为一行（首末时间 / 标记只增不减）', async () => {
    const records: QueryRecord[] = []
    const service = createService(records)
    const result = await service.report(APP_KEY, undefined, makeDto({
      events: [
        { type: 'start', occurredAt: '2026-11-13T03:00:00Z' },
        { type: 'activate', occurredAt: '2026-11-13T03:10:00Z' },
        { type: 'stop', occurredAt: '2026-11-13T03:20:00Z' },
      ],
    }))
    expect(result).toEqual({ accepted: 3, ignored: 0, memberResolved: false })
    expect(records).toHaveLength(2)
    const dayQuery = records[0]
    expect(dayQuery.sql).toContain('ON CONFLICT (app_id, stat_date, device_id, member_id, platform, arch, client_version)')
    expect(dayQuery.params).toHaveLength(12)
    expect(dayQuery.params.slice(0, 7)).toEqual([APP_ID, '2026-11-13', 'device-1', ANONYMOUS_MEMBER_ID, 'windows', 'x64', '1.2.3'])
    expect(dayQuery.params.slice(7, 10)).toEqual([true, true, true])
    expect((dayQuery.params[10] as Date).toISOString()).toBe('2026-11-13T03:00:00.000Z')
    expect((dayQuery.params[11] as Date).toISOString()).toBe('2026-11-13T03:20:00.000Z')
  })

  it('匿名与会员态应产生两行，会员行使用解析出的 memberId', async () => {
    const records: QueryRecord[] = []
    const service = createService(records, { memberId: '00000000-0000-4000-8000-0000000000e1' })
    // 第一次匿名
    await service.report(APP_KEY, undefined, makeDto())
    // 第二次带会员 token
    const second = await service.report(APP_KEY, 'Bearer valid-token', makeDto())
    expect(second.memberResolved).toBe(true)
    const memberDayQuery = records[2]
    expect(memberDayQuery.params[3]).toBe('00000000-0000-4000-8000-0000000000e1')
  })

  it('令牌 appKey 与请求不一致应按匿名处理', async () => {
    const records: QueryRecord[] = []
    const service = createService(records, { memberId: '00000000-0000-4000-8000-0000000000e1', tokenAppKey: 'ah_other' })
    const result = await service.report(APP_KEY, 'Bearer valid-token', makeDto())
    expect(result.memberResolved).toBe(false)
    expect(records[0].params[3]).toBe(ANONYMOUS_MEMBER_ID)
  })

  it('仅 start / stop 的批次不应维护设备表', async () => {
    const records: QueryRecord[] = []
    const service = createService(records)
    await service.report(APP_KEY, undefined, makeDto({
      events: [{ type: 'start', occurredAt: '2026-11-13T03:00:00Z' }],
    }))
    expect(records).toHaveLength(1)
    expect(records[0].sql).toContain('analytics_device_day')
  })

  it('含 activate 的批次应同步 upsert 设备表（first_seen 取本批最早激活）', async () => {
    const records: QueryRecord[] = []
    const service = createService(records)
    await service.report(APP_KEY, undefined, makeDto({
      events: [
        { type: 'activate', occurredAt: '2026-11-13T03:10:00Z' },
        { type: 'activate', occurredAt: '2026-11-13T03:00:00Z' },
      ],
    }))
    const deviceQuery = records[1]
    expect(deviceQuery.sql).toContain('ON CONFLICT (app_id, device_id)')
    expect(deviceQuery.sql).not.toContain('first_seen_at = EXCLUDED')
    expect(deviceQuery.params.slice(0, 5)).toEqual([APP_ID, 'device-1', 'windows', 'x64', '1.2.3'])
    expect((deviceQuery.params[5] as Date).toISOString()).toBe('2026-11-13T03:00:00.000Z')
    expect((deviceQuery.params[6] as Date).toISOString()).toBe('2026-11-13T03:10:00.000Z')
  })

  it('跨上海自然日的事件应拆成两行（UTC 16:00 边界）', async () => {
    const records: QueryRecord[] = []
    const service = createService(records)
    await service.report(APP_KEY, undefined, makeDto({
      events: [
        { type: 'activate', occurredAt: '2026-11-12T15:50:00Z' },
        { type: 'activate', occurredAt: '2026-11-12T16:10:00Z' },
      ],
    }))
    expect(records[0].params[1]).toBe('2026-11-12')
    expect(records[0].params.slice(12, 24)[1]).toBe('2026-11-13')
  })
})
