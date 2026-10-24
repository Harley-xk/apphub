/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用中心模块：应用注册与凭证、更新通道、版本发布、安装包管理与更新检测开放 API（M1）
 */
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'

import { AppSecretRegistry } from '../../common/signature/app-secret.registry'
import { AppLookupRegistry } from '../system/app-scope/app-lookup.port'
import { PermissionRegistry } from '../system/permissions'
import { AppLookupService } from './app/app-lookup.service'
import { AppController } from './app/app.controller'
import { AppService } from './app/app.service'
import { ChannelController } from './channel/channel.controller'
import { ChannelService } from './channel/channel.service'
import { AppChannelEntity } from './entities/app-channel.entity'
import { AppPackageEntity } from './entities/app-package.entity'
import { AppVersionEntity } from './entities/app-version.entity'
import { AppEntity } from './entities/app.entity'
import { OpenAppController } from './open/open-app.controller'
import { OpenUpdateController } from './open/open-update.controller'
import { OpenUpdateService } from './open/open-update.service'
import { PackageController } from './package/package.controller'
import { PackageService } from './package/package.service'
import { APPCENTER_MODULE_NAME, APPCENTER_PERMISSIONS } from './permissions'
import { SkillController } from './skill/skill.controller'
import { SkillDistributionService } from './skill/skill.service'
import { OssStorageService } from './storage/oss-storage.service'
import { STORAGE_SERVICE } from './storage/storage.service'
import { UnconfiguredStorageService } from './storage/unconfigured-storage.service'
import { VersionActionController } from './version/version-action.controller'
import { VersionController } from './version/version.controller'
import { VersionService } from './version/version.service'
import { RateLimitPolicyRegistry } from '../../common/rate-limit/rate-limit-policy.registry'

@Module({
  imports: [TypeOrmModule.forFeature([AppEntity, AppChannelEntity, AppVersionEntity, AppPackageEntity])],
  controllers: [
    AppController,
    ChannelController,
    VersionController,
    VersionActionController,
    PackageController,
    OpenAppController,
    OpenUpdateController,
    SkillController,
  ],
  providers: [
    AppService,
    AppLookupService,
    ChannelService,
    VersionService,
    PackageService,
    OpenUpdateService,
    SkillDistributionService,
    {
      // OSS（region + bucket + 全局 aliyun AK）齐备装配真实实现，否则未配置 stub（服务正常启动）；
      // AK 与短信通道共用顶层 aliyun 段（整个应用唯一一组 AK）
      provide: STORAGE_SERVICE,
      useFactory: (configService: ConfigService) => {
        const aliyun = configService.get<{ accessKeyId: string, accessKeySecret: string }>('aliyun')
        const oss = configService.get<{ region: string, bucket: string, stsRoleArn: string, stsSessionName: string }>('oss')
        if (oss?.region && oss.bucket && aliyun?.accessKeyId && aliyun.accessKeySecret)
          return new OssStorageService({ ...aliyun, ...oss })
        return new UnconfiguredStorageService()
      },
      inject: [ConfigService],
    },
  ],
})
export class AppcenterModule implements OnModuleInit {
  // SystemModule 为 @Global 且导出 PermissionRegistry，业务模块直接注入（依赖方向：业务 → 系统）；
  // RateLimitModule 为 @Global 且导出策略注册表，此处注入「按 AppKey 解析调用方类型」的策略源；
  // SignatureModule 为 @Global 且导出应用密钥源注册表，此处注入「按 AppKey 解析开放 API 签名密钥」的来源（D15/D17，主张 I2）；
  // SystemModule 为 @Global 且导出应用查找端口注册表，此处注册实现供应用授权接口校验应用存在性（应用管理员与数据范围设计 §9）
  constructor(
    private readonly permissionRegistry: PermissionRegistry,
    private readonly rateLimitPolicyRegistry: RateLimitPolicyRegistry,
    private readonly appSecretRegistry: AppSecretRegistry,
    private readonly appLookupRegistry: AppLookupRegistry,
    private readonly appLookupService: AppLookupService,
    private readonly appService: AppService,
  ) {}

  /** 启动期接入权限注册表、限流策略源、签名密钥源与应用查找端口（均即时校验，违规即拒绝启动） */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({ module: APPCENTER_MODULE_NAME, points: APPCENTER_PERMISSIONS })
    this.rateLimitPolicyRegistry.registerResolver(async (appKey) => {
      const app = await this.appService.findByAppKey(appKey)
      return app ? { clientType: app.clientType } : null
    })
    // 应用级 HMAC 密钥源：查无 / 已停用 / 已软删返回 null（验签按 AppKey 无效拒绝，不给探测者区分原因）
    this.appSecretRegistry.registerResolver(async (appKey) => {
      const app = await this.appService.findByAppKey(appKey)
      return app?.status === 'enabled' ? app.appSecret : null
    })
    // 应用查找端口：system 的应用授权接口据此校验 appId 存在性并回显精简信息（端口注册见 §9）
    this.appLookupRegistry.register(this.appLookupService)
  }
}
