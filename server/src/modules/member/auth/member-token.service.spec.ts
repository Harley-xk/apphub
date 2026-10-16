import { describe, expect, it, jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { REFRESH_STATUS } from '../member.constants'
import { MemberTokenService } from './member-token.service'

/** member 域真实 JwtService 实例（独立密钥域往返验签契约） */
const memberJwt = new JwtService({ secret: 'member-test-secret', signOptions: { expiresIn: 3600 } })
const configValues: Record<string, number> = { 'member.accessExpiresHours': 8, 'member.refreshExpiresDays': 30 }
const configService = { get: jest.fn((path: string) => configValues[path]) } as unknown as ConfigService

function makeService() {
  const rows = new Map<string, { id: string, memberId: string, appId: string, tokenHash: string, status: string, expiresAt: Date, createdIp: string | null, createdAt: Date }>()
  let seq = 0
  const refreshTokenRepository = {
    insert: jest.fn((entity: { memberId: string, appId: string, tokenHash: string, status: string, expiresAt: Date, createdIp: string | null, createdAt: Date }) => {
      rows.set(entity.tokenHash, {
        id: `refresh-${++seq}`,
        memberId: entity.memberId,
        appId: entity.appId,
        tokenHash: entity.tokenHash,
        status: entity.status,
        expiresAt: entity.expiresAt,
        createdIp: entity.createdIp,
        createdAt: entity.createdAt,
      })
    }),
    update: jest.fn((where: { tokenHash?: string, id?: string, memberId?: string, status?: string }, changes: Record<string, unknown>) => {
      let affected = 0
      for (const row of rows.values()) {
        const match = (where.tokenHash === undefined || where.tokenHash === row.tokenHash)
          && (where.id === undefined || where.id === row.id)
          && (where.memberId === undefined || where.memberId === row.memberId)
          && (where.status === undefined || where.status === row.status)
        if (match) {
          Object.assign(row, changes)
          affected++
        }
      }
      return Promise.resolve({ affected, raw: [], generatedMaps: [] })
    }),
    findOne: jest.fn(({ where }: { where: { tokenHash: string } }) => rows.get(where.tokenHash) ?? null),
  }
  const service = new MemberTokenService(
    refreshTokenRepository as never,
    memberJwt,
    configService,
  )
  return { service, rows }
}

describe('MemberTokenService access token', () => {
  it('签发与验签应往返一致（声明 sub + appKey，独立密钥域）', async () => {
    const { service } = makeService()
    const token = await service.signAccessToken('member-1', 'ah_app000000000001')
    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      sub: 'member-1',
      appKey: 'ah_app000000000001',
    })
  })

  it('system 域密钥签发的令牌应验签失败（两套信任域互不可串）', async () => {
    const { service } = makeService()
    const systemToken = new JwtService({ secret: 'system-secret' }).sign({ sub: 'member-1', appKey: 'ah_app000000000001' })
    await expect(service.verifyAccessToken(systemToken)).rejects.toThrow()
  })

  it('声明缺失（无 sub / appKey）应抛错（防畸形令牌进入业务链路）', async () => {
    const { service } = makeService()
    const malformed = await memberJwt.signAsync({ foo: 'bar' } as never)
    await expect(service.verifyAccessToken(malformed)).rejects.toThrow('声明缺失')
  })
})

describe('MemberTokenService refresh token', () => {
  it('生成的 refresh 应为 64 位 hex，库存 SHA-256 而非原文', () => {
    const { service } = makeService()
    const { token, hash } = service.generateRefreshToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toBe(token)
    expect(service.hashRefreshToken(token)).toBe(hash)
  })

  it('issueTokenPair 应落库并返回原文与有效期（28800 秒 = 8h）', async () => {
    const { service, rows } = makeService()
    const pair = await service.issueTokenPair('member-1', 'app-1', 'ah_app000000000001', '127.0.0.1')
    expect(pair.refreshToken).toMatch(/^[0-9a-f]{64}$/)
    expect(pair.expiresIn).toBe(28800)
    const row = rows.get(service.hashRefreshToken(pair.refreshToken))
    expect(row).toMatchObject({ memberId: 'member-1', appId: 'app-1', status: REFRESH_STATUS.ACTIVE, createdIp: '127.0.0.1' })
  })

  it('revokeByHashIfActive 并发语义：首个吊销成功，其后失败', async () => {
    const { service } = makeService()
    const pair = await service.issueTokenPair('member-1', 'app-1', 'ah_app000000000001', null)
    const row = (await service.findActiveByHash(service.hashRefreshToken(pair.refreshToken)))!
    await expect(service.revokeByHashIfActive(row)).resolves.toBe(true)
    await expect(service.revokeByHashIfActive(row)).resolves.toBe(false)
  })

  it('findActiveByHash 应排除已吊销与已过期行', async () => {
    const { service } = makeService()
    const pair = await service.issueTokenPair('member-1', 'app-1', 'ah_app000000000001', null)
    const hash = service.hashRefreshToken(pair.refreshToken)
    await service.revokeByHash(hash)
    await expect(service.findActiveByHash(hash)).resolves.toBeNull()

    // 重新签发一行并人工过期
    const pair2 = await service.issueTokenPair('member-1', 'app-1', 'ah_app000000000001', null)
    const row2 = (await service.findActiveByHash(service.hashRefreshToken(pair2.refreshToken)))!
    row2.expiresAt = new Date(Date.now() - 1000)
    await expect(service.findActiveByHash(row2.tokenHash)).resolves.toBeNull()
  })

  it('revokeAllForMember 应吊销该会员全部 active 行', async () => {
    const { service, rows } = makeService()
    await service.issueTokenPair('member-1', 'app-1', 'ah_app000000000001', null)
    await service.issueTokenPair('member-1', 'app-2', 'ah_app000000000002', null)
    await service.issueTokenPair('member-2', 'app-1', 'ah_app000000000001', null)
    await service.revokeAllForMember('member-1')
    const activeOfMember1 = [...rows.values()].filter(row => row.memberId === 'member-1' && row.status === REFRESH_STATUS.ACTIVE)
    expect(activeOfMember1).toHaveLength(0)
    const member2StillActive = [...rows.values()].filter(row => row.memberId === 'member-2' && row.status === REFRESH_STATUS.ACTIVE)
    expect(member2StillActive).toHaveLength(1)
  })
})
