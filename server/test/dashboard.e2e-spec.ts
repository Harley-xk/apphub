import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import type { Server } from 'node:http'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { dataSourceStub } from './support/data-source-stub'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import { AppVersionEntity } from '../src/modules/appcenter/entities/app-version.entity'
import { AppEntity } from '../src/modules/appcenter/entities/app.entity'
import type { DashboardOverviewVo } from '../src/modules/dashboard/dto/dashboard.dto'
import { MemberLoginLockEntity } from '../src/modules/member/entities/member-login-lock.entity'
import { MemberEntity } from '../src/modules/member/entities/member.entity'
import { OrderEntity } from '../src/modules/subscription/entities/order.entity'
import { SubscriptionEntity } from '../src/modules/subscription/entities/subscription.entity'
import { LoginLogEntity } from '../src/modules/system/entities/login-log.entity'
import { OperateLogEntity } from '../src/modules/system/entities/operate-log.entity'
import { RolePermissionEntity } from '../src/modules/system/entities/role-permission.entity'
import { RoleEntity } from '../src/modules/system/entities/role.entity'
import { UserAppScopeEntity } from '../src/modules/system/entities/user-app-scope.entity'
import { UserRoleEntity } from '../src/modules/system/entities/user-role.entity'
import { UserEntity } from '../src/modules/system/entities/user.entity'

process.env.SIGNATURE_ENABLED = 'false'
process.env.JWT_SECRET = 'e2e-jwt-secret'

/** admin123 的 BCrypt 散列（与种子迁移同源） */
const PASSWORD_HASH = '$2a$10$8yeFDSyUDUfl4SwuLGEah.XGaPS4uQLJb53EwXiCqXjUyxFKFAkLC'

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000002'
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000003'

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

type Builder = Record<string, (...args: unknown[]) => unknown>

/** 最小 QueryBuilder 桩：聚合查询返回空集，计数与列表由 Repository 桩返回 0 / [] */
function createBuilder(): Builder {
  const builder: Builder = {}
  for (const method of ['select', 'addSelect', 'where', 'andWhere', 'groupBy', 'orderBy'])
    builder[method] = () => builder
  builder.getRawOne = () => Promise.resolve(null)
  builder.getRawMany = () => Promise.resolve([])
  return builder
}

function createReadonlyRepo() {
  return {
    count: () => Promise.resolve(0),
    find: () => Promise.resolve([]),
    createQueryBuilder: () => createBuilder(),
  }
}

describe('DashboardModule (e2e)', () => {
  let app: INestApplication
  let server: Server
  let adminToken: string
  let plainToken: string

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(dataSourceStub)
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
      .useValue(createReadonlyRepo())
      .overrideProvider(getRepositoryToken(AppVersionEntity))
      .useValue(createReadonlyRepo())
      .overrideProvider(getRepositoryToken(MemberEntity))
      .useValue(createReadonlyRepo())
      .overrideProvider(getRepositoryToken(MemberLoginLockEntity))
      .useValue({ count: () => Promise.resolve(0) })
      .overrideProvider(getRepositoryToken(OrderEntity))
      .useValue(createReadonlyRepo())
      .overrideProvider(getRepositoryToken(SubscriptionEntity))
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

  it('未登录访问应 401', async () => {
    await request(server).get('/api/dashboard/overview').expect(401)
  })

  it('无 dashboard:overview:query 权限应 403', async () => {
    await request(server)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${plainToken}`)
      .expect(403)
  })

  it('super_admin 应返回完整契约与统一响应结构（range 缺省 7d）', async () => {
    const res = await request(server)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const body = res.body as ApiResponse<DashboardOverviewVo>
    expect(body.code).toBe(0)
    expect(body.data?.range).toBe('7d')
    expect(typeof body.data?.generatedAt).toBe('number')
    expect(body.data?.todos).toEqual({ expiringSubscriptions: 0, pendingOrders: 0, lockedMembers: 0 })
    expect(body.data?.metrics).toEqual({
      appTotal: 0,
      appEnabled: 0,
      versionTotal: 0,
      versionPublished: 0,
      memberTotal: 0,
      memberNewInRange: 0,
      subscriptionActive: 0,
      subscriptionExpiringSoon: 0,
      revenueInRange: 0,
    })
    expect(body.data?.sparkline.memberDaily).toHaveLength(7)
    expect(body.data?.sparkline.revenueDaily).toHaveLength(7)
    expect(body.data?.latest).toEqual({ orders: [], members: [], versions: [] })
  })

  it('range=30d 应透传并按 30 个自然日补齐 sparkline', async () => {
    const res = await request(server)
      .get('/api/dashboard/overview')
      .query({ range: '30d' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const body = res.body as ApiResponse<DashboardOverviewVo>
    expect(body.data?.range).toBe('30d')
    expect(body.data?.sparkline.memberDaily).toHaveLength(30)
  })

  it('非法 range 应被参数校验拒绝', async () => {
    await request(server)
      .get('/api/dashboard/overview')
      .query({ range: '90d' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
  })
})
