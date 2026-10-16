/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用中心模块：应用注册与凭证、更新通道、版本发布、安装包管理与更新检测开放 API（M1）
 */
import { Module, OnModuleInit } from '@nestjs/common'
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
import { APPCENTER_MODULE_NAME, APPCENTER_PERMISSIONS } from './permissions'

@Module({
  imports: [TypeOrmModule.forFeature([AppEntity, AppChannelEntity, AppVersionEntity, AppPackageEntity])],
  controllers: [AppController, ChannelController],
  providers: [AppService, ChannelService],
})
export class AppcenterModule implements OnModuleInit {
  // SystemModule 为 @Global 且导出 PermissionRegistry，业务模块直接注入（依赖方向：业务 → 系统）
  constructor(private readonly permissionRegistry: PermissionRegistry) {}

  /** 启动期接入权限注册表：即时校验（首段不符 / 串冲突 / 模块重名均拒绝启动） */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({ module: APPCENTER_MODULE_NAME, points: APPCENTER_PERMISSIONS })
  }
}
