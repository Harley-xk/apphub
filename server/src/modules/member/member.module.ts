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

  /** 启动期接入权限注册表 + 生产密钥 fail-fast（首段不符 / 串冲突 / 密钥缺配即拒绝启动） */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({ module: MEMBER_MODULE_NAME, points: MEMBER_PERMISSIONS })
    const secret = this.configService.get<string>('member.jwtSecret') ?? ''
    if (this.configService.get<string>('env') === 'production' && secret === DEFAULT_MEMBER_JWT_SECRET) {
      this.logger.error('生产环境必须配置独立的 MEMBER_JWT_SECRET（不得使用开发默认密钥）')
      throw new Error('MEMBER_JWT_SECRET 未配置为生产独立密钥，服务拒绝启动')
    }
  }
}
