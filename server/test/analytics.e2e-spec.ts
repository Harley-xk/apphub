import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import type { Server } from 'node:http'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { dataSourceStub } from './support/data-source-stub'
import { signHeaders } from './support/signature.helper'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import type { ActivityReportVo, ActivitySummaryVo } from '../src/modules/analytics/activity/dto/activity.dto'
import { AnalyticsDeviceDayEntity } from '../src/modules/analytics/entities/analytics-device-day.entity'
import { AnalyticsDeviceEntity } from '../src/modules/analytics/entities/analytics-device.entity'
import { AppEntity } from '../src/modules/appcenter/entities/app.entity'
import { LoginLogEntity } from '../src/modules/system/entities/login-log.entity'
import { OperateLogEntity } from '../src/modules/system/entities/operate-log.entity'
import { RolePermissionEntity } from '../src/modules/system/entities/role-permission.entity'
import { RoleEntity } from '../src/modules/system/entities/role.entity'
import { UserAppScopeEntity } from '../src/modules/system/entities/user-app-scope.entity'
import { UserRoleEntity } from '../src/modules/system/entities/user-role.entity'
import { UserEntity } from '../src/modules/system/entities/user.entity'

process.env.SIGNATURE_ENABLED = 'true'
process.env.SIGNATURE_SECRET = 'e2e-sign-secret'
process.env.JWT_SECRET = 'e2e-jwt-secret'
process.env.MEMBER_JWT_SECRET = 'e2e-member-jwt-secret'

const PASSWORD_HASH = '$2a$10$8yeFDSyUDUfl4SwuLGEah.XGaPS4uQLJb53EwXiCqXjUyxFKFAkLC'

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000002'
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000003'

const APP_KEY = 'ah_analytics0000001'
const APP_SECRET = 'analytics-app-secret'
const APP_ID = '00000000-0000-4000-8000-0000000000a1'

const apps: Partial<AppEntity>[] = [
  {
    id: APP_ID,
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    name: '活跃度统计应用',
    appType: ['desktop'],
    clientType: 'confidential',
    framework: 'electron',
    status: 'enabled',
  },
]
const users: Partial<UserEntity>[] = [
  { id: ADMIN_ID, username: 'admin', nickname: '系统管理员', password: PASSWORD_HASH, status: true },
  { id: PLAIN_USER_ID, username: 'nobody', nickname: '无权限用户', password: PASSWORD_HASH, status: true },
]
const roles: Partial<RoleEntity>[] = [
  { id: SUPER_ADMIN_ROLE_ID, code: 'super_admin', name: '超级管理员', status: true, dataScope: 'all' },
]
const userRoles: Partial<UserRoleEntity>[] = [
  { userId: ADMIN_ID, roleId: SUPER_ADMIN_ROLE_ID },
]

/** 链式只读 QueryBuilder 桩：聚合返回空集（契约验证不依赖真实数据） */
function createReadonlyBuilder() {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'addSelect', 'where', 'andWhere', 'setParameter', 'groupBy', 'orderBy', 'addOrderBy'])
    builder[method] = () => builder
  builder.getRawMany = () => Promise.resolve([])
  builder.getRawOne = () => Promise.resolve(null)
  return builder
}

function createReadonlyRepo() {
  return {
    createQueryBuilder: () => createReadonlyBuilder(),
    count: () => Promise.resolve(0),
    find: () => Promise.resolve([]),
  }
}

interface WriteRecord {
  sql: string
  params: unknown[]
}

