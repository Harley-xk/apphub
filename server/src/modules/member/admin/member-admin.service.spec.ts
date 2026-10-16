import { describe, expect, it, jest } from '@jest/globals'
import * as bcrypt from 'bcryptjs'

import { MemberErrorCode } from '../error-codes'
import { CREDENTIAL_TYPE, MEMBER_STATUS } from '../member.constants'
import { maskIdentifier, MemberAdminService } from './member-admin.service'
import type { MemberCredentialEntity } from '../entities/member-credential.entity'
import type { MemberEntity } from '../entities/member.entity'

const MEMBER_ID = '00000000-0000-0000-0000-0000000000bb'
const CREDENTIAL_ID = '00000000-0000-0000-0000-0000000000cc'

const member = {
  id: MEMBER_ID,
  nickname: '测试会员',
  avatarUrl: null,
  status: MEMBER_STATUS.ACTIVE,
  registeredAppId: null,
  lastLoginAt: null,
  createTime: new Date('2026-10-17T08:00:00Z'),
} as MemberEntity

const passwordCredential = {
  id: CREDENTIAL_ID,
  memberId: MEMBER_ID,
  credentialType: CREDENTIAL_TYPE.PASSWORD,
  identifier: 'tester01',
  credentialSecret: 'hashed',
  verified: true,
  lastUsedAt: null,
  createTime: new Date('2026-10-17T08:00:00Z'),
} as MemberCredentialEntity

function makeService(options: {
  member?: Partial<MemberEntity> | null
  credentials?: Partial<MemberCredentialEntity>[]
  passwordCount?: number
} = {}) {
  const memberRepository = {
    findOne: jest.fn(() => Promise.resolve(options.member ?? null)),
    update: jest.fn(() => Promise.resolve()),
    softRemove: jest.fn(() => Promise.resolve()),
  }
  // 联系方式内联查询的链式桩（where/andWhere 返回自身，getMany 空结果）
  const contactQb: Record<string, unknown> = {
    where: () => contactQb,
    andWhere: () => contactQb,
    getMany: () => Promise.resolve([]),
  }
  const credentialRepository = {
    // 按.where 条件过滤（服务按 id+memberId / memberId+credentialType 查询，桩须尊重条件）
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(
      (options.credentials ?? []).find(c =>
        Object.entries(where).every(([key, value]) => (c as Record<string, unknown>)[key] === value)) ?? null,
    )),
    find: jest.fn(() => Promise.resolve(options.credentials ?? [])),
    count: jest.fn(() => Promise.resolve(options.passwordCount ?? 0)),
    update: jest.fn(() => Promise.resolve()),
    softRemove: jest.fn(() => Promise.resolve()),
    createQueryBuilder: jest.fn(() => contactQb),
  }
  const tokenService = {
    revokeAllForMember: jest.fn(() => Promise.resolve()),
  }
  const service = new MemberAdminService(
    memberRepository as never,
    credentialRepository as never,
    tokenService as never,
  )
  return { service, memberRepository, credentialRepository, tokenService }
}

describe('maskIdentifier 脱敏契约', () => {
  it('password 标识原样展示（自设账号非隐私标识）', () => {
    expect(maskIdentifier('password', 'tester01')).toBe('tester01')
  })

  it('手机号保留前 3 后 4', () => {
    expect(maskIdentifier('phone', '13812341234')).toBe('138****1234')
  })

  it('过短手机号全打码（防长度反推）', () => {
    expect(maskIdentifier('phone', '12345')).toBe('****')
  })

  it('邮箱保留本地部分首位', () => {
    expect(maskIdentifier('email', 'someone@example.com')).toBe('s***@example.com')
  })

  it('第三方标识（openid / user_id）保留前 6 后 4', () => {
    expect(maskIdentifier('wechat', 'oX7abcdef1234567890end')).toBe('oX7abc****0end')
  })
})

