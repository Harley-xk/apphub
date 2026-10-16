/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员令牌服务：access JWT 签发验签（独立密钥域，D18/D19）+ refresh token 生成 / 哈希 / 吊销（统一认证设计 §2.3 主张 M1）
 */
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomBytes } from 'node:crypto'
import type { Repository } from 'typeorm'

import { MemberRefreshTokenEntity } from '../entities/member-refresh-token.entity'
import { REFRESH_STATUS } from '../member.constants'

/** member 域 JwtService 实例注入 token（与 system 域 global JwtService 隔离，两套信任域互不可串） */
export const MEMBER_JWT = Symbol('MEMBER_JWT')

/** access token 载荷声明（统一认证设计主张 M1：{ sub: memberId, appKey }） */
export interface MemberAccessPayload {
  sub: string
  appKey: string
}

/** 令牌对出参（注册 / 登录 / 刷新接口响应体） */
export interface TokenPairVo {
  accessToken: string
  refreshToken: string
  /** access token 有效期（秒），客户端据此排期刷新 */
  expiresIn: number
}

@Injectable()
export class MemberTokenService {
  constructor(
    @InjectRepository(MemberRefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<MemberRefreshTokenEntity>,
    @Inject(MEMBER_JWT) private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** 签发 access token：声明只放身份标识与绑定应用（角色权限概念在 member 域不存在） */
  async signAccessToken(memberId: string, appKey: string): Promise<string> {
    return this.jwtService.signAsync({ sub: memberId, appKey })
  }

  /** 验签 access token：验签失败 / 过期 / 声明缺失抛错，由 Guard 按 004003005 语义统一处理 */
  async verifyAccessToken(token: string): Promise<MemberAccessPayload> {
    const payload = await this.jwtService.verifyAsync<MemberAccessPayload>(token)
    if (!payload?.sub || !payload?.appKey)
      throw new Error('access token 声明缺失')
    return payload
  }

  /** 生成不透明 refresh token：32 字节随机数的 hex（64 字符），返回原文与 SHA-256（原文仅出服务一次） */
  generateRefreshToken(): { token: string, hash: string } {
    const token = randomBytes(32).toString('hex')
    return { token, hash: this.hashRefreshToken(token) }
  }

  /** refresh token 的 SHA-256（hex 64 字符，入库形态） */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex')
  }

  /** 签发令牌对：落 refresh 行 + 签 access token（有效期与 JwtService 实例配置同源，不漂移） */
  async issueTokenPair(
    memberId: string,
    appId: string,
    appKey: string,
    ip: string | null,
  ): Promise<TokenPairVo> {
    const { token, hash } = this.generateRefreshToken()
    const entity = new MemberRefreshTokenEntity()
    entity.memberId = memberId
    entity.appId = appId
    entity.tokenHash = hash
    entity.expiresAt = new Date(Date.now() + this.refreshTtlMs)
    entity.status = REFRESH_STATUS.ACTIVE
    entity.createdIp = ip
    entity.createdAt = new Date()
    await this.refreshTokenRepository.insert(entity)
    const accessToken = await this.signAccessToken(memberId, appKey)
    return { accessToken, refreshToken: token, expiresIn: this.accessTtlSeconds }
  }

  /** 按哈希吊销（登出定位单条；不存在的哈希静默——登出幂等） */
  async revokeByHash(tokenHash: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { tokenHash, status: REFRESH_STATUS.ACTIVE },
      { status: REFRESH_STATUS.REVOKED },
    )
  }

  /** 条件吊销（刷新轮换抢占）：仅当行仍为 active 时吊销，返回是否抢占成功（并发双请求仅首个 true） */
  async revokeByHashIfActive(row: MemberRefreshTokenEntity): Promise<boolean> {
    const result = await this.refreshTokenRepository.update(
      { id: row.id, status: REFRESH_STATUS.ACTIVE },
      { status: REFRESH_STATUS.REVOKED },
    )
    return (result.affected ?? 0) > 0
  }

  /** 吊销会员全部令牌（改密 / 禁用 / 软删时，统一认证设计主张 M1） */
  async revokeAllForMember(memberId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { memberId, status: REFRESH_STATUS.ACTIVE },
      { status: REFRESH_STATUS.REVOKED },
    )
  }

  /** 按哈希查有效 refresh 行（active 且未过期；查无返回 null） */
  async findActiveByHash(tokenHash: string): Promise<MemberRefreshTokenEntity | null> {
    const row = await this.refreshTokenRepository.findOne({ where: { tokenHash } })
    if (row?.status !== REFRESH_STATUS.ACTIVE)
      return null
    if (row.expiresAt.getTime() <= Date.now())
      return null
    return row
  }

  /** refresh 有效期（毫秒）：默认 30d（统一认证设计 §2.3） */
  private get refreshTtlMs(): number {
    const days = this.configService.get<number>('member.refreshExpiresDays') ?? 30
    return days * 24 * 60 * 60 * 1000
  }

  /** access 有效期（秒）：默认 8h，与 member JWT 实例签发配置同源（主张 M1） */
  private get accessTtlSeconds(): number {
    const hours = this.configService.get<number>('member.accessExpiresHours') ?? 8
    return hours * 60 * 60
  }
}
