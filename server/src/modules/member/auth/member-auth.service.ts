/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 终端认证服务：注册 / 登录（防爆破锁定）/ 刷新轮换 / 登出 / 绑定合并 / introspect（统一认证设计 §3）
 */
import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import type { Repository } from 'typeorm'

import type {
  BindCredentialDto,
  BindResultVo,
  IntrospectVo,
  LoginMemberDto,
  RegisterMemberDto,
} from './dto/open-member.dto'
import { LoginLockService } from './login-lock.service'
import { MemberLoginLogService } from './member-login-log.service'
import { MemberTokenService, type TokenPairVo } from './member-token.service'
import type { ErrorCode } from '../../../common/errors/error-code'
import { businessError } from '../../../common/exceptions/business-error'
import type { ClientInfo } from '../../../common/utils/client-info'
import { AppEntity } from '../../appcenter/entities/app.entity'
import { AppcenterErrorCode } from '../../appcenter/error-codes'
import { SubscriptionService } from '../../subscription/sub/subscription.service'
import { MemberCredentialEntity } from '../entities/member-credential.entity'
import { MemberLoginLogEntity } from '../entities/member-login-log.entity'
import { MemberEntity } from '../entities/member.entity'
import { MemberErrorCode } from '../error-codes'
import {
  BCRYPT_COST,
  MEMBER_LOG_TYPE_LOGIN,
  MEMBER_LOG_TYPE_LOGOUT,
  MEMBER_STATUS,
  SELF_SERVICE_TYPES,
} from '../member.constants'