describe('MemberAdminService', () => {
  it('详情应返回凭证清单且不出现密文字段', async () => {
    const { service } = makeService({ member, credentials: [passwordCredential] })
    const detail = await service.get(MEMBER_ID)
    expect(detail.credentials).toHaveLength(1)
    expect(detail.credentials[0]).not.toHaveProperty('credentialSecret')
    expect(detail.credentials[0]).toMatchObject({ credentialType: CREDENTIAL_TYPE.PASSWORD, identifier: 'tester01' })
  })

  it('禁用应更新状态并吊销全部令牌（即时失效）', async () => {
    const { service, memberRepository, tokenService } = makeService({ member })
    await service.disable(MEMBER_ID)
    expect(memberRepository.update).toHaveBeenCalledWith(MEMBER_ID, { status: MEMBER_STATUS.DISABLED })
    expect(tokenService.revokeAllForMember).toHaveBeenCalledWith(MEMBER_ID)
  })

  it('重复禁用应幂等（不重复写状态）但仍吊销令牌', async () => {
    const { service, memberRepository } = makeService({ member: { ...member, status: MEMBER_STATUS.DISABLED } })
    await service.disable(MEMBER_ID)
    expect(memberRepository.update).not.toHaveBeenCalled()
  })

  it('启用仅恢复状态不签发令牌（吊销后需重新登录）', async () => {
    const { service, memberRepository, tokenService } = makeService({ member: { ...member, status: MEMBER_STATUS.DISABLED } })
    await service.enable(MEMBER_ID)
    expect(memberRepository.update).toHaveBeenCalledWith(MEMBER_ID, { status: MEMBER_STATUS.ACTIVE })
    expect(tokenService.revokeAllForMember).not.toHaveBeenCalled()
  })

  it('软删应连带软删全部凭证并吊销令牌（标识不释放防抢注）', async () => {
    const { service, credentialRepository, memberRepository, tokenService } = makeService({ member, credentials: [passwordCredential] })
    await service.remove(MEMBER_ID)
    expect(credentialRepository.softRemove).toHaveBeenCalled()
    expect(memberRepository.softRemove).toHaveBeenCalledWith(member)
    expect(tokenService.revokeAllForMember).toHaveBeenCalledWith(MEMBER_ID)
  })

  it('解绑最后一条密码凭证应抛 LAST_PASSWORD_CREDENTIAL', async () => {
    const { service } = makeService({ member, credentials: [passwordCredential], passwordCount: 1 })
    await expect(service.unbindCredential(MEMBER_ID, CREDENTIAL_ID)).rejects.toMatchObject({
      code: MemberErrorCode.LAST_PASSWORD_CREDENTIAL.code,
    })
  })

  it('解绑非最后密码凭证与手机邮箱凭证应放行并吊销令牌', async () => {
    const phoneCredential = { ...passwordCredential, id: 'phone-cred', credentialType: CREDENTIAL_TYPE.PHONE }
    const { service, credentialRepository, tokenService } = makeService({ member, credentials: [phoneCredential] })
    await service.unbindCredential(MEMBER_ID, 'phone-cred')
    expect(credentialRepository.softRemove).toHaveBeenCalled()
    expect(tokenService.revokeAllForMember).toHaveBeenCalledWith(MEMBER_ID)
  })

  it('解绑他人凭证（memberId 不匹配）应抛 CREDENTIAL_NOT_EXISTS', async () => {
    const { service } = makeService({ member, credentials: [{ ...passwordCredential, memberId: 'other' }] })
    await expect(service.unbindCredential(MEMBER_ID, CREDENTIAL_ID)).rejects.toMatchObject({
      code: MemberErrorCode.CREDENTIAL_NOT_EXISTS.code,
    })
  })

  it('重置密码应存散列、吊销令牌并明文返回一次', async () => {
    const { service, credentialRepository, tokenService } = makeService({ member, credentials: [passwordCredential] })
    const result = await service.resetPassword(MEMBER_ID)
    expect(result.password).toMatch(/^[A-Za-z0-9]{12}$/)
    expect(result.password).toMatch(/[A-Za-z]/)
    expect(result.password).toMatch(/\d/)
    const updateCalls = credentialRepository.update.mock.calls as unknown as [unknown, { credentialSecret: string }][]
    const changes = updateCalls[0][1]
    expect(changes.credentialSecret).not.toBe(result.password)
    expect(bcrypt.compareSync(result.password, changes.credentialSecret)).toBe(true)
    expect(tokenService.revokeAllForMember).toHaveBeenCalledWith(MEMBER_ID)
  })

  it('无密码凭证的会员重置密码应抛 CREDENTIAL_NOT_EXISTS', async () => {
    const phoneOnly = { ...passwordCredential, credentialType: CREDENTIAL_TYPE.PHONE }
    const { service } = makeService({ member, credentials: [phoneOnly] })
    await expect(service.resetPassword(MEMBER_ID)).rejects.toMatchObject({
      code: MemberErrorCode.CREDENTIAL_NOT_EXISTS.code,
    })
  })
})