describe('AnalyticsModule (e2e)', () => {
  let app: INestApplication
  let server: Server
  let adminToken: string
  let plainToken: string
  const writes: WriteRecord[] = []

  const appSigned = (path: string, bodyObj: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => {
    const body = JSON.stringify(bodyObj)
    const deviceId = typeof bodyObj.deviceId === 'string' ? bodyObj.deviceId : ''
    return request(server)
      .post(path)
      .set('x-app-key', APP_KEY)
      .set('x-device-id', deviceId)
      .set(signHeaders('POST', path, body, { secret: APP_SECRET }))
      .set(extraHeaders)
      .set('Content-Type', 'application/json')
      .send(body)
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue({
        ...dataSourceStub,
        transaction: async (
          callback: (manager: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<unknown>,
        ) => callback({
          query: (sql, params) => {
            writes.push({ sql, params })
            return Promise.resolve([])
          },
        }),
      })
      .overrideProvider(getRepositoryToken(UserEntity))
      .useValue({
        findOne: ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(users.find(user => Object.entries(where).every(([key, value]) => (user as Record<string, unknown>)[key] === value)) ?? null),
        find: () => Promise.resolve(users),
        findAndCount: () => Promise.resolve([users, users.length]),
        save: (entity: Partial<UserEntity>) => Promise.resolve(entity),
        create: (data: Partial<UserEntity>) => Object.assign({ status: true }, data),
        softRemove: () => Promise.resolve(),
      })
      .overrideProvider(getRepositoryToken(RoleEntity))
      .useValue({
        find: (criteria: { where?: { status?: boolean, id?: { value?: string[] } } } = {}) => {
          const where = criteria.where ?? {}
          const roleIds = where.id?.value
          return Promise.resolve(roles.filter(role =>
            (where.status === undefined || role.status === where.status)
            && (roleIds === undefined || roleIds.includes(role.id!)),
          ))
        },
      })
      .overrideProvider(getRepositoryToken(UserRoleEntity))
      .useValue({
        find: ({ where }: { where: { userId: string } }) =>
          Promise.resolve(userRoles.filter(relation => relation.userId === where.userId)),
      })
      .overrideProvider(getRepositoryToken(RolePermissionEntity))
      .useValue({ find: () => Promise.resolve([]) })
      .overrideProvider(getRepositoryToken(UserAppScopeEntity))
      .useValue({ find: () => Promise.resolve([]) })
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue({
        findOne: ({ where }: { where?: Record<string, unknown> } = {}) =>
          Promise.resolve(apps.find(app => Object.entries(where ?? {}).every(([key, value]) => (app as Record<string, unknown>)[key] === value)) ?? null),
        find: () => Promise.resolve(apps),
      })
      .overrideProvider(getRepositoryToken(AnalyticsDeviceDayEntity))
      .useValue(createReadonlyRepo())
      .overrideProvider(getRepositoryToken(AnalyticsDeviceEntity))
      .useValue(createReadonlyRepo())
      .overrideProvider(getRepositoryToken(OperateLogEntity))
      .useValue({ insert: () => Promise.resolve() })
      .overrideProvider(getRepositoryToken(LoginLogEntity))
      .useValue({ insert: () => Promise.resolve() })
      .compile()

    app = moduleFixture.createNestApplication({ rawBody: true })
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.init()
    server = app.getHttpServer() as Server

    const login = async (username: string) => {
      const res = await request(server).post('/api/system/auth/login').send({ username, password: 'admin123' })
      return (res.body as ApiResponse<{ token: string }>).data!.token
    }
    adminToken = await login('admin')
    plainToken = await login('nobody')
  })

  afterAll(async () => {
    await app.close()
  })

  // ===== 上报接口 =====

  it('匿名上报应 200 并写入日表与设备表', async () => {
    writes.length = 0
    const res = await appSigned('/api/open/app/activity/report', {
      deviceId: 'device-e2e-1',
      platform: 'windows',
      arch: 'x64',
      clientVersion: '1.0.0',
      events: [
        { type: 'start', occurredAt: new Date().toISOString() },
        { type: 'activate', occurredAt: new Date().toISOString() },
      ],
    }).expect(200)
    const body = res.body as ApiResponse<ActivityReportVo>
    expect(body.code).toBe(0)
    expect(body.data).toEqual({ accepted: 2, ignored: 0, memberResolved: false })
    expect(writes.map(write => write.sql)).toEqual([
      expect.stringContaining('analytics_device_day'),
      expect.stringContaining('analytics_device'),
    ])
  })

  it('带有效会员 token 应 memberResolved=true 并写入会员行', async () => {
    writes.length = 0
    const token = new JwtService({ secret: 'e2e-member-jwt-secret' })
      .sign({ sub: '00000000-0000-4000-8000-0000000000e1', appKey: APP_KEY })
    const res = await appSigned(
      '/api/open/app/activity/report',
      {
        deviceId: 'device-e2e-1',
        platform: 'windows',
        arch: 'x64',
        clientVersion: '1.0.0',
        events: [{ type: 'activate', occurredAt: new Date().toISOString() }],
      },
      { Authorization: `Bearer ${token}` },
    ).expect(200)
    expect((res.body as ApiResponse<ActivityReportVo>).data?.memberResolved).toBe(true)
    expect(writes[0].params[3]).toBe('00000000-0000-4000-8000-0000000000e1')
  })

  it('token 过期 / 伪造应按匿名接受，不报错', async () => {
    const res = await appSigned(
      '/api/open/app/activity/report',
      {
        deviceId: 'device-e2e-1',
        platform: 'windows',
        arch: 'x64',
        clientVersion: '1.0.0',
        events: [{ type: 'activate', occurredAt: new Date().toISOString() }],
      },
      { Authorization: 'Bearer not-a-jwt' },
    ).expect(200)
    expect((res.body as ApiResponse<ActivityReportVo>).data?.memberResolved).toBe(false)
  })

  it('超窗事件应丢弃并计数', async () => {
    const res = await appSigned('/api/open/app/activity/report', {
      deviceId: 'device-e2e-2',
      platform: 'windows',
      arch: 'x64',
      clientVersion: '1.0.0',
      events: [{ type: 'activate', occurredAt: '2020-01-01T00:00:00Z' }],
    }).expect(200)
    expect((res.body as ApiResponse<ActivityReportVo>).data).toEqual({ accepted: 0, ignored: 1, memberResolved: false })
  })

  it('单次超过 50 条应返回 007300002', async () => {
    const events = Array.from({ length: 51 }, () => ({ type: 'activate', occurredAt: new Date().toISOString() }))
    const res = await appSigned('/api/open/app/activity/report', {
      deviceId: 'device-e2e-3',
      platform: 'windows',
      arch: 'x64',
      clientVersion: '1.0.0',
      events,
    }).expect(400)
    expect((res.body as ApiResponse<null>).code).toBe(700300002)
  })

  it('设备标识非法应返回 007300001', async () => {
    const res = await appSigned('/api/open/app/activity/report', {
      deviceId: 'bad device!',
      platform: 'windows',
      arch: 'x64',
      clientVersion: '1.0.0',
      events: [{ type: 'activate', occurredAt: new Date().toISOString() }],
    }).expect(400)
    expect((res.body as ApiResponse<null>).code).toBe(700300001)
  })

  it('签名缺失应 401', async () => {
    await request(server)
      .post('/api/open/app/activity/report')
      .set('x-app-key', APP_KEY)
      .send({ deviceId: 'device-e2e-4', platform: 'windows', clientVersion: '1.0.0', events: [{ type: 'activate', occurredAt: new Date().toISOString() }] })
      .expect(401)
  })

  it('同一设备超过阈值应 429（AppKey + 设备维度限流）', async () => {
    const payload = {
      deviceId: 'device-e2e-rate',
      platform: 'windows',
      arch: 'x64',
      clientVersion: '1.0.0',
      events: [{ type: 'activate', occurredAt: new Date().toISOString() }],
    }
    for (let i = 0; i < 120; i++)
      await appSigned('/api/open/app/activity/report', payload).expect(200)
    await appSigned('/api/open/app/activity/report', payload).expect(429)
  })

  // ===== 查询接口 =====

  it('未登录查询应 401', async () => {
    await request(server)
      .get('/api/analytics/activity/summary')
      .query({ startDate: '2026-11-01', endDate: '2026-11-07' })
      .expect(401)
  })

  it('无 analytics:activity:query 权限应 403', async () => {
    await request(server)
      .get('/api/analytics/activity/summary')
      .query({ startDate: '2026-11-01', endDate: '2026-11-07' })
      .set('Authorization', `Bearer ${plainToken}`)
      .expect(403)
  })

  it('super_admin 概览应返回定长 7 点趋势（空数据全 0）', async () => {
    const res = await request(server)
      .get('/api/analytics/activity/summary')
      .query({ startDate: '2026-11-01', endDate: '2026-11-07' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const body = res.body as ApiResponse<ActivitySummaryVo>
    expect(body.code).toBe(0)
    expect(body.data?.deviceDau).toBe(0)
    expect(body.data?.trend).toHaveLength(7)
    expect(body.data?.trend[0]).toEqual({ date: '2026-11-01', deviceDau: 0, memberDau: 0 })
  })

  it('区间超过 180 天应返回 007300004', async () => {
    const res = await request(server)
      .get('/api/analytics/activity/summary')
      .query({ startDate: '2026-01-01', endDate: '2026-12-31' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
    expect((res.body as ApiResponse<null>).code).toBe(700300004)
  })

  it('分布维度非法应被参数校验拒绝', async () => {
    await request(server)
      .get('/api/analytics/activity/distribution')
      .query({ startDate: '2026-11-01', endDate: '2026-11-07', dimension: 'os' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
  })

  it('分布查询应返回数组契约', async () => {
    const res = await request(server)
      .get('/api/analytics/activity/distribution')
      .query({ startDate: '2026-11-01', endDate: '2026-11-07', dimension: 'platform' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect((res.body as ApiResponse<unknown[]>).data).toEqual([])
  })
})
