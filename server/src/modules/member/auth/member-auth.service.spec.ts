import { describe, expect, it, jest } from '@jest/globals'
import * as bcrypt from 'bcryptjs'

import type { ClientInfo } from '../../../common/utils/client-info'
import type { AppEntity } from '../../appcenter/entities/app.entity'
import { MemberCredentialEntity } from '../entities/member-credential.entity'
import { MemberEntity } from '../entities/member.entity'
import { MemberErrorCode } from '../error-codes'
import { CREDENTIAL_TYPE, MEMBER_STATUS } from '../member.constants'
import { MemberAuthService } from './member-auth.service'
import type { TokenPairVo } from './member-token.service'

const PASSWORD_HASH = bcrypt.hashSync('pass1234', 4)
const APP_ID = '00000000-0000-0000-0000-0000000000aa'
const MEMBER_ID = '00000000-0000-0000-0000-0000000000bb'
const APP_KEY = 'ah_test0000000001'

const app = { id: APP_ID, appKey: APP_KEY, status: 'enabled' } as AppEntity
const member = {
  id: MEMBER_ID,
  nickname: '测试会员',
  status: MEMBER_STATUS.ACTIVE,
} as MemberEntity
const credential = {
  id: '00000000-0000-0000-0000-0000000000cc',
  memberId: MEMBER_ID,
  credentialType: CREDENTIAL_TYPE.PASSWORD,
  identifier: 'tester01',
  credentialSecret: PASSWORD_HASH,
} as MemberCredentialEntity

const client: ClientInfo = { ip: '127.0.0.1', userAgent: 'jest-agent' }
const tokenPair: TokenPairVo = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 28800 }

/** 组装被测服务与全部边界桩 */
function makeService(options: {
  credential?: Partial<MemberCredentialEntity> | null
  member?: Partial<MemberEntity> | null
  app?: Partial<AppEntity> | null
  revokeSuccess?: boolean
}) {
  const saved: { members: unknown[], credentials: unknown[] } = { members: [], credentials: [] }
  const manager = {
    save: jest.fn((entityCls: unknown, entity: unknown) => {
      // 镜像 TypeORM manager.save 回填主键的行为（按实体类分桶捕获）
      const withId = { ...(entity as object), id: `saved-${saved.members.length + saved.credentials.length}` }
      if (entityCls === MemberEntity) {
        saved.members.push(withId)
        return withId
      }
      saved.credentials.push(withId)
      return withId
    }),
  }
  const dataSource = { transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)) }
  const memberRepository = { findOne: jest.fn(() => Promise.resolve(options.member ?? null)), update: jest.fn(() => Promise.resolve()) }
  const credentialRepository = {
    findOne: jest.fn(() => Promise.resolve(options.credential ?? null)),
    update: jest.fn(() => Promise.resolve()),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
  }
  const appRepository = { findOne: jest.fn(() => Promise.resolve(options.app ?? null)) }
  const tokenService = {
    issueTokenPair: jest.fn(() => Promise.resolve(tokenPair)),
    hashRefreshToken: jest.fn((token: string) => `hash-${token}`),
    findActiveByHash: jest.fn(() => Promise.resolve(null as unknown)),
    revokeByHash: jest.fn(() => Promise.resolve()),
    revokeByHashIfActive: jest.fn(() => Promise.resolve(options.revokeSuccess ?? true)),
    revokeAllForMember: jest.fn(() => Promise.resolve()),
  }
  const loginLockService = {
    getLockedUntil: jest.fn(() => Promise.resolve(null as unknown)),
    recordFailure: jest.fn(() => Promise.resolve()),
    recordSuccess: jest.fn(() => Promise.resolve()),
  }
  const loginLogService = { record: jest.fn() }
  // subscription 域订阅段桩（M3 起真值注入；单测固定未订阅形态）
  const subscriptionService = {
    getIntrospectSegment: jest.fn(() =>
      Promise.resolve({ subscribed: false, planName: null, periodType: null, expireAt: null })),
  }
  const service = new MemberAuthService(
    dataSource as never,
    memberRepository as never,
    credentialRepository as never,
    appRepository as never,
    tokenService as never,
    loginLockService as never,
    loginLogService as never,
    subscriptionService as never,
  )
  return { service, dataSource, memberRepository, credentialRepository, appRepository, tokenService, loginLockService, loginLogService, subscriptionService, saved }
}

