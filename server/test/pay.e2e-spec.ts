import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import type { Server } from 'node:http'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { dataSourceStub } from './support/data-source-stub'
import { E2E_SIGN_SECRET, signHeaders } from './support/signature.helper'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import { AppEntity } from '../src/modules/appcenter/entities/app.entity'
import { MemberCredentialEntity } from '../src/modules/member/entities/member-credential.entity'
import { MemberLoginLockEntity } from '../src/modules/member/entities/member-login-lock.entity'
import { MemberLoginLogEntity } from '../src/modules/member/entities/member-login-log.entity'
import { MemberRefreshTokenEntity } from '../src/modules/member/entities/member-refresh-token.entity'
import { MemberEntity } from '../src/modules/member/entities/member.entity'
import { OrderEntity } from '../src/modules/subscription/entities/order.entity'
import { SubPlanEntity } from '../src/modules/subscription/entities/sub-plan.entity'
import { SubscriptionEntity } from '../src/modules/subscription/entities/subscription.entity'

// 开启签名验证：下单 / 轮询挂 app 签名方案 + MemberAuthGuard，全链路真实验签与令牌校验
process.env.SIGNATURE_ENABLED = 'true'
process.env.SIGNATURE_SECRET = E2E_SIGN_SECRET
process.env.JWT_SECRET = 'e2e-jwt-secret'
process.env.MEMBER_JWT_SECRET = 'e2e-member-jwt-secret'

// ===== 固定测试数据 =====

const APP_KEY = 'ah_paysub00000001'
const APP_SECRET = 'pay-app-secret'

const apps: Partial<AppEntity>[] = [
  { id: '00000000-0000-4000-8000-0000000000a1', appKey: APP_KEY, appSecret: APP_SECRET, name: '支付链路应用', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'enabled' },
]
const APP_ID = apps[0].id!
const PLAN_ID = '00000000-0000-4000-8000-0000000000b1'

const plans: Partial<SubPlanEntity>[] = [
  { id: PLAN_ID, appId: APP_ID, name: '专业版 · 年付', periodType: 'yearly', durationMonths: 12, price: 99000, originalPrice: null, status: 'on', sort: 1, remark: null },
]

/** 行匹配 where 等值条件 */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where)
    return true
  return Object.entries(where).every(([key, value]) => row[key] === value)
}

/** 可写内存仓储（会员注册链路触达的方法集） */
function makeWritableRepo<T>(initial: Record<string, unknown>[] = []) {
  const rows = initial
  let seq = 0
  return {
    rows,
    findOne: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve((rows.find(row => matches(row, options.where)) ?? null) as T | null),
    find: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(row => matches(row, options.where)) as T[]),
    insert: (entity: Record<string, unknown>) => {
      entity.id ??= `gen-pay-${++seq}`
      rows.push(entity)
      return Promise.resolve()
    },
    save: (entity: Record<string, unknown>) => {
      const existing = rows.find(row => row.id === entity.id)
      if (existing) {
        Object.assign(existing, entity)
        return Promise.resolve(existing as T)
      }
      // 镜像 TypeORM save 回填主键行为（注册链路依赖 member.id 回填后签发令牌）
      entity.id ??= `gen-pay-${++seq}`
      rows.push(entity)
      return Promise.resolve(entity as T)
    },
    update: (whereOrId: Record<string, unknown> | string, changes: Record<string, unknown>) => {
      const where = typeof whereOrId === 'string' ? { id: whereOrId } : whereOrId
      let affected = 0
      for (const row of rows) {
        if (matches(row, where)) {
          Object.assign(row, changes)
          affected++
        }
      }
      return Promise.resolve({ affected, raw: [], generatedMaps: [] })
    },
  }
}

/** 订单内存仓储：insert 时补 id / createTime（模拟 DB 默认值，轮询冷启动窗依赖 createTime） */
const orderRows: Record<string, unknown>[] = []
let orderSeq = 0
const orderRepo = {
  findOne: (options: { where?: Record<string, unknown> }) =>
    Promise.resolve(orderRows.find(row => matches(row, options.where)) ?? null) as Promise<OrderEntity | null>,
  find: (options: { where?: Record<string, unknown> }) =>
    Promise.resolve(orderRows.filter(row => matches(row, options.where))) as unknown as Promise<OrderEntity[]>,
  insert: (entity: Record<string, unknown>) => {
    entity.id ??= `gen-order-${++orderSeq}`
    entity.createTime ??= new Date()
    orderRows.push(entity)
    return Promise.resolve()
  },
  update: (where: Record<string, unknown>, changes: Record<string, unknown>) => {
    let affected = 0
    for (const row of orderRows) {
      if (matches(row, where)) {
        Object.assign(row, changes)
        affected++
      }
    }
    return Promise.resolve({ affected, raw: [], generatedMaps: [] })
  },
}

