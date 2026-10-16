/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用中心模块：应用注册与凭证、更新通道、版本发布、安装包管理与更新检测开放 API（M1）
 */
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'

import { PermissionRegistry } from '../system/permissions'
import { AppController } from './app/app.controller'
import { AppService } from './app/app.service'
import { ChannelController } from './channel/channel.controller'
import { ChannelService } from './channel/channel.service'
import { AppChannelEntity } from './entities/app-channel.entity'
import { AppPackageEntity } from './entities/app-package.entity'
import { AppVersionEntity } from './entities/app-version.entity'
import { AppEntity } from './entities/app.entity'
import { PackageController } from './package/package.controller'
import { PackageService } from './package/package.service'
import { APPCENTER_MODULE_NAME, APPCENTER_PERMISSIONS } from './permissions'
import { OssStorageService } from './storage/oss-storage.service'
import { STORAGE_SERVICE } from './storage/storage.service'
import { UnconfiguredStorageService } from './storage/unconfigured-storage.service'
import { VersionActionController } from './version/version-action.controller'
import { VersionController } from './version/version.controller'
import { VersionService } from './version/version.service'

@Module({
  imports: [TypeOrmModule.forFeature([AppEntity, AppChannelEntity, AppVersionEntity, AppPackageEntity])],
  controllers: [AppController, ChannelController, VersionController, VersionActionController, PackageController],
  providers: [
    AppService,
    ChannelService,
    VersionService,
    PackageService,
    {
      // OSS 四项（region / bucket / AK / SK）齐备装配真实实现，否则未配置 stub（服务正常启动）
      provide: STORAGE_SERVICE,
      useFactory: (configService: ConfigService) => {
        const oss = configService.get<{
          region: string
          bucket: string
          accessKeyId: string
          accessKeySecret: string
          stsRoleArn: string
          stsSessionName: string
        }>('oss')
        if (oss?.region && oss.bucket && oss.accessKeyId && oss.accessKeySecret)
          return new OssStorageService(oss)
        return new UnconfiguredStorageService()
      },
      inject: [ConfigService],
    },
  ],
})
export class AppcenterModule implements OnModuleInit {
  // SystemModule 为 @Global 且导出 PermissionRegistry，业务模块直接注入（依赖方向：业务 → 系统）
  constructor(private readonly permissionRegistry: PermissionRegistry) {}

  /** 启动期接入权限注册表：即时校验（首段不符 / 串冲突 / 模块重名均拒绝启动） */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({ module: APPCENTER_MODULE_NAME, points: APPCENTER_PERMISSIONS })
  }
}
