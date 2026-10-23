import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import type { Server } from 'node:http'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { dataSourceStub } from './support/data-source-stub'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import { AppEntity } from '../src/modules/appcenter/entities/app.entity'
import { MemberEntity } from '../src/modules/member/entities/member.entity'
import { OrderEntity } from '../src/modules/subscription/entities/order.entity'
import { SubPlanEntity } from '../src/modules/subscription/entities/sub-plan.entity'
import { SubscriptionEntity } from '../src/modules/subscription/entities/subscription.entity'
import { LoginLogEntity } from '../src/modules/system/entities/login-log.entity'
import { OperateLogEntity } from '../src/modules/system/entities/operate-log.entity'
import { RolePermissionEntity } from '../src/modules/system/entities/role-permission.entity'
import { RoleEntity } from '../src/modules/system/entities/role.entity'
import { UserAppScopeEntity } from '../src/modules/system/entities/user-app-scope.entity'
import { UserRoleEntity } from '../src/modules/system/entities/user-role.entity'
import { UserEntity } from '../src/modules/system/entities/user.entity'

// 管理端链路关闭签名（登录接口双豁免不受影响）；开放端点签名链路见 subscription-open.e2e-spec.ts
process.env.SIGNATURE_ENABLED = 'false'
process.env.JWT_SECRET = 'e2e-jwt-secret'

/** admin123 的 BCrypt 散列（与种子迁移同源） */
const PASSWORD_HASH = '$2a$10$8yeFDSyUDUfl4SwuLGEah.XGaPS4uQLJb53EwXiCqXjUyxFKFAkLC'

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000002'
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000003'
const APP_ID = '00000000-0000-4000-8000-0000000000b1'
const OTHER_APP_ID = '00000000-0000-4000-8000-0000000000b3'
const MEMBER_ID = '00000000-0000-4000-8000-0000000000b2'
// 应用管理员（数据范围 = 按应用）：仅授权 APP_ID，用于订阅域收口验收
const APP_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000004'
const APP_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000005'

// ===== 内存数据 =====

const users: Partial<UserEntity>[] = [
  { id: ADMIN_ID, username: 'admin', nickname: '系统管理员', password: PASSWORD_HASH, status: true },
  { id: PLAIN_USER_ID, username: 'nobody', nickname: '无权限用户', password: PASSWORD_HASH, status: true },
  { id: APP_ADMIN_USER_ID, username: 'appadmin', nickname: '应用管理员', password: PASSWORD_HASH, status: true },
]
const roles: Partial<RoleEntity>[] = [
  { id: SUPER_ADMIN_ROLE_ID, code: 'super_admin', name: '超级管理员', status: true, dataScope: 'all' },
  { id: APP_ADMIN_ROLE_ID, code: 'app_admin', name: '应用管理员', status: true, dataScope: 'app' },
]
const userRoles: Partial<UserRoleEntity>[] = [
  { userId: ADMIN_ID, roleId: SUPER_ADMIN_ROLE_ID },
  { userId: APP_ADMIN_USER_ID, roleId: APP_ADMIN_ROLE_ID },
]
/** app_admin 的订阅域权限行（数据范围只认授予该域权限的角色——A4） */
const rolePermissions: Partial<RolePermissionEntity>[] = [
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:plan:query' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:plan:create' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:plan:update' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:plan:remove' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:order:query' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:order:offline-create' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:order:close' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'subscription:sub:query' },
]
/** 账户级授权：仅 APP_ID */
const userAppScopes: Partial<UserAppScopeEntity>[] = [{ userId: APP_ADMIN_USER_ID, appId: APP_ID }]
const operateLogs: Partial<OperateLogEntity>[] = []
const apps: Partial<AppEntity>[] = [
  { id: APP_ID, appKey: 'ah_subscribe000001', appSecret: 'sub-secret', name: '订阅链路应用', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'enabled' },
  { id: OTHER_APP_ID, appKey: 'ah_subscribe000002', appSecret: 'other-secret', name: '未授权订阅应用', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'enabled' },
]
const members: Partial<MemberEntity>[] = [
  { id: MEMBER_ID, nickname: '订阅测试会员', avatarUrl: null, status: 'active', registeredAppId: APP_ID, lastLoginAt: null },
]
const plans: Partial<SubPlanEntity>[] = []
const subscriptions: Partial<SubscriptionEntity>[] = []
const orders: Partial<OrderEntity>[] = []