const subscriptionRows: Record<string, unknown>[] = []
const subscriptionRepo = makeWritableRepo<SubscriptionEntity>(subscriptionRows)
const memberRepo = makeWritableRepo<MemberEntity>()
const credentialRepo = makeWritableRepo<MemberCredentialEntity>()

// 事务桩双形态合并：注册链路 manager.save(entityCls, entity) 按实体类分桶；markPaid 链路 manager.getRepository 分流
const payDataSource = {
  ...dataSourceStub,
  transaction: <T>(run: (manager: unknown) => Promise<T>) =>
    run({
      save: (entityCls: unknown, entity: Record<string, unknown>) =>
        entityCls === MemberEntity ? memberRepo.save(entity) : credentialRepo.save(entity),
      getRepository: (entity: { name?: string }) =>
        entity.name === 'SubscriptionEntity' ? subscriptionRepo : orderRepo,
    }),
}

interface TokenPairBody {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

describe('在线支付 Mock 渠道全链路 (e2e)', () => {
  let app: INestApplication
  let server: Server
  let tokenA = ''
  let tokenB = ''
  let orderNoWechat = ''

  /** 应用签名 + 会员令牌的 POST 请求（开放下单 / 轮询） */
  const memberPost = (path: string, body: unknown, accessToken: string) => {
    const json = JSON.stringify(body)
    return request(server)
      .post(path)
      .set('x-app-key', APP_KEY)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .set(signHeaders('POST', path, json, { secret: APP_SECRET }))
      .send(json)
  }

  /** 应用签名 POST（注册：无会员令牌） */
  const register = (identifier: string) => {
    const path = '/api/open/member/auth/register'
    const json = JSON.stringify({ type: 'password', identifier, credential: 'pass1234' })
    return request(server)
      .post(path)
      .set('x-app-key', APP_KEY)
      .set('Content-Type', 'application/json')
      .set(signHeaders('POST', path, json, { secret: APP_SECRET }))
      .send(json)
  }

  const introspect = (accessToken: string) => {
    const path = '/api/open/member/token/introspect'
    return request(server)
      .get(path)
      .set('x-app-key', APP_KEY)
      .set('Authorization', `Bearer ${accessToken}`)
      .set(signHeaders('GET', path, '', { secret: APP_SECRET }))
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(payDataSource)
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue({
        findOne: (options: { where?: Record<string, unknown> }) =>
          Promise.resolve(apps.find(a => matches(a as Record<string, unknown>, options.where)) as AppEntity | null ?? null),
      })
      .overrideProvider(getRepositoryToken(SubPlanEntity))
      .useValue({
        findOne: (options: { where?: Record<string, unknown> }) =>
          Promise.resolve(plans.find(p => matches(p as Record<string, unknown>, options.where)) as SubPlanEntity | null ?? null),
        find: (options: { where?: Record<string, unknown> }) =>
          Promise.resolve(plans.filter(p => matches(p as Record<string, unknown>, options.where)) as SubPlanEntity[]),
      })
      .overrideProvider(getRepositoryToken(OrderEntity))
      .useValue(orderRepo)
      .overrideProvider(getRepositoryToken(SubscriptionEntity))
      .useValue(subscriptionRepo)
      .overrideProvider(getRepositoryToken(MemberEntity))
      .useValue(memberRepo)
      .overrideProvider(getRepositoryToken(MemberCredentialEntity))
      .useValue(credentialRepo)
      .overrideProvider(getRepositoryToken(MemberRefreshTokenEntity))
      .useValue(makeWritableRepo<MemberRefreshTokenEntity>())
      .overrideProvider(getRepositoryToken(MemberLoginLockEntity))
      .useValue(makeWritableRepo<MemberLoginLockEntity>())
      .overrideProvider(getRepositoryToken(MemberLoginLogEntity))
      .useValue({ insert: () => Promise.resolve() })
      .compile()

    app = moduleFixture.createNestApplication({ rawBody: true })
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.init()
    server = app.getHttpServer() as Server

    // 会员 A（下单主体）与会员 B（越权验证）
    const resA = await register('payuser01').expect(200)
    tokenA = (resA.body as ApiResponse<TokenPairBody>).data!.accessToken
    const resB = await register('payuser02').expect(200)
    tokenB = (resB.body as ApiResponse<TokenPairBody>).data!.accessToken
  })

  afterAll(async () => {
    await app.close()
  })

  it('微信渠道下单：Mock 装配返回 mock:// 二维码串与计划价快照（P4 / PY7）', async () => {
    const res = await memberPost('/api/open/subscription/order/create', { planId: PLAN_ID, channel: 'wechat' }, tokenA).expect(200)
    const data = (res.body as ApiResponse<{ orderNo: string, amount: number, qrCodeUrl: string, expireAt: string }>).data!
    expect(data.orderNo).toMatch(/^AH\d{12}[A-HJ-NP-Z2-9]{6}$/)
    expect(data.amount).toBe(99000)
    expect(data.qrCodeUrl).toBe(`mock://pay/${data.orderNo}`)
    expect(typeof data.expireAt).toBe('string')
    orderNoWechat = data.orderNo
  })

  it('支付宝渠道下单：同样走 Mock 装配（两渠道独立装配位）', async () => {
    const res = await memberPost('/api/open/subscription/order/create', { planId: PLAN_ID, channel: 'alipay' }, tokenA).expect(200)
    const data = (res.body as ApiResponse<{ orderNo: string, qrCodeUrl: string }>).data!
    expect(data.qrCodeUrl).toMatch(/^mock:\/\/pay\/AH/)
  })

  it('无会员令牌下单应 401（MemberAuthGuard 用户态）', async () => {
    const path = '/api/open/subscription/order/create'
    const json = JSON.stringify({ planId: PLAN_ID, channel: 'wechat' })
    const res = await request(server)
      .post(path)
      .set('x-app-key', APP_KEY)
      .set('Content-Type', 'application/json')
      .set(signHeaders('POST', path, json, { secret: APP_SECRET }))
      .send(json)
    expect(res.status).toBe(401)
  })

  it('轮询应返回 pending（刚创建处于 10s 冷启动窗，不触发渠道查单）', async () => {
    const res = await memberPost('/api/open/subscription/order/query', { orderNo: orderNoWechat }, tokenA).expect(200)
    const data = (res.body as ApiResponse<{ status: string }>).data!
    expect(data.status).toBe('pending')
  })

  it('Mock 支付触发端点应受理转 paid（P8：markPaid 同一幂等逻辑）', async () => {
    const res = await request(server)
      .post('/api/pay/mock/settle')
      .send({ orderNo: orderNoWechat })
      .expect(200)
    const data = (res.body as ApiResponse<{ result: string }>).data!
    expect(data.result).toBe('applied')
    // 订阅实例已顺延（年付）
    expect(subscriptionRows.length).toBeGreaterThanOrEqual(1)
  })

  it('支付后再轮询应返回 paid 与支付时刻', async () => {
    const res = await memberPost('/api/open/subscription/order/query', { orderNo: orderNoWechat }, tokenA).expect(200)
    const data = (res.body as ApiResponse<{ status: string, paidAt: string | null }>).data!
    expect(data.status).toBe('paid')
    expect(typeof data.paidAt).toBe('string')
  })

  it('重复 Mock 结算应幂等 duplicate（不重复顺延）', async () => {
    const res = await request(server)
      .post('/api/pay/mock/settle')
      .send({ orderNo: orderNoWechat })
      .expect(200)
    const data = (res.body as ApiResponse<{ result: string }>).data!
    expect(data.result).toBe('duplicate')
    expect(subscriptionRows).toHaveLength(1)
  })

  it('introspect 应反映支付后的订阅真值（paid → 订阅生效秒级到账）', async () => {
    const res = await introspect(tokenA).expect(200)
    const data = (res.body as ApiResponse<{ subscription: { subscribed: boolean, periodType?: string } }>).data!
    expect(data.subscription.subscribed).toBe(true)
    expect(data.subscription.periodType).toBe('yearly')
  })

  it('跨会员轮询他人订单按不存在处理（PY2 防枚举）', async () => {
    const res = await memberPost('/api/open/subscription/order/query', { orderNo: orderNoWechat }, tokenB).expect(400)
    expect((res.body as ApiResponse<unknown>).code).toBe(500200001)
  })

  it('支付宝回调在非真实渠道装配下应答 failure 文本（裸响应，非统一包装）', async () => {
    const res = await request(server)
      .post('/api/pay/callback/alipay')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('out_trade_no=AH1&trade_status=TRADE_SUCCESS&total_amount=99.00')
    expect(res.status).toBe(200)
    expect(res.text).toBe('failure')
  })

  it('微信回调空 body 应 500 FAIL JSON（裸响应）', async () => {
    const res = await request(server).post('/api/pay/callback/wechat').send('')
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ code: 'FAIL' })
  })
})
