/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: analytics 模块：活跃事件上报、活跃度查询与日表清理，权限点注册与会员身份端口提供（设计 §7.1）
 */
import { Module, OnModuleInit } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { ActivityController } from './activity/activity.controller'
import { ActivityService } from './activity/activity.service'
import { AnalyticsCleanupService } from './cleanup/analytics-cleanup.service'
import { AnalyticsDeviceDayEntity } from './entities/analytics-device-day.entity'
import { AnalyticsDeviceEntity } from './entities/analytics-device.entity'
import { ActivityIngestService } from './ingest/activity-ingest.service'
import { ActivityReportController } from './ingest/activity-report.controller'
import { ANALYTICS_MODULE_NAME, ANALYTICS_PERMISSIONS } from './permissions'
import { MemberIdentityPortsModule } from './ports/member-identity.port'
import { PermissionRegistry } from '../system/permissions'

@Module({
  imports: [
    // 会员身份端口注册表：member 模块启动期注入实现（消费方定义抽象，提供方注册）
    MemberIdentityPortsModule,
    TypeOrmModule.forFeature([AnalyticsDeviceDayEntity, AnalyticsDeviceEntity]),
  ],
  controllers: [ActivityReportController, ActivityController],
  providers: [ActivityIngestService, ActivityService, AnalyticsCleanupService],
})
export class AnalyticsModule implements OnModuleInit {
  // SystemModule 为 @Global 且导出 PermissionRegistry，业务模块直接注入（依赖方向：业务 → 系统）
  constructor(private readonly permissionRegistry: PermissionRegistry) {}

  /** 启动期接入权限注册表：首段校验 / 全局查重失败即拒绝启动 */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({ module: ANALYTICS_MODULE_NAME, points: ANALYTICS_PERMISSIONS })
  }
}