const registerDto = { type: CREDENTIAL_TYPE.PASSWORD, identifier: 'newuser1', credential: 'pass1234' }
const loginDto = { type: CREDENTIAL_TYPE.PASSWORD, identifier: 'tester01', credential: 'pass1234' }

describe('MemberAuthService 注册', () => {
  it('注册成功应落会员与凭证（凭证存 bcrypt 散列）并返回令牌对', async () => {
    const { service, saved, tokenService } = makeService({ app })
    await expect(service.register(registerDto, APP_KEY, client)).resolves.toEqual(tokenPair)
    expect(saved.members).toHaveLength(1)
    expect(saved.credentials).toHaveLength(1)
    const savedCredential = saved.credentials[0] as MemberCredentialEntity
    expect(savedCredential.credentialSecret).not.toBe('pass1234')
    expect(bcrypt.compareSync('pass1234', savedCredential.credentialSecret!)).toBe(true)
    expect(tokenService.issueTokenPair).toHaveBeenCalledWith(
      expect.any(String), APP_ID, APP_KEY, client.ip,
    )
  })

  it('注册应带来源应用 id 与启用状态（首次注册来源统计）', async () => {
    const { service, saved } = makeService({ app })
    await service.register(registerDto, APP_KEY, client)
    expect(saved.members[0]).toMatchObject({ registeredAppId: APP_ID, status: MEMBER_STATUS.ACTIVE })
  })

  it('昵称未填应自动生成兜底（用户 + 随机 hex）', async () => {
    const { service, saved } = makeService({ app })
    await service.register(registerDto, APP_KEY, client)
    expect((saved.members[0] as MemberEntity).nickname).toMatch(/^用户[0-9a-f]{6}$/)
  })

  it('凭证标识已存在（含软删行）应抛 CREDENTIAL_IDENTIFIER_DUPLICATE', async () => {
    const { service } = makeService({ app, credential })
    await expect(service.register(registerDto, APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.CREDENTIAL_IDENTIFIER_DUPLICATE.code,
    })
  })

  it('不支持的凭证类型应抛 CREDENTIAL_TYPE_UNSUPPORTED（M2 仅 password）', async () => {
    const { service } = makeService({ app })
    await expect(
      service.register({ ...registerDto, type: CREDENTIAL_TYPE.PHONE }, APP_KEY, client),
    ).rejects.toMatchObject({ code: MemberErrorCode.CREDENTIAL_TYPE_UNSUPPORTED.code })
  })

  it('应用无效（查无 / 停用）应拒绝（防御性兜底，签名层已拦）', async () => {
    const missing = makeService({ app: null })
    await expect(missing.service.register(registerDto, APP_KEY, client)).rejects.toMatchObject({ code: 300100002 })
    const disabled = makeService({ app: { ...app, status: 'disabled' } })
    await expect(disabled.service.register(registerDto, APP_KEY, client)).rejects.toMatchObject({ code: 300100003 })
  })
})

