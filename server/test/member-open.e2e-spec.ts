import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import type { Server } from 'node:http'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { dataSourceStub } from './support/data-source-stub'
import { signHeaders } from './support/signature.helper'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import { AppEntity } from '../src/modules/appcenter/entities/app.entity'
import { MemberCredentialEntity } from '../src/modules/member/entities/member-credential.entity'
import { MemberLoginLockEntity } from '../src/modules/member/entities/member-login-lock.entity'
import { MemberLoginLogEntity } from '../src/modules/member/entities/member-login-log.entity'
import { MemberRefreshTokenEntity } from '../src/modules/member/entities/member-refresh-token.entity'
import { MemberEntity } from '../src/modules/member/entities/member.entity'

// 开启签名验证：member 开放 API 挂 app 签名方案（@UseSignature('app')），全链路真实验签。
// 全局标准密钥同时启用，用于验证「全局密钥签的请求不能过应用方案」（两套密钥域互不可串）
process.env.SIGNATURE_ENABLED = 'true'
process.env.SIGNATURE_SECRET = 'e2e-sign-secret'
process.env.JWT_SECRET = 'e2e-jwt-secret'

// ===== 固定测试数据 =====

const APP_A_KEY = 'ah_membera00000001'
const APP_B_KEY = 'ah_memberb00000001'
const APP_LOCK_KEY = 'ah_memberlock000001'
const APP_DISABLED_KEY = 'ah_memberoff0000001'
const APP_A_SECRET = 'member-app-a-secret'
const APP_B_SECRET = 'member-app-b-secret'
const APP_LOCK_SECRET = 'member-app-lock-secret'

const apps: Partial<AppEntity>[] = [
  { id: '00000000-0000-4000-8000-00000000m0a1', appKey: APP_A_KEY, appSecret: APP_A_SECRET, name: '会员链路应用 A', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'enabled' },
  { id: '00000000-0000-4000-8000-00000000m0b1', appKey: APP_B_KEY, appSecret: APP_B_SECRET, name: '会员链路应用 B', appType: ['desktop'], clientType: 'confidential', framework: 'tauri', status: 'enabled' },
  { id: '00000000-0000-4000-8000-00000000m0c1', appKey: APP_LOCK_KEY, appSecret: APP_LOCK_SECRET, name: '防爆破验证应用', appType: ['desktop'], clientType: 'confidential', framework: 'custom', status: 'enabled' },
  { id: '00000000-0000-4000-8000-00000000m0d1', appKey: APP_DISABLED_KEY, appSecret: 'member-app-off-secret', name: '已停用应用', appType: ['desktop'], clientType: 'confidential', framework: 'custom', status: 'disabled' },
]

/** 行匹配 where 等值条件 */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where)
    return true
  return Object.entries(where).every(([key, value]) => row[key] === value)
}

/** 可写内存仓储：覆盖开放认证链路触达的全部仓储方法（insert / update 返回 affected 供轮换抢占判断） */
function makeWritableRepo<T>(initial: T[] = []) {
  const rows = initial as Record<string, unknown>[]
  let seq = 0
  const assignId = (entity: Record<string, unknown>) => {
    entity.id ??= `gen-member-${++seq}`
    return entity
  }
  return {
    rows,
    findOne: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve((rows.find(row => matches(row, options.where)) ?? null) as T | null),
    find: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(row => matches(row, options.where)) as T[]),
    insert: (entity: Record<string, unknown>) => {
      rows.push(assignId(entity))
      return Promise.resolve()
    },
    save: (entity: Record<string, unknown>) => {
      const existing = rows.find(row => row.id === entity.id)
      if (existing) {
        Object.assign(existing, entity)
        return Promise.resolve(existing as T)
      }
      rows.push(assignId(entity))
      return Promise.resolve(entity as T)
    },
    update: (whereOrId: Record<string, unknown> | string, changes: Record<string, unknown>) => {
      // TypeORM update 首参可为字符串主键，归一为 where 对象再匹配
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
    delete: (where: Record<string, unknown>) => {
      for (let index = rows.length - 1; index >= 0; index--) {
        if (matches(rows[index], where))
          rows.splice(index, 1)
      }
      return Promise.resolve()
    },
    increment: (where: Record<string, unknown>, column: string, value: number) => {
      for (const row of rows) {
        if (matches(row, where))
          row[column] = Number(row[column] ?? 0) + value
      }
      return Promise.resolve()
    },
  }
}

