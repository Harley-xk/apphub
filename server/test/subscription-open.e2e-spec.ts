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
import { SubPlanEntity } from '../src/modules/subscription/entities/sub-plan.entity'

// 开启签名验证：plans 端点挂 app 签名方案（@UseSignature('app')，主张 S9），全链路真实验签
process.env.SIGNATURE_ENABLED = 'true'
process.env.SIGNATURE_SECRET = E2E_SIGN_SECRET
process.env.JWT_SECRET = 'e2e-jwt-secret'

// ===== 固定测试数据 =====

const APP_KEY = 'ah_subopen00000001'
const APP_DISABLED_KEY = 'ah_suboff00000001'
const APP_SECRET = 'sub-open-app-secret'

const apps: Partial<AppEntity>[] = [
  { id: '00000000-0000-4000-8000-00000000f0a1', appKey: APP_KEY, appSecret: APP_SECRET, name: '订阅开放链路应用', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'enabled' },
  { id: '00000000-0000-4000-8000-00000000f0a2', appKey: APP_DISABLED_KEY, appSecret: 'sub-off-secret', name: '停用应用', appType: ['desktop'], clientType: 'confidential', framework: 'custom', status: 'disabled' },
]
const APP_ID = apps[0].id!

const plans: Partial<SubPlanEntity>[] = [
  { id: '00000000-0000-4000-8000-00000000f0p1', appId: APP_ID, name: '专业版 · 年付', periodType: 'yearly', durationMonths: 12, price: 99000, originalPrice: 180000, status: 'on', sort: 1, remark: '主力档位' },
  { id: '00000000-0000-4000-8000-00000000f0p2', appId: APP_ID, name: '专业版 · 月付', periodType: 'monthly', durationMonths: 1, price: 1500, originalPrice: null, status: 'on', sort: 2, remark: null },
  { id: '00000000-0000-4000-8000-00000000f0p3', appId: APP_ID, name: '永久买断', periodType: 'permanent', durationMonths: null, price: 199000, originalPrice: null, status: 'on', sort: 3, remark: null },
  { id: '00000000-0000-4000-8000-00000000f0p4', appId: APP_ID, name: '已下架档', periodType: 'quarterly', durationMonths: 3, price: 39900, originalPrice: null, status: 'off', sort: 0, remark: null },
]

function matches(row: unknown, where: Record<string, unknown> | undefined): boolean {
  if (!where)
    return true
  const record = row as Record<string, unknown>
  return Object.entries(where).every(([key, value]) => record[key] === value)
}

describe('SubscriptionModule 开放端点 (e2e)', () => {
  let app: INestApplication
  let server: Server

  /** 应用签名 GET 请求（X-App-Key 头 + 应用密钥签名） */
  const plansRequest = (appKey: string, secret: string, path = '/api/open/subscription/plans') =>
    request(server)
      .get(path)
      .set('x-app-key', appKey)
      .set(signHeaders('GET', path, '', { secret }))

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(dataSourceStub)
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue({
        findOne: (options: { where?: Record<string, unknown> }) =>
          Promise.resolve(apps.find(a => matches(a, options.where)) ?? null),
        find: () => Promise.resolve(apps),
      })
      .overrideProvider(getRepositoryToken(SubPlanEntity))
      .useValue({
        find: ({ where }: { where?: Record<string, unknown> }) =>
          Promise.resolve(plans.filter(plan => matches(plan, where)) as SubPlanEntity[]),
      })
      .compile()

    app = moduleFixture.createNestApplication({ rawBody: true })
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.init()
    server = app.getHttpServer() as Server
  })

  afterAll(async () => {
    await app.close()
  })

  it('应用密钥签名应获取在售计划清单（按 sort 升序，过滤下架档，主张 S9 免 access token）', async () => {
    const res = await plansRequest(APP_KEY, APP_SECRET).expect(200)
    const data = (res.body as ApiResponse<{ name: string, price: number, periodType: string }[]>).data!
    expect(data.map(item => item.name)).toEqual(['专业版 · 年付', '专业版 · 月付', '永久买断'])
    expect(data.every(item => item.name !== '已下架档')).toBe(true)
    expect(data[0].price).toBe(99000)
  })

  it('无签名的请求应被拒绝（401 签名层）', async () => {
    const res = await request(server).get('/api/open/subscription/plans').set('x-app-key', APP_KEY)
    expect(res.status).toBe(401)
  })

  it('错误密钥签名应被拒绝（常量时间比对失败）', async () => {
    const res = await plansRequest(APP_KEY, 'wrong-secret')
    expect(res.status).toBe(401)
  })

  it('停用应用应在签名密钥源层被拒（AppSecretRegistry 停用返回 null → 401，主张 I2 同构）', async () => {
    const res = await plansRequest(APP_DISABLED_KEY, 'sub-off-secret')
    expect(res.status).toBe(401)
  })
})