describe('MemberAuthService 登录', () => {
  it('登录成功应清锁、回填最近登录并签发令牌对', async () => {
    const { service, memberRepository, credentialRepository, loginLockService } = makeService({ app, member, credential })
    await expect(service.login(loginDto, APP_KEY, client)).resolves.toEqual(tokenPair)
    expect(loginLockService.recordSuccess).toHaveBeenCalledWith(APP_KEY, CREDENTIAL_TYPE.PASSWORD, 'tester01')
    expect(memberRepository.update).toHaveBeenCalledWith(MEMBER_ID, expect.objectContaining({ lastLoginAt: expect.any(Date) }))
    expect(credentialRepository.update).toHaveBeenCalled()
  })

  it('锁定中应抛 LOGIN_LOCKED 且不计失败（锁定与计数解耦）', async () => {
    const { service, loginLockService } = makeService({ app, member, credential })
    loginLockService.getLockedUntil.mockResolvedValueOnce(new Date(Date.now() + 60_000))
    await expect(service.login(loginDto, APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.LOGIN_LOCKED.code,
    })
    expect(loginLockService.recordFailure).not.toHaveBeenCalled()
  })

  it('凭证不存在与口令错误应抛同一错误码且都计失败（防枚举契约）', async () => {
    const noCredential = makeService({ app, credential: null })
    await expect(noCredential.service.login(loginDto, APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.LOGIN_FAILED.code,
    })
    expect(noCredential.loginLockService.recordFailure).toHaveBeenCalled()

    const wrong = makeService({ app, member, credential })
    await expect(wrong.service.login({ ...loginDto, credential: 'wrong999' }, APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.LOGIN_FAILED.code,
    })
    expect(wrong.loginLockService.recordFailure).toHaveBeenCalled()
  })

  it('会员软删（凭证在但会员不可见）应按统一失败文案拒绝', async () => {
    const { service } = makeService({ app, credential, member: null })
    await expect(service.login(loginDto, APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.LOGIN_FAILED.code,
    })
  })

  it('禁用会员应抛 MEMBER_DISABLED（口令正确场景给区分文案）', async () => {
    const { service } = makeService({ app, member: { ...member, status: MEMBER_STATUS.DISABLED }, credential })
    await expect(service.login(loginDto, APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.MEMBER_DISABLED.code,
    })
  })

  it('登录失败应埋登录日志（member id 可确定时回填）', async () => {
    const { service, loginLogService } = makeService({ app, member, credential })
    await expect(service.login({ ...loginDto, credential: 'wrong999' }, APP_KEY, client)).rejects.toThrow()
    expect(loginLogService.record).toHaveBeenCalledTimes(1)
    expect(loginLogService.record.mock.calls[0][0]).toMatchObject({
      memberId: MEMBER_ID,
      appKey: APP_KEY,
      resultCode: MemberErrorCode.LOGIN_FAILED.code,
    })
  })
})

describe('MemberAuthService 刷新与登出', () => {
  const refreshRow = {
    id: '00000000-0000-0000-0000-0000000000dd',
    memberId: MEMBER_ID,
    appId: APP_ID,
    tokenHash: 'hash-old-refresh',
    status: 'active',
    expiresAt: new Date(Date.now() + 86_400_000),
  }

  it('刷新成功应先吊销旧 refresh 再签发新令牌对（轮换语义）', async () => {
    const { service, tokenService } = makeService({ app, member })
    tokenService.findActiveByHash.mockResolvedValueOnce(refreshRow)
    await expect(service.refresh('old-refresh', APP_KEY, client)).resolves.toEqual(tokenPair)
    expect(tokenService.revokeByHashIfActive).toHaveBeenCalledWith(refreshRow)
    expect(tokenService.issueTokenPair).toHaveBeenCalledWith(MEMBER_ID, APP_ID, APP_KEY, client.ip)
  })

  it('无效 / 已吊销 / 过期 refresh 应抛 REFRESH_TOKEN_INVALID', async () => {
    const { service } = makeService({ app })
    await expect(service.refresh('gone-token', APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.REFRESH_TOKEN_INVALID.code,
    })
  })

  it('A 应用签发的 refresh 携 B 应用签名调用应抛 TOKEN_APP_MISMATCH（D19）', async () => {
    const { service, tokenService } = makeService({ app })
    const foreignRow = { ...refreshRow, appId: '00000000-0000-0000-0000-0000000000ee' }
    tokenService.findActiveByHash.mockResolvedValueOnce(foreignRow)
    await expect(service.refresh('old-refresh', APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.TOKEN_APP_MISMATCH.code,
    })
  })

  it('并发轮换竞态（条件吊销失败）应抛 REFRESH_TOKEN_INVALID', async () => {
    const { service, tokenService } = makeService({ app, member, revokeSuccess: false })
    tokenService.findActiveByHash.mockResolvedValueOnce(refreshRow)
    await expect(service.refresh('old-refresh', APP_KEY, client)).rejects.toMatchObject({
      code: MemberErrorCode.REFRESH_TOKEN_INVALID.code,
    })
    expect(tokenService.issueTokenPair).not.toHaveBeenCalled()
  })

  it('登出应吊销本人的 refresh（他会员令牌不可吊销）且幂等', async () => {
    const { service, tokenService } = makeService({ app, member })
    tokenService.findActiveByHash.mockResolvedValueOnce({ ...refreshRow, memberId: MEMBER_ID })
    await service.logout(MEMBER_ID, 'old-refresh', APP_KEY, client)
    expect(tokenService.revokeByHash).toHaveBeenCalledWith('hash-old-refresh')

    // 他会员的 refresh：不吊销但仍记登出日志
    tokenService.findActiveByHash.mockResolvedValueOnce({ ...refreshRow, memberId: 'other' })
    tokenService.revokeByHash.mockClear()
    await service.logout(MEMBER_ID, 'other-refresh', APP_KEY, client)
    expect(tokenService.revokeByHash).not.toHaveBeenCalled()
  })
})

