/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 终端认证服务：注册 / 登录（防爆破锁定）/ 刷新轮换 / 登出 / 绑定合并 / introspect（统一认证设计 §3）；
 * M4 起五类型凭证分流：password 密文比对、phone/email 验证码（登录即注册）、wechat/alipay 扫码标识（认证方式扩展设计 §3.3）
 */
import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import type { Repository } from 'typeorm'

import { CaptchaService } from './captcha.service'
import type { SendCodeDto } from './dto/open-member.dto'
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
import { businessError, BusinessError } from '../../../common/exceptions/business-error'
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
  CODE_TYPES,
  CREDENTIAL_TYPE,
  EMAIL_PATTERN,
  MEMBER_LOG_TYPE_CODE_SEND,
  MEMBER_LOG_TYPE_LOGIN,
  MEMBER_LOG_TYPE_LOGOUT,
  MEMBER_STATUS,
  PASSWORD_IDENTIFIER_PATTERN,
  PASSWORD_PATTERN,
  PHONE_PATTERN,
  SUPPORTED_TYPES,
  VERIFY_CODE_PATTERN,
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
    private readonly captchaService: CaptchaService,
  ) {}

  /** 注册（注册即登录）：五类型分流，唯一性含软删行（防抢注）；验证码类型验码在唯一性之后（冲突不消耗验证码） */
  async register(dto: RegisterMemberDto, appKey: string, client: ClientInfo): Promise<TokenPairVo> {
    this.assertTypeSupported(dto.type)
    this.assertCredentialFormat(dto.type, dto.identifier, dto.credential)
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

    if (
      CODE_TYPES.includes(dto.type)
      && !this.captchaService.verify(dto.type, dto.identifier, dto.credential)
    ) {
      await this.loginLockService.recordFailure(appKey, dto.type, dto.identifier)
      this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, null, appKey, dto, client, MemberErrorCode.VERIFY_CODE_INVALID)
      throw businessError(MemberErrorCode.VERIFY_CODE_INVALID.message, {
        code: MemberErrorCode.VERIFY_CODE_INVALID,
      })
    }

    const { member } = await this.createMemberWithCredential(dto.type, dto.identifier, dto.nickname, app, dto.credential)

    const pair = await this.tokenService.issueTokenPair(member.id, app.id, appKey, client.ip)
    this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, member.id, appKey, dto, client)
    return pair
  }

  /** 登录：锁定检查 → 类型分流凭证校验（密码统一失败文案 / 验证码单次作废 / 扫码占位）→ 禁用校验 → 清锁发令牌 */
  async login(dto: LoginMemberDto, appKey: string, client: ClientInfo): Promise<TokenPairVo> {
    this.assertTypeSupported(dto.type)
    this.assertCredentialFormat(dto.type, dto.identifier, dto.credential)
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
    const existingMember = credential
      ? await this.memberRepository.findOne({ where: { id: credential.memberId } })
      : null

    // 类型分流：凭证校验与会员解析（认证方式扩展设计 §3.3 矩阵）
    let member: MemberEntity
    let activeCredential: MemberCredentialEntity
    if (dto.type === CREDENTIAL_TYPE.PASSWORD) {
      // 密码分支：不存在 / 不匹配统一 0043001 文案（防枚举）
      const secretOk = credential?.credentialSecret
        ? bcrypt.compareSync(dto.credential, credential.credentialSecret)
        : false
      if (!credential || !existingMember || !secretOk) {
        await this.loginLockService.recordFailure(appKey, dto.type, dto.identifier)
        this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, existingMember?.id ?? null, appKey, dto, client, MemberErrorCode.LOGIN_FAILED)
        throw businessError(MemberErrorCode.LOGIN_FAILED.message, {
          code: MemberErrorCode.LOGIN_FAILED,
        })
      }
      member = existingMember
      activeCredential = credential
    }
    else {
      // 验证码分支：单次作废（C6），失败计入锁定
      if (
        CODE_TYPES.includes(dto.type)
        && !this.captchaService.verify(dto.type, dto.identifier, dto.credential)
      ) {
        await this.loginLockService.recordFailure(appKey, dto.type, dto.identifier)
        this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, existingMember?.id ?? null, appKey, dto, client, MemberErrorCode.VERIFY_CODE_INVALID)
        throw businessError(MemberErrorCode.VERIFY_CODE_INVALID.message, {
          code: MemberErrorCode.VERIFY_CODE_INVALID,
        })
      }
      // 扫码分支：credential 为占位不校验（C4 信任签名层）
      if (!credential) {
        // 查无凭证自动注册（登录即注册，C5；验证码 / 扫码共用，可携昵称）
        const created = await this.createMemberWithCredential(dto.type, dto.identifier, dto.nickname, app)
        member = created.member
        activeCredential = created.credential
      }
      else if (existingMember) {
        member = existingMember
        activeCredential = credential
      }
      else {
        // 凭证指向会员已软删：标识占位不释放（I9 防抢注），统一失败文案
        await this.loginLockService.recordFailure(appKey, dto.type, dto.identifier)
        this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, null, appKey, dto, client, MemberErrorCode.LOGIN_FAILED)
        throw businessError(MemberErrorCode.LOGIN_FAILED.message, {
          code: MemberErrorCode.LOGIN_FAILED,
        })
      }
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
    await this.credentialRepository.update(activeCredential.id, { lastUsedAt: now })
    const pair = await this.tokenService.issueTokenPair(member.id, app.id, appKey, client.ip)
    this.recordLoginLog(MEMBER_LOG_TYPE_LOGIN, member.id, appKey, dto, client)
    return pair
  }

  /** 发送验证码（开放 API）：格式 → 应用有效 → bind 场景归属预检（C12）→ 频控与发送（验证码域） */
  async sendCode(dto: SendCodeDto, appKey: string, client: ClientInfo): Promise<void> {
    if (!CODE_TYPES.includes(dto.type)) {
      throw businessError(MemberErrorCode.CREDENTIAL_TYPE_UNSUPPORTED.message, {
        code: MemberErrorCode.CREDENTIAL_TYPE_UNSUPPORTED,
      })
    }
    this.assertIdentifierFormat(dto.type, dto.identifier)
    await this.getEnabledApp(appKey)

    if (dto.scene === 'bind') {
      // 归属预检：已归属任何会员（含软删）即拒，不消耗通道成本；权威归属以 bind 事务内为准（C12 时间窗说明）
      const existed = await this.credentialRepository.findOne({
        where: { credentialType: dto.type, identifier: dto.identifier },
        withDeleted: true,
      })
      if (existed) {
        this.recordCodeSendLog(dto, appKey, client, MemberErrorCode.CREDENTIAL_OWNED_BY_OTHER.code, MemberErrorCode.CREDENTIAL_OWNED_BY_OTHER.message)
        throw businessError(MemberErrorCode.CREDENTIAL_OWNED_BY_OTHER.message, {
          code: MemberErrorCode.CREDENTIAL_OWNED_BY_OTHER,
        })
      }
    }

    try {
      await this.captchaService.send(dto.type, dto.identifier)
      this.recordCodeSendLog(dto, appKey, client, 0, null)
    }
    catch (err) {
      const code = err instanceof BusinessError ? err.code : 999
      const message = err instanceof Error ? err.message : String(err)
      this.recordCodeSendLog(dto, appKey, client, code, message)
      throw err
    }
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

  /** 绑定合并（用户态）：三分支——新凭证追加 / 幂等 / 归属他人拒绝（统一认证设计 §3.2）；幂等分支不消耗验证码 */
  async bind(memberId: string, dto: BindCredentialDto): Promise<BindResultVo> {
    this.assertTypeSupported(dto.type)
    this.assertCredentialFormat(dto.type, dto.identifier, dto.credential)
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
      // 新增前验证：验证码单次作废；password 格式已校验、扫码占位无验证
      if (
        CODE_TYPES.includes(dto.type)
        && !this.captchaService.verify(dto.type, dto.identifier, dto.credential)
      ) {
        throw businessError(MemberErrorCode.VERIFY_CODE_INVALID.message, {
          code: MemberErrorCode.VERIFY_CODE_INVALID,
        })
      }
      const credential = new MemberCredentialEntity()
      credential.memberId = memberId
      credential.credentialType = dto.type
      credential.identifier = dto.identifier
      credential.credentialSecret = this.hashCredentialSecret(dto.type, dto.credential)
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

  /** 令牌在线校验（D7）：会员身份 + 订阅状态（M3 注入真值，主张 I6） */
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
      // 订阅段真值由 subscription 域提供（appKey 为令牌绑定应用，D19）
      subscription: await this.subscriptionService.getIntrospectSegment(memberId, appKey),
    }
  }

  /** 按有效 access token 中的会员 id 查启用会员：Guard 逐请求存在性校验（对齐 D18 即时失效语义） */
  async getActiveMemberById(id: string): Promise<MemberEntity | null> {
    const member = await this.memberRepository.findOne({ where: { id } })
    return member?.status === MEMBER_STATUS.ACTIVE ? member : null
  }

  /** 凭证类型白名单（M4 五类型全开放，非法类型 0042001） */
  private assertTypeSupported(type: string): void {
    if (!SUPPORTED_TYPES.includes(type)) {
      throw businessError(MemberErrorCode.CREDENTIAL_TYPE_UNSUPPORTED.message, {
        code: MemberErrorCode.CREDENTIAL_TYPE_UNSUPPORTED,
      })
    }
  }

  /** 标识格式分流校验（C11：DTO 宽松化后按类型精确校验，透出 0042007 分段码） */
  private assertIdentifierFormat(type: string, identifier: string): void {
    if (type === CREDENTIAL_TYPE.PASSWORD && !PASSWORD_IDENTIFIER_PATTERN.test(identifier)) {
      throw businessError('登录标识须为字母数字下划线 4-32 位', {
        code: MemberErrorCode.CREDENTIAL_FORMAT_INVALID,
      })
    }
    if (type === CREDENTIAL_TYPE.PHONE && !PHONE_PATTERN.test(identifier)) {
      throw businessError('手机号格式错误', { code: MemberErrorCode.CREDENTIAL_FORMAT_INVALID })
    }
    if (type === CREDENTIAL_TYPE.EMAIL && !EMAIL_PATTERN.test(identifier)) {
      throw businessError('邮箱格式错误', { code: MemberErrorCode.CREDENTIAL_FORMAT_INVALID })
    }
  }

  /** 凭证格式分流校验：标识规则 + 密文规则（密码强度 / 验证码位数；扫码 credential 占位不校验） */
  private assertCredentialFormat(type: string, identifier: string, credential: string): void {
    this.assertIdentifierFormat(type, identifier)
    if (type === CREDENTIAL_TYPE.PASSWORD && !PASSWORD_PATTERN.test(credential)) {
      throw businessError('密码须为 8-64 位且至少包含字母与数字', {
        code: MemberErrorCode.CREDENTIAL_FORMAT_INVALID,
      })
    }
    if (CODE_TYPES.includes(type) && !VERIFY_CODE_PATTERN.test(credential)) {
      throw businessError('验证码须为 6 位数字', { code: MemberErrorCode.CREDENTIAL_FORMAT_INVALID })
    }
  }

  /** 事务落库会员 + 凭证（register 与「登录即注册」共用）：密文仅 password 持 bcrypt（矩阵 §3.3） */
  private async createMemberWithCredential(
    type: string,
    identifier: string,
    nickname: string | undefined,
    app: AppEntity,
    rawCredential?: string,
  ): Promise<{ member: MemberEntity, credential: MemberCredentialEntity }> {
    return this.dataSource.transaction(async (manager) => {
      const entity = new MemberEntity()
      // 昵称为空白串时同样走自动生成（?? 只拦 null/undefined，拦不住空串）
      const trimmedNickname = nickname?.trim()
      if (trimmedNickname)
        entity.nickname = trimmedNickname
      else
        entity.nickname = this.generateNickname()
      entity.avatarUrl = null
      entity.status = MEMBER_STATUS.ACTIVE
      entity.registeredAppId = app.id
      const member = await manager.save(MemberEntity, entity)

      const credential = new MemberCredentialEntity()
      credential.memberId = member.id
      credential.credentialType = type
      credential.identifier = identifier
      credential.credentialSecret = rawCredential ? this.hashCredentialSecret(type, rawCredential) : null
      credential.verified = true
      const savedCredential = await manager.save(MemberCredentialEntity, credential)
      return { member, credential: savedCredential }
    })
  }

  /** 凭证密文落库规则：仅 password 持 bcrypt 密文，其余类型凭验证行为建立信任 */
  private hashCredentialSecret(type: string, rawCredential: string): string | null {
    return type === CREDENTIAL_TYPE.PASSWORD ? bcrypt.hashSync(rawCredential, BCRYPT_COST) : null
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

  /** 发码行为留痕（log_type=30）：scene 存 resultMsg 供风控检索（认证方式扩展设计 §3.3） */
  private recordCodeSendLog(
    dto: SendCodeDto,
    appKey: string,
    client: ClientInfo,
    resultCode: number,
    resultMsg: string | null,
  ): void {
    try {
      const entity = new MemberLoginLogEntity()
      entity.memberId = null
      entity.appKey = appKey
      entity.credentialType = dto.type
      entity.identifier = dto.identifier
      entity.logType = MEMBER_LOG_TYPE_CODE_SEND
      entity.resultCode = resultCode
      entity.resultMsg = resultMsg ?? dto.scene
      entity.ip = client.ip
      entity.userAgent = client.userAgent
      entity.loginTime = new Date()
      this.loginLogService.record(entity)
    }
    catch (err) {
      this.logger.warn(`验证码发送日志组装失败：${(err as Error)?.message ?? err}`)
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