/** 行匹配 + 只读 app 仓储（appcenter 密钥源 / 限流策略解析共用） */
function makeMemoryRepo<T>(rows: Partial<T>[]) {
  return {
    findOne: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve((rows.find(row => matches(row as Record<string, unknown>, options.where)) ?? null) as T | null),
  }
}

interface TokenPairBody {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

describe('MemberModule 开放 API (e2e)', () => {
  let app: INestApplication
  let server: Server
  let memberRepo: ReturnType<typeof makeWritableRepo<MemberEntity>>

  /** 应用级签名请求：X-App-Key 头 + 按应用密钥签（GET 空 body 同样入签，主张 I1） */
  const appSigned = (
    method: 'post' | 'get',
    path: string,
    bodyObj: Record<string, unknown> | null,
    appKey: string,
    secret: string,
    extraHeaders: Record<string, string> = {},
  ) => {
    const body = method === 'get' || bodyObj === null ? '' : JSON.stringify(bodyObj)
    const req = request(server)[method](path)
      .set('x-app-key', appKey)
      .set(signHeaders(method.toUpperCase(), path, body, { secret }))
      .set(extraHeaders)
    return body ? req.set('Content-Type', 'application/json').send(body) : req
  }

  const register = (appKey: string, secret: string, identifier: string, credential = 'pass1234') =>
    appSigned('post', '/api/open/member/auth/register', { type: 'password', identifier, credential }, appKey, secret)

  const login = (appKey: string, secret: string, identifier: string, credential = 'pass1234') =>
    appSigned('post', '/api/open/member/auth/login', { type: 'password', identifier, credential }, appKey, secret)

  const refresh = (appKey: string, secret: string, refreshToken: string) =>
    appSigned('post', '/api/open/member/auth/refresh', { refreshToken }, appKey, secret)

  const introspect = (appKey: string, secret: string, accessToken: string, appKeyHeader = appKey) =>
    appSigned('get', '/api/open/member/token/introspect', null, appKeyHeader, secret, { Authorization: `Bearer ${accessToken}` })

  beforeAll(async () => {
    memberRepo = makeWritableRepo<MemberEntity>()
    const credentialRepo = makeWritableRepo<MemberCredentialEntity>()
    const refreshRepo = makeWritableRepo<MemberRefreshTokenEntity>()
    const lockRepo = makeWritableRepo<MemberLoginLockEntity>()

    // register 走事务：manager.save 按实体类分桶写入内存仓储（镜像 TypeORM 回填主键行为）
    const memberDataSource = {
      ...dataSourceStub,
      transaction: (cb: (manager: unknown) => Promise<unknown>) => cb({
        save: (entityCls: unknown, entity: Record<string, unknown>) =>
          entityCls === MemberEntity ? memberRepo.save(entity) : credentialRepo.save(entity),
      }),
    }

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(memberDataSource)
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue(makeMemoryRepo<AppEntity>(apps))
      .overrideProvider(getRepositoryToken(MemberEntity))
      .useValue(memberRepo)
      .overrideProvider(getRepositoryToken(MemberCredentialEntity))
      .useValue(credentialRepo)
      .overrideProvider(getRepositoryToken(MemberRefreshTokenEntity))
      .useValue(refreshRepo)
      .overrideProvider(getRepositoryToken(MemberLoginLockEntity))
      .useValue(lockRepo)
      .overrideProvider(getRepositoryToken(MemberLoginLogEntity))
      .useValue({ insert: () => Promise.resolve() })
      .compile()

    // rawBody: true 与 main.ts 保持一致，是签名校验的前提
    app = moduleFixture.createNestApplication({ rawBody: true })
    // 复刻 main.ts 装配（e2e 不经 bootstrap，全局管道须手动补齐）
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.init()
    server = app.getHttpServer() as Server
  })

  afterAll(async () => {
    await app.close()
  })

  describe('应用签名方案（app scheme）', () => {
    it('应用密钥签名的请求放行（注册成功返回令牌对）', async () => {
      const res = await register(APP_A_KEY, APP_A_SECRET, 'e2euser01').expect(200)
      const data = (res.body as ApiResponse<TokenPairBody>).data!
      expect(data.accessToken.split('.')).toHaveLength(3)
      expect(data.refreshToken).toMatch(/^[0-9a-f]{64}$/)
      expect(data.expiresIn).toBe(28800)
    })

    it('全局标准密钥签的请求应拒绝（应用密钥域独立，401）', async () => {
      // 用 SIGNATURE_SECRET（全局方案密钥）签，但请求走 app 方案按应用密钥验
      const body = JSON.stringify({ type: 'password', identifier: 'e2euser01', credential: 'pass1234' })
      await request(server).post('/api/open/member/auth/login')
        .set('x-app-key', APP_A_KEY)
        .set('Content-Type', 'application/json')
        .set(signHeaders('POST', '/api/open/member/auth/login', body, { secret: process.env.SIGNATURE_SECRET! }))
        .send(body)
        .expect(401)
    })

    it('无签名头应拒绝（显式 @UseSignature 全方法验签）', async () => {
      await request(server).post('/api/open/member/auth/login')
        .set('x-app-key', APP_A_KEY)
        .send({ type: 'password', identifier: 'e2euser01', credential: 'pass1234' })
        .expect(401)
    })

    it('GET introspect 无签名头应拒绝（主张 I1：GET 也参与签名）', async () => {
      await request(server).get('/api/open/member/token/introspect')
        .set('x-app-key', APP_A_KEY)
        .set('Authorization', 'Bearer whatever')
        .expect(401)
    })

    it('无效 AppKey 应拒绝（401，不区分查无 / 停用）', async () => {
      await register('ah_memberxxx0000001', 'any-secret', 'e2euser02').expect(401)
    })

    it('停用应用的密钥源被掐断（401）', async () => {
      await login(APP_DISABLED_KEY, 'member-app-off-secret', 'e2euser01').expect(401)
    })
  })

  describe('注册与登录', () => {
    it('凭证标识重复应拒绝（400200002，含软删行防抢注语义）', async () => {
      const res = await register(APP_A_KEY, APP_A_SECRET, 'e2euser01').expect(400)
      expect((res.body as ApiResponse<unknown>).code).toBe(400200002)
    })

    it('不支持的凭证类型应拒绝（400200001，M2 仅 password）', async () => {
      const res = await appSigned('post', '/api/open/member/auth/register', { type: 'phone', identifier: '13812341234', credential: 'valid1234' }, APP_A_KEY, APP_A_SECRET).expect(400)
      expect((res.body as ApiResponse<unknown>).code).toBe(400200001)
    })

    it('登录成功返回令牌对', async () => {
      const res = await login(APP_A_KEY, APP_A_SECRET, 'e2euser01').expect(200)
      const data = (res.body as ApiResponse<TokenPairBody>).data!
      expect(data.accessToken.split('.')).toHaveLength(3)
      expect(data.refreshToken).toMatch(/^[0-9a-f]{64}$/)
    })

    it('凭证不存在与口令错误同码（400300001，防枚举）', async () => {
      const missing = await login(APP_A_KEY, APP_A_SECRET, 'nobody01').expect(400)
      expect((missing.body as ApiResponse<unknown>).code).toBe(400300001)
      const wrong = await login(APP_A_KEY, APP_A_SECRET, 'e2euser01', 'wrong999').expect(400)
      expect((wrong.body as ApiResponse<unknown>).code).toBe(400300001)
    })

    it('连续 5 次失败后锁定：正确口令也拒绝（4003002）', async () => {
      await register(APP_LOCK_KEY, APP_LOCK_SECRET, 'lockuser1')
      for (let index = 0; index < 5; index++)
        await login(APP_LOCK_KEY, APP_LOCK_SECRET, 'lockuser1', 'wrong999').expect(400)
      const res = await login(APP_LOCK_KEY, APP_LOCK_SECRET, 'lockuser1').expect(400)
      expect((res.body as ApiResponse<unknown>).code).toBe(400300002)
    })
  })

  describe('刷新轮换与令牌校验', () => {
    let accessToken: string
    let refreshToken: string

    it('刷新应返回新令牌对且旧 refresh 复用被拒（轮换语义，4003003）', async () => {
      const loginRes = await login(APP_A_KEY, APP_A_SECRET, 'e2euser01').expect(200)
      refreshToken = (loginRes.body as ApiResponse<TokenPairBody>).data!.refreshToken
      accessToken = (loginRes.body as ApiResponse<TokenPairBody>).data!.accessToken

      const refreshRes = await refresh(APP_A_KEY, APP_A_SECRET, refreshToken).expect(200)
      const data = (refreshRes.body as ApiResponse<TokenPairBody>).data!
      expect(data.refreshToken).not.toBe(refreshToken)

      const reuse = await refresh(APP_A_KEY, APP_A_SECRET, refreshToken).expect(400)
      expect((reuse.body as ApiResponse<unknown>).code).toBe(400300003)
      refreshToken = data.refreshToken
    })

    it('A 应用 refresh 携 B 应用签名调用应拒绝（4003004，D19）', async () => {
      const res = await refresh(APP_B_KEY, APP_B_SECRET, refreshToken).expect(400)
      expect((res.body as ApiResponse<unknown>).code).toBe(400300004)
    })

    it('introspect 返回会员身份与订阅占位（M2 固定 unsubscribed）', async () => {
      const res = await introspect(APP_A_KEY, APP_A_SECRET, accessToken).expect(200)
      const data = (res.body as ApiResponse<{
        member: { id: string, nickname: string, status: string }
        subscription: { subscribed: boolean, planName: null, expireAt: null }
      }>).data!
      expect(data.member.nickname).toMatch(/^用户[0-9a-f]{6}$|^e2e-昵称$/)
      expect(data.member.status).toBe('active')
      expect(data.subscription).toEqual({ subscribed: false, planName: null, expireAt: null })
    })

    it('access 携不一致 AppKey 头应拒绝（4003004）', async () => {
      // A 签发的 access，经 B 的签名与 AppKey 头调用（签名本身合法，令牌域不匹配）
      const res = await introspect(APP_B_KEY, APP_B_SECRET, accessToken).expect(401)
      expect((res.body as ApiResponse<unknown>).code).toBe(400300004)
    })

    it('伪造 access 应拒绝（4003005）', async () => {
      const res = await introspect(APP_A_KEY, APP_A_SECRET, 'not-a-jwt').expect(401)
      expect((res.body as ApiResponse<unknown>).code).toBe(400300005)
    })
  })

  describe('登出与绑定', () => {
    it('登出吊销 refresh（其后刷新 4003003），幂等重复登出 201', async () => {
      const loginRes = await login(APP_A_KEY, APP_A_SECRET, 'e2euser01').expect(200)
      const data = (loginRes.body as ApiResponse<TokenPairBody>).data!
      await appSigned('post', '/api/open/member/auth/logout', { refreshToken: data.refreshToken }, APP_A_KEY, APP_A_SECRET, { Authorization: `Bearer ${data.accessToken}` }).expect(200)
      await appSigned('post', '/api/open/member/auth/logout', { refreshToken: data.refreshToken }, APP_A_KEY, APP_A_SECRET, { Authorization: `Bearer ${data.accessToken}` }).expect(200)
      const reuse = await refresh(APP_A_KEY, APP_A_SECRET, data.refreshToken).expect(400)
      expect((reuse.body as ApiResponse<unknown>).code).toBe(400300003)
    })

    it('绑定新凭证后可用新凭证登录（绑定合并闭环）', async () => {
      const loginRes = await login(APP_A_KEY, APP_A_SECRET, 'e2euser01').expect(200)
      const data = (loginRes.body as ApiResponse<TokenPairBody>).data!
      const bindRes = await appSigned('post', '/api/open/member/auth/bind', { type: 'password', identifier: 'e2ebind01', credential: 'bind1234' }, APP_A_KEY, APP_A_SECRET, { Authorization: `Bearer ${data.accessToken}` }).expect(200)
      expect((bindRes.body as ApiResponse<{ result: string }>).data!.result).toBe('added')

      await login(APP_A_KEY, APP_A_SECRET, 'e2ebind01', 'bind1234').expect(200)
    })
  })

  describe('信任域隔离', () => {
    it('member access 调管理端接口应 401（两套 JWT 密钥域互不可串）', async () => {
      const loginRes = await login(APP_A_KEY, APP_A_SECRET, 'e2euser01').expect(200)
      const accessToken = (loginRes.body as ApiResponse<TokenPairBody>).data!.accessToken
      // 管理端 GET 免签名，但 system 域 JWT 验签必然失败
      await request(server).get('/api/member')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401)
    })

    it('会员分页列表应注册进路由（未认证 401 而非 404）', async () => {
      await request(server).get('/api/member').expect(401)
    })
  })
})