describe('MemberAuthService 绑定与校验', () => {
  const bindDto = { type: CREDENTIAL_TYPE.PASSWORD, identifier: 'extra01', credential: 'pass1234' }

  it('新凭证应追加到当前会员（存散列）', async () => {
    const { service, credentialRepository } = makeService({ app, member, credential: null })
    await expect(service.bind(MEMBER_ID, bindDto)).resolves.toEqual({ result: 'added' })
    expect(credentialRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      memberId: MEMBER_ID,
      credentialType: CREDENTIAL_TYPE.PASSWORD,
      identifier: 'extra01',
    }))
  })

  it('已归属当前会员应幂等成功（不新建凭证）', async () => {
    const { service, credentialRepository } = makeService({ app, member, credential })
    await expect(service.bind(MEMBER_ID, { ...bindDto, identifier: 'tester01' })).resolves.toEqual({ result: 'existed' })
    expect(credentialRepository.save).not.toHaveBeenCalled()
  })

  it('已归属其他会员应抛 CREDENTIAL_OWNED_BY_OTHER（绑定合并拒绝）', async () => {
    const { service } = makeService({ app, member, credential: { ...credential, memberId: 'other-member' } })
    await expect(service.bind(MEMBER_ID, { ...bindDto, identifier: 'tester01' })).rejects.toMatchObject({
      code: MemberErrorCode.CREDENTIAL_OWNED_BY_OTHER.code,
    })
  })

  it('introspect 应返回会员身份并透传 subscription 域注入的订阅段（M3 真值，主张 I6/S10）', async () => {
    const { service, subscriptionService } = makeService({ app, member })
    await expect(service.introspect(MEMBER_ID, APP_KEY)).resolves.toEqual({
      member: { id: MEMBER_ID, nickname: '测试会员', avatarUrl: undefined, status: MEMBER_STATUS.ACTIVE },
      subscription: { subscribed: false, planName: null, periodType: null, expireAt: null },
    })
    expect(subscriptionService.getIntrospectSegment).toHaveBeenCalledWith(MEMBER_ID, APP_KEY)
  })

  it('getActiveMemberById 对禁用会员应返回 null（逐请求查库的即时失效语义）', async () => {
    const { service } = makeService({ app, member: { ...member, status: MEMBER_STATUS.DISABLED } })
    await expect(service.getActiveMemberById(MEMBER_ID)).resolves.toBeNull()
  })
})