@Injectable()
export class MemberAuthService {
  private readonly logger = new Logger(MemberAuthService.name)

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(MemberCredentialEntity)
    private readonly credentialRepository: Repository<MemberCredentialEntity>,
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
    private readonly tokenService: MemberTokenService,
    private readonly loginLockService: LoginLockService,
    private readonly loginLogService: MemberLoginLogService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /** 注册（注册即登录）：唯一性含软删行（防抢注），member + credential 同事务落库 */
  async register(dto: RegisterMemberDto, appKey: string, client: ClientInfo): Promise<TokenPairVo> {
    this.assertTypeSupported(dto.type)
    const app = await this.getEnabledApp(appKey)

    const existed = await this.credentialRepository.findOne({
      where: { credentialType: dto.type, identifier: dto.identifier },
      withDeleted: true,
    })
    if (existed) {
      throw businessError(MemberErrorCode.CREDENTIAL_IDENTIFIER_DUPLICATE.message, {
        code: MemberErrorCode.CREDENTIAL_IDENTIFIER_DUPLICATE,
      })
    }

    const member = await this.dataSource.transaction(async (manager) => {
      const entity = new MemberEntity()
      // 昵称为空白串时同样走自动生成（?? 只拦 null/undefined，拦不住空串）
      const trimmedNickname = dto.nickname?.trim()
      if (trimmedNickname)
        entity.nickname = trimmedNickname
      else
        entity.nickname = this.generateNickname()
      entity.avatarUrl = null
      entity.status = MEMBER_STATUS.ACTIVE
      entity.registeredAppId = app.id
      const saved = await manager.save(MemberEntity, entity)

      const credential = new MemberCredentialEntity()
      credential.memberId = saved.id
      credential.credentialType = dto.type
      credential.identifier = dto.identifier
      credential.credentialSecret = bcrypt.hashSync(dto.credential, BCRYPT_COST)
      credential.verified = true
      await manager.save(MemberCredentialEntity, credential)
      return saved
    })

    const pair = await this.tokenService.issueTokenPair(member.id, app.id, appKey, client.ip)
    this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, member.id, appKey, dto, client)
    return pair
  }

  /** 登录：锁定检查 → 凭证比对（统一失败文案防枚举）→ 禁用校验 → 清锁发令牌 */
  async login(dto: LoginMemberDto, appKey: string, client: ClientInfo): Promise<TokenPairVo> {
    this.assertTypeSupported(dto.type)
    const app = await this.getEnabledApp(appKey)

    const lockedUntil = await this.loginLockService.getLockedUntil(appKey, dto.type, dto.identifier)
    if (lockedUntil) {
      this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, null, appKey, dto, client, MemberErrorCode.LOGIN_LOCKED)
      throw businessError(MemberErrorCode.LOGIN_LOCKED.message, {
        code: MemberErrorCode.LOGIN_LOCKED,
      })
    }

    // 凭证查找含软删行：软删会员的凭证不可登录（查会员一步自然过滤）但保持占位语义
    const credential = await this.credentialRepository.findOne({
      where: { credentialType: dto.type, identifier: dto.identifier },
      withDeleted: true,
    })
    const member = credential
      ? await this.memberRepository.findOne({ where: { id: credential.memberId } })
      : null
    const secretOk = credential?.credentialSecret
      ? bcrypt.compareSync(dto.credential, credential.credentialSecret)
      : false
    if (!credential || !member || !secretOk) {
      await this.loginLockService.recordFailure(appKey, dto.type, dto.identifier)
      this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, member?.id ?? null, appKey, dto, client, MemberErrorCode.LOGIN_FAILED)
      throw businessError(MemberErrorCode.LOGIN_FAILED.message, {
        code: MemberErrorCode.LOGIN_FAILED,
      })
    }
    if (member.status !== MEMBER_STATUS.ACTIVE) {
      this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, member.id, appKey, dto, client, MemberErrorCode.MEMBER_DISABLED)
      throw businessError(MemberErrorCode.MEMBER_DISABLED.message, {
        code: MemberErrorCode.MEMBER_DISABLED,
      })
    }

    await this.loginLockService.recordSuccess(appKey, dto.type, dto.identifier)
    const now = new Date()
    await this.memberRepository.update(member.id, { lastLoginAt: now })
    await this.credentialRepository.update(credential.id, { lastUsedAt: now })
    const pair = await this.tokenService.issueTokenPair(member.id, app.id, appKey, client.ip)
    this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, member.id, appKey, dto, client)
    return pair
  }

  /** 刷新令牌：轮换语义——旧 refresh 条件吊销（并发竞态只有一个成功）+ 签发新令牌对 */
  async refresh(refreshToken: string, appKey: string, client: ClientInfo): Promise<TokenPairVo> {
    const app = await this.getEnabledApp(appKey)
    const hash = this.tokenService.hashRefreshToken(refreshToken)
    const row = await this.tokenService.findActiveByHash(hash)
    if (!row) {
      throw businessError(MemberErrorCode.REFRESH_TOKEN_INVALID.message, {
        code: MemberErrorCode.REFRESH_TOKEN_INVALID,
      })
    }
    // 令牌绑定应用（D19）：A 应用签发的 refresh 携 B 应用签名调用即拒绝
    if (row.appId !== app.id) {
      throw businessError(MemberErrorCode.TOKEN_APP_MISMATCH.message, {
        code: MemberErrorCode.TOKEN_APP_MISMATCH,
      })
    }
    const member = await this.memberRepository.findOne({ where: { id: row.memberId } })
    if (!member) {
      throw businessError(MemberErrorCode.REFRESH_TOKEN_INVALID.message, {
        code: MemberErrorCode.REFRESH_TOKEN_INVALID,
      })
    }
    if (member.status !== MEMBER_STATUS.ACTIVE) {
      throw businessError(MemberErrorCode.MEMBER_DISABLED.message, {
        code: MemberErrorCode.MEMBER_DISABLED,
      })
    }

    // 条件更新抢占轮换权：并发双请求同 refresh 时仅首个成功，其后按 0043003 拒绝
    const revoked = await this.tokenService.revokeByHashIfActive(row)
    if (!revoked) {
      throw businessError(MemberErrorCode.REFRESH_TOKEN_INVALID.message, {
        code: MemberErrorCode.REFRESH_TOKEN_INVALID,
      })
    }
    return this.tokenService.issueTokenPair(row.memberId, app.id, appKey, client.ip)
  }

  /** 登出：吊销 body 携带的 refresh（幂等；仅本人令牌可吊销），记登出日志 */
  async logout(memberId: string, refreshToken: string, appKey: string, client: ClientInfo): Promise<void> {
    const hash = this.tokenService.hashRefreshToken(refreshToken)
    const row = await this.tokenService.findActiveByHash(hash)
    if (row?.memberId === memberId)
      await this.tokenService.revokeByHash(hash)
    this.recordLogoutLog(memberId, appKey, client)
  }

  /** 绑定合并（用户态）：三分支——新凭证追加 / 幂等 / 归属他人拒绝（统一认证设计 §3.2） */
  async bind(memberId: string, dto: BindCredentialDto): Promise<BindResultVo> {
    this.assertTypeSupported(dto.type)
    const member = await this.memberRepository.findOne({ where: { id: memberId } })
    if (!member) {
      throw businessError(MemberErrorCode.MEMBER_NOT_EXISTS.message, {
        code: MemberErrorCode.MEMBER_NOT_EXISTS,
      })
    }
    const existed = await this.credentialRepository.findOne({
      where: { credentialType: dto.type, identifier: dto.identifier },
      withDeleted: true,
    })
    if (!existed) {
      const credential = new MemberCredentialEntity()
      credential.memberId = memberId
      credential.credentialType = dto.type
      credential.identifier = dto.identifier
      credential.credentialSecret = bcrypt.hashSync(dto.credential, BCRYPT_COST)
      credential.verified = true
      await this.credentialRepository.save(credential)
      return { result: 'added' }
    }
    if (existed.memberId === memberId)
      return { result: 'existed' }
    throw businessError(MemberErrorCode.CREDENTIAL_OWNED_BY_OTHER.message, {
      code: MemberErrorCode.CREDENTIAL_OWNED_BY_OTHER,
    })
  }

  /** 令牌在线校验（D7）：会员身份 + 订阅状态占位（M3 注入真值，主张 I6） */
  async introspect(memberId: string, appKey: string): Promise<IntrospectVo> {
    const member = await this.memberRepository.findOne({ where: { id: memberId } })
    if (!member) {
      throw businessError(MemberErrorCode.MEMBER_NOT_EXISTS.message, {
        code: MemberErrorCode.MEMBER_NOT_EXISTS,
      })
    }
    return {
      member: {
        id: member.id,
        nickname: member.nickname,
        avatarUrl: member.avatarUrl,
        status: member.status,
      },
      // 订阅段真值由 subscription 域提供（M3 替换占位 I6；appKey 为令牌绑定应用，D19）
      subscription: await this.subscriptionService.getIntrospectSegment(memberId, appKey),
    }
  }

  /** 按有效 access token 中的会员 id 查启用会员：Guard 逐请求存在性校验（对齐 D18 即时失效语义） */
  async getActiveMemberById(id: string): Promise<MemberEntity | null> {
    const member = await this.memberRepository.findOne({ where: { id } })
    return member?.status === MEMBER_STATUS.ACTIVE ? member : null
  }

  /** M2 开放的凭证类型收敛（其余类型 0042001，M4 按资质就绪放开） */
  private assertTypeSupported(type: string): void {
    if (!SELF_SERVICE_TYPES.includes(type)) {
      throw businessError(MemberErrorCode.CREDENTIAL_TYPE_UNSUPPORTED.message, {
        code: MemberErrorCode.CREDENTIAL_TYPE_UNSUPPORTED,
      })
    }
  }

  /** 开放 API 应用有效性：查无 / 已停用 / 已软删一律拒绝（签名层已拦，服务层防御性兜底） */
  private async getEnabledApp(appKey: string): Promise<AppEntity> {
    const app = await this.appRepository.findOne({ where: { appKey } })
    if (!app) {
      throw businessError(AppcenterErrorCode.APP_KEY_INVALID.message, {
        code: AppcenterErrorCode.APP_KEY_INVALID,
      })
    }
    if (app.status !== 'enabled') {
      throw businessError(AppcenterErrorCode.APP_DISABLED.message, {
        code: AppcenterErrorCode.APP_DISABLED,
      })
    }
    return app
  }

  /** 昵称兜底生成：「用户」+ 3 字节随机 hex（统一认证设计 §2.1） */
  private generateNickname(): string {
    return `用户${randomBytes(3).toString('hex')}`
  }

  /** 组装并异步入库一条登录日志：失败不阻断主链路（同 system 域先例） */
  private recordLoginLog(
    logType: number,
    memberId: string | null,
    appKey: string,
    dto: { type: string, identifier: string },
    client: ClientInfo,
    errorCode?: ErrorCode,
  ): void {
    try {
      const entity = new MemberLoginLogEntity()
      entity.memberId = memberId
      entity.appKey = appKey
      entity.credentialType = dto.type
      entity.identifier = dto.identifier
      entity.logType = logType
      entity.resultCode = errorCode?.code ?? 0
      entity.resultMsg = errorCode?.message ?? null
      entity.ip = client.ip
      entity.userAgent = client.userAgent
      entity.loginTime = new Date()
      this.loginLogService.record(entity)
    }
    catch (err) {
      this.logger.warn(`会员登录日志组装失败：${(err as Error)?.message ?? err}`)
    }
  }

  /** 登出日志（标识与凭证类型不适用，占位空串） */
  private recordLogoutLog(memberId: string, appKey: string, client: ClientInfo): void {
    try {
      const entity = new MemberLoginLogEntity()
      entity.memberId = memberId
      entity.appKey = appKey
      entity.credentialType = ''
      entity.identifier = ''
      entity.logType = MEMBER_LOG_TYPE_LOGOUT
      entity.resultCode = 0
      entity.resultMsg = null
      entity.ip = client.ip
      entity.userAgent = client.userAgent
      entity.loginTime = new Date()
      this.loginLogService.record(entity)
    }
    catch (err) {
      this.logger.warn(`会员登出日志组装失败：${(err as Error)?.message ?? err}`)
    }
  }
}