/** 行匹配 where 等值条件（含 Not / In / Like / LessThan 操作符） */
function matches(row: unknown, where: Record<string, unknown> | undefined): boolean {
  if (!where)
    return true
  const record = row as Record<string, unknown>
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && 'type' in (value as Record<string, unknown>)) {
      const operator = value as { type: string, value?: unknown }
      if (operator.type === 'not')
        return record[key] !== operator.value
      if (operator.type === 'in')
        return Array.isArray(operator.value) && (operator.value as unknown[]).includes(record[key])
      if (operator.type === 'like')
        return typeof record[key] === 'string' && typeof operator.value === 'string'
          && record[key].includes(operator.value.replaceAll('%', ''))
      if (operator.type === 'lessThan')
        return record[key] instanceof Date && operator.value instanceof Date && record[key] < operator.value
      if (operator.type === 'moreThan')
        return record[key] instanceof Date && operator.value instanceof Date && record[key] > operator.value
    }
    return record[key] === value
  })
}

let idSeq = 0
function nextId(): string {
  idSeq += 1
  return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`
}

/** 内存仓储桩：insert / save 自动补 id，softDelete / update 支持 e2e 全链路 */
function makeMemoryRepo<T extends { id?: string }>(rows: Partial<T>[]) {
  return {
    rows,
    find: ({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(row => matches(row, where)) as T[]),
    findOne: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve((rows.find(row => matches(row, options.where)) ?? null) as T | null),
    findAndCount: ({ where }: { where?: Record<string, unknown> }) => {
      const list = rows.filter(row => matches(row, where)) as T[]
      return Promise.resolve([list, list.length] as [T[], number])
    },
    insert: (entity: Partial<T> & { id?: string }) => {
      entity.id ??= nextId()
      rows.push(entity)
      return Promise.resolve()
    },
    save: (entity: Partial<T> & { id?: string }) => {
      entity.id ??= nextId()
      const index = rows.findIndex(row => row.id === entity.id)
      if (index >= 0)
        rows[index] = entity
      else
        rows.push(entity)
      return Promise.resolve(entity as T)
    },
    create: (data: Partial<T>) => ({ ...data }) as T,
    update: (whereOrId: Record<string, unknown> | string, changes: Record<string, unknown>) => {
      const where = typeof whereOrId === 'string' ? { id: whereOrId } : whereOrId
      let affected = 0
      for (const row of rows) {
        if (matches(row, where)) {
          Object.assign(row as Record<string, unknown>, changes)
          affected++
        }
      }
      return Promise.resolve({ affected, raw: [], generatedMaps: [] })
    },
    softDelete: (criteria: Record<string, unknown> | string) => {
      const where = typeof criteria === 'string' ? { id: criteria } : criteria
      for (let index = rows.length - 1; index >= 0; index--) {
        if (matches(rows[index], where))
          rows.splice(index, 1)
      }
      return Promise.resolve()
    },
  }
}

const planRepo = makeMemoryRepo<SubPlanEntity>(plans)
const subscriptionRepo = makeMemoryRepo<SubscriptionEntity>(subscriptions)
const orderRepo = makeMemoryRepo<OrderEntity>(orders)

// 备案与回调走 dataSource.transaction：manager.getRepository 按实体类分流到同一内存集合（订单 insert + 订阅顺延同事务）
const subscriptionDataSource = {
  ...dataSourceStub,
  transaction: <T>(run: (manager: unknown) => Promise<T>) =>
    run({
      getRepository: (entity: { name?: string }) =>
        entity.name === 'SubscriptionEntity' ? subscriptionRepo : orderRepo,
    }),
}

describe('SubscriptionModule (e2e)', () => {
  let app: INestApplication
  let server: Server
  let adminToken: string
  let plainToken: string
  let appAdminToken: string
  let monthlyPlanId: string
  let yearlyPlanId: string
  let permanentPlanId: string

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(subscriptionDataSource)
      .overrideProvider(getRepositoryToken(UserEntity))
      .useValue({
        findOne: ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(users.find(user => matches(user, where)) ?? null),
        find: () => Promise.resolve(users),
        findAndCount: () => Promise.resolve([users, users.length]),
        save: (entity: Partial<UserEntity>) => Promise.resolve(entity),
        create: (data: Partial<UserEntity>) => Object.assign({ status: true }, data),
        softRemove: () => Promise.resolve(),
      })
      .overrideProvider(getRepositoryToken(RoleEntity))
      .useValue({
        find: (criteria: { where?: { status?: boolean, id?: { value?: string[] } } }) => {
          const where = criteria.where ?? {}
          const roleIds = where.id?.value
          return Promise.resolve(
            roles.filter(role =>
              (where.status === undefined || role.status === where.status)
              && (roleIds === undefined || roleIds.includes(role.id!)),
            ),
          )
        },
      })
      .overrideProvider(getRepositoryToken(UserRoleEntity))
      .useValue({
        find: (criteria: { where: { userId: string } }) =>
          Promise.resolve(userRoles.filter(relation => relation.userId === criteria.where.userId)),
      })
      .overrideProvider(getRepositoryToken(RolePermissionEntity))
      .useValue({
        find: (criteria: { where?: { roleId?: { value?: string[] }, permission?: { value?: string } } }) => {
          const where = criteria.where ?? {}
          const roleIds = where.roleId?.value
          const prefix = (where.permission?.value ?? '').replace('%', '')
          return Promise.resolve(
            rolePermissions.filter(relation =>
              (roleIds === undefined || roleIds.includes(relation.roleId!))
              && (prefix === '' || (relation.permission ?? '').startsWith(prefix)),
            ),
          )
        },
      })
      .overrideProvider(getRepositoryToken(UserAppScopeEntity))
      .useValue({
        find: (criteria: { where: { userId: string } }) =>
          Promise.resolve(userAppScopes.filter(row => row.userId === criteria.where.userId)),
      })
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue({ findOne: (o: { where?: Record<string, unknown> }) => Promise.resolve(apps.find(a => matches(a, o.where)) ?? null), find: () => Promise.resolve(apps) })
      .overrideProvider(getRepositoryToken(MemberEntity))
      .useValue({ findOne: (o: { where?: Record<string, unknown> }) => Promise.resolve(members.find(m => matches(m, o.where)) ?? null), find: () => Promise.resolve(members) })
      .overrideProvider(getRepositoryToken(SubPlanEntity))
      .useValue(planRepo)
      .overrideProvider(getRepositoryToken(SubscriptionEntity))
      .useValue(subscriptionRepo)
      .overrideProvider(getRepositoryToken(OrderEntity))
      .useValue(orderRepo)
      .overrideProvider(getRepositoryToken(OperateLogEntity))
      .useValue({
        insert: (entity: Partial<OperateLogEntity>) => {
          operateLogs.push(entity)
          return Promise.resolve()
        },
      })
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
    appAdminToken = await login('appadmin')
  })

  afterAll(async () => {
    await app.close()
  })

  describe('计划管理', () => {
    it('新建三档计划应成功且 durationMonths 按档位映射（服务端不信任前端）', async () => {
      const create = (body: Record<string, unknown>) =>
        request(server).post('/api/subscription/plan').set('Authorization', `Bearer ${adminToken}`).send(body)
      const monthly = await create({ appId: APP_ID, name: '专业版 · 月付', periodType: 'monthly', price: 1500 })
      const yearly = await create({ appId: APP_ID, name: '专业版 · 年付', periodType: 'yearly', price: 99000, originalPrice: 180000 })
      const permanent = await create({ appId: APP_ID, name: '永久买断', periodType: 'permanent', price: 199000 })
      expect((monthly.body as ApiResponse<string>).code).toBe(0)
      monthlyPlanId = (monthly.body as ApiResponse<string>).data!
      yearlyPlanId = (yearly.body as ApiResponse<string>).data!
      permanentPlanId = (permanent.body as ApiResponse<string>).data!
      const row = plans.find(plan => plan.id === monthlyPlanId)!
      expect(row.durationMonths).toBe(1)
      expect(plans.find(plan => plan.id === permanentPlanId)!.durationMonths).toBeNull()
      expect(row.status).toBe('on')
    })

    it('计划列表应回显应用名并按 sort 升序', async () => {
      const res = await request(server)
        .get('/api/subscription/plan').set('Authorization', `Bearer ${adminToken}`).query({ appId: APP_ID })
      const body = res.body as ApiResponse<{ list: { appName: string, name: string }[], total: number }>
      expect(body.code).toBe(0)
      expect(body.data!.total).toBe(3)
      expect(body.data!.list.every(item => item.appName === '订阅链路应用')).toBe(true)

      // 关键字模糊过滤（不同名计划不得混入）
      const keywordRes = await request(server)
        .get('/api/subscription/plan').set('Authorization', `Bearer ${adminToken}`).query({ keyword: '永久' })
      const keywordBody = keywordRes.body as ApiResponse<{ list: { name: string }[], total: number }>
      expect(keywordBody.data!.list.map(plan => plan.name)).toEqual(['永久买断'])
    })

    it('非法周期档位应被参数校验拒绝', async () => {
      const res = await request(server)
        .post('/api/subscription/plan').set('Authorization', `Bearer ${adminToken}`)
        .send({ appId: APP_ID, name: '周付', periodType: 'weekly', price: 100 })
      expect(res.status).toBe(400)
    })

    it('无权限用户应 403', async () => {
      const res = await request(server)
        .get('/api/subscription/plan').set('Authorization', `Bearer ${plainToken}`)
      expect(res.status).toBe(403)
    })

    it('数据范围收窄：app_admin 列表只含授权应用，显式查询 / 新建未授权应用应 403 专用码', async () => {
      // 列表按订阅域范围注入 appId IN：其他应用的计划不可见
      const listRes = await request(server)
        .get('/api/subscription/plan').set('Authorization', `Bearer ${appAdminToken}`)
      const listBody = listRes.body as ApiResponse<{ list: { appId: string }[], total: number }>
      expect(listBody.code).toBe(0)
      expect(listBody.data!.total).toBe(3)
      expect(listBody.data!.list.every(plan => plan.appId === APP_ID)).toBe(true)

      // 授权应用的显式筛选放行
      const allowed = await request(server)
        .get('/api/subscription/plan').set('Authorization', `Bearer ${appAdminToken}`).query({ appId: APP_ID })
      expect(allowed.status).toBe(200)

      // 显式查询未授权应用 / 在未授权应用下建计划 → 403 + 300100005
      const forbidden = (res: { body: unknown }) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300100005)
      }
      await request(server)
        .get('/api/subscription/plan').set('Authorization', `Bearer ${appAdminToken}`).query({ appId: OTHER_APP_ID })
        .expect(403)
        .expect(forbidden)
      await request(server)
        .post('/api/subscription/plan').set('Authorization', `Bearer ${appAdminToken}`)
        .send({ appId: OTHER_APP_ID, name: '越权计划', periodType: 'monthly', price: 100 })
        .expect(403)
        .expect(forbidden)
    })
  })

  describe('线下备案与续费顺延（验收项 1/3）', () => {
    it('备案年付订单应直接 paid 且订阅实例即时创建', async () => {
      const res = await request(server)
        .post('/api/subscription/order/offline').set('Authorization', `Bearer ${adminToken}`)
        .send({ memberId: MEMBER_ID, planId: yearlyPlanId, amount: 99000, transactionId: 'FLOW-001', offlineNote: '银行转账' })
      const body = res.body as ApiResponse<{ orderNo: string, status: string, paidAt: string, planName: string }>
      expect(body.code).toBe(0)
      expect(body.data!.status).toBe('paid')
      expect(body.data!.planName).toBe('专业版 · 年付')
      expect(body.data!.orderNo).toMatch(/^AH\d{12}[A-HJ-NP-Z2-9]{6}$/)
      expect(subscriptions).toHaveLength(1)
      expect(subscriptions[0].planId).toBe(yearlyPlanId)
    })

    it('再次备案应顺延到期时间而非新建实例（D20 单实例）', async () => {
      const before = subscriptions[0].expireAt!
      const res = await request(server)
        .post('/api/subscription/order/offline').set('Authorization', `Bearer ${adminToken}`)
        .send({ memberId: MEMBER_ID, planId: yearlyPlanId, amount: 99000 })
      expect((res.body as ApiResponse<unknown>).code).toBe(0)
      expect(subscriptions).toHaveLength(1)
      expect((subscriptions[0].expireAt!).getTime()).toBeGreaterThan(before.getTime())
    })

    it('备案永久档应覆盖为哨兵值', async () => {
      const res = await request(server)
        .post('/api/subscription/order/offline').set('Authorization', `Bearer ${adminToken}`)
        .send({ memberId: MEMBER_ID, planId: permanentPlanId, amount: 199000 })
      expect((res.body as ApiResponse<unknown>).code).toBe(0)
      expect((subscriptions[0].expireAt!).getUTCFullYear()).toBe(2999)
    })

    it('周期类备案到永久实例应拒绝（005003002，永久即终态）', async () => {
      const res = await request(server)
        .post('/api/subscription/order/offline').set('Authorization', `Bearer ${adminToken}`)
        .send({ memberId: MEMBER_ID, planId: monthlyPlanId, amount: 1500 })
      expect((res.body as ApiResponse<unknown>).code).toBe(500300002)
    })

    it('下架计划后不可再备案但存量订阅不受影响（005001002）', async () => {
      await request(server)
        .put(`/api/subscription/plan/${monthlyPlanId}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '专业版 · 月付', periodType: 'monthly', price: 1500, status: 'off' })
      const res = await request(server)
        .post('/api/subscription/order/offline').set('Authorization', `Bearer ${adminToken}`)
        .send({ memberId: MEMBER_ID, planId: monthlyPlanId, amount: 1500 })
      expect((res.body as ApiResponse<unknown>).code).toBe(500100002)
      expect((subscriptions[0].expireAt!).getUTCFullYear()).toBe(2999)
    })
  })

  describe('订单列表与关单（验收项 2 可达部分）', () => {
    it('订单列表应回显会员昵称与应用名并按渠道筛选', async () => {
      const res = await request(server)
        .get('/api/subscription/order').set('Authorization', `Bearer ${adminToken}`)
        .query({ channel: 'offline', memberId: MEMBER_ID })
      const body = res.body as ApiResponse<{ list: { memberNickname: string, appName: string, status: string }[], total: number }>
      expect(body.code).toBe(0)
      expect(body.data!.total).toBe(3)
      expect(body.data!.list[0].memberNickname).toBe('订阅测试会员')
      expect(body.data!.list.every(item => item.status === 'paid')).toBe(true)
    })

    it('手动关闭 pending 订单应成功，关闭非 pending 应拒绝（005002002）', async () => {
      orders.push({
        id: '00000000-0000-4000-8000-0000000000c9',
        orderNo: 'AH261017100000ZZZ9999',
        memberId: MEMBER_ID,
        appId: APP_ID,
        planId: monthlyPlanId,
        planName: '专业版 · 月付',
        periodType: 'monthly',
        amount: 1500,
        channel: 'offline',
        status: 'pending',
        transactionId: null,
        paidAt: null,
        expireAt: new Date(Date.now() + 3600_000),
        offlineNote: null,
      })
      const close = await request(server)
        .post('/api/subscription/order/00000000-0000-4000-8000-0000000000c9/close')
        .set('Authorization', `Bearer ${adminToken}`)
      expect((close.body as ApiResponse<unknown>).code).toBe(0)
      expect(orders.find(order => order.id === '00000000-0000-4000-8000-0000000000c9')!.status).toBe('closed')

      const again = await request(server)
        .post('/api/subscription/order/00000000-0000-4000-8000-0000000000c9/close')
        .set('Authorization', `Bearer ${adminToken}`)
      expect((again.body as ApiResponse<unknown>).code).toBe(500200002)
    })
  })

  describe('订阅实例列表（过期打标，S2）', () => {
    it('永久实例应打标 active 且 permanent，过期实例应打标 expired', async () => {
      subscriptions.push({
        id: '00000000-0000-4000-8000-0000000000d1',
        memberId: '00000000-0000-4000-8000-0000000000b9',
        appId: APP_ID,
        planId: yearlyPlanId,
        startAt: new Date('2026-01-01T00:00:00Z'),
        expireAt: new Date('2026-06-01T00:00:00Z'),
        lastRenewAt: null,
      })
      const res = await request(server)
        .get('/api/subscription/sub').set('Authorization', `Bearer ${adminToken}`)
        .query({ state: 'expired' })
      const body = res.body as ApiResponse<{ list: { state: string, permanent: boolean, memberNickname: string }[], total: number }>
      expect(body.code).toBe(0)
      expect(body.data!.total).toBe(1)
      expect(body.data!.list[0].state).toBe('expired')
      expect(body.data!.list[0].permanent).toBe(false)

      const active = await request(server)
        .get('/api/subscription/sub').set('Authorization', `Bearer ${adminToken}`)
        .query({ memberId: MEMBER_ID })
      const activeBody = active.body as ApiResponse<{ list: { state: string, permanent: boolean }[], total: number }>
      expect(activeBody.data!.list[0].state).toBe('active')
      expect(activeBody.data!.list[0].permanent).toBe(true)
    })
  })
})
