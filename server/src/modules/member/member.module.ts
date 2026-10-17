/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 终端用户模块：会员 / 凭证 / 双令牌 / 登录日志与锁定（M2 密码先行）、开放 API 与管理端接口
 */
import { Logger, Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'

import { MemberAdminService } from './admin/member-admin.service'
import { MemberController } from './admin/member.controller'
import { CaptchaService } from './auth/captcha.service'
import { isSmsConfigured, SmsChannelConfig, AliyunSmsSender } from './auth/code-sender/aliyun-sms.sender'
import type { CodeSender } from './auth/code-sender/code-sender'
import { MAIL_CODE_SENDER, SMS_CODE_SENDER } from './auth/code-sender/code-sender'
import { LogCodeSender } from './auth/code-sender/log-code.sender'
import { isMailConfigured, MailChannelConfig, SmtpMailSender } from './auth/code-sender/smtp-mail.sender'
import { LoginLockService } from './auth/login-lock.service'
import { MemberAuthGuard } from './auth/member-auth.guard'
import { MemberAuthService } from './auth/member-auth.service'
import { MemberLoginLogService } from './auth/member-login-log.service'
import { MEMBER_JWT, MemberTokenService } from './auth/member-token.service'
import { OpenMemberAuthController } from './auth/open-member-auth.controller'
import { OpenMemberTokenController } from './auth/open-member-token.controller'
import { MemberCredentialEntity } from './entities/member-credential.entity'
import { MemberLoginLockEntity } from './entities/member-login-lock.entity'
import { MemberLoginLogEntity } from './entities/member-login-log.entity'
import { MemberRefreshTokenEntity } from './entities/member-refresh-token.entity'
import { MemberEntity } from './entities/member.entity'
import { MEMBER_MODULE_NAME, MEMBER_PERMISSIONS } from './permissions'
import { DEFAULT_MEMBER_JWT_SECRET } from '../../config/configuration'
import { AppEntity } from '../appcenter/entities/app.entity'
import { SubscriptionModule } from '../subscription/subscription.module'
import { PermissionRegistry } from '../system/permissions'

@Module({
  imports: [
    // SubscriptionModule 提供 introspect 订阅段真值（subscription 不反向依赖 member 服务，无循环）
    SubscriptionModule,
    // AppEntity 供开放 API 链路解析应用（appKey → 应用 / 有效性），与 appcenter 共享仓储
    TypeOrmModule.forFeature([
      MemberEntity,
      MemberCredentialEntity,
      MemberRefreshTokenEntity,
      MemberLoginLogEntity,
      MemberLoginLockEntity,
      AppEntity,
    ]),
  ],
  controllers: [OpenMemberAuthController, OpenMemberTokenController, MemberController],
  providers: [
    MemberAuthService,
    MemberAdminService,
    LoginLockService,
    MemberLoginLogService,
    MemberAuthGuard,
    MemberTokenService,
    CaptchaService,
    {
      // 短信通道按配置装配（认证方式扩展设计 §3.2）：真实通道 / log 降级（非生产缺配时）
      provide: SMS_CODE_SENDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): CodeSender => {
        const smsConfig: SmsChannelConfig = {
          accessKeyId: configService.get<string>('sms.accessKeyId') ?? '',
          accessKeySecret: configService.get<string>('sms.accessKeySecret') ?? '',
          signName: configService.get<string>('sms.signName') ?? '',
          templateCode: configService.get<string>('sms.templateCode') ?? '',
        }
        return isSmsConfigured(smsConfig)
          ? new AliyunSmsSender(smsConfig)
          : new LogCodeSender(new Logger('SmsCodeSender'), 'sms')
      },
    },
    {
      // 邮件通道同短信：SMTP 五项齐备走真实通道，否则非生产降级 log
      provide: MAIL_CODE_SENDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): CodeSender => {
        const mailConfig: MailChannelConfig = {
          host: configService.get<string>('mail.host') ?? '',
          port: configService.get<number>('mail.port') ?? 465,
          user: configService.get<string>('mail.user') ?? '',
          password: configService.get<string>('mail.password') ?? '',
          from: configService.get<string>('mail.from') ?? '',
        }
        return isMailConfigured(mailConfig)
          ? new SmtpMailSender(mailConfig)
          : new LogCodeSender(new Logger('MailCodeSender'), 'mail')
      },
    },
    {
      // member 域独立 JwtService 实例（独立密钥与时效，D18 两套信任域互不可串）；
      // 显式注入 token 而非再注册 JwtModule——避免与 system 域 global JwtService 的遮蔽歧义
      provide: MEMBER_JWT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new JwtService({
          secret: configService.get<string>('member.jwtSecret'),
          signOptions: {
            expiresIn: (configService.get<number>('member.accessExpiresHours') ?? 8) * 3600,
          },
        }),
    },
  ],
})
export class MemberModule implements OnModuleInit {
  private readonly logger = new Logger(MemberModule.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly permissionRegistry: PermissionRegistry,
  ) {}

  /** 启动期接入权限注册表 + 生产密钥与验证码通道 fail-fast（首段不符 / 串冲突 / 密钥或通道缺配即拒绝启动） */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({ module: MEMBER_MODULE_NAME, points: MEMBER_PERMISSIONS })
    if (this.configService.get<string>('env') !== 'production') {
      return
    }
    const secret = this.configService.get<string>('member.jwtSecret') ?? ''
    if (secret === DEFAULT_MEMBER_JWT_SECRET) {
      this.logger.error('生产环境必须配置独立的 MEMBER_JWT_SECRET（不得使用开发默认密钥）')
      throw new Error('MEMBER_JWT_SECRET 未配置为生产独立密钥，服务拒绝启动')
    }
    // 验证码通道生产 fail-fast（C7）：配置缺失即拒绝启动，不允许生产环境静默走 log 降级
    const smsConfig: SmsChannelConfig = {
      accessKeyId: this.configService.get<string>('sms.accessKeyId') ?? '',
      accessKeySecret: this.configService.get<string>('sms.accessKeySecret') ?? '',
      signName: this.configService.get<string>('sms.signName') ?? '',
      templateCode: this.configService.get<string>('sms.templateCode') ?? '',
    }
    if (!isSmsConfigured(smsConfig)) {
      this.logger.error('生产环境必须配置阿里云短信通道（SMS_ACCESS_KEY_ID / SMS_ACCESS_KEY_SECRET / SMS_SIGN_NAME / SMS_TEMPLATE_CODE）')
      throw new Error('短信通道配置缺失，服务拒绝启动')
    }
    const mailConfig: MailChannelConfig = {
      host: this.configService.get<string>('mail.host') ?? '',
      port: this.configService.get<number>('mail.port') ?? 465,
      user: this.configService.get<string>('mail.user') ?? '',
      password: this.configService.get<string>('mail.password') ?? '',
      from: this.configService.get<string>('mail.from') ?? '',
    }
    if (!isMailConfigured(mailConfig)) {
      this.logger.error('生产环境必须配置 SMTP 邮件通道（MAIL_HOST / MAIL_PORT / MAIL_USER / MAIL_PASS / MAIL_FROM）')
      throw new Error('邮件通道配置缺失，服务拒绝启动')
    }
  }
}
