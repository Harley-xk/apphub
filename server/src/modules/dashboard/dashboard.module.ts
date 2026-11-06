/*
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台模块：只读聚合端点装配与权限点注册（无业务表，不建实体）
 */
import { Module, OnModuleInit } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'
import { DASHBOARD_MODULE_NAME, DASHBOARD_PERMISSIONS } from './permissions'
import { AppVersionEntity } from '../appcenter/entities/app-version.entity'
import { AppEntity } from '../appcenter/entities/app.entity'
import { MemberLoginLockEntity } from '../member/entities/member-login-lock.entity'
import { MemberEntity } from '../member/entities/member.entity'
import { OrderEntity } from '../subscription/entities/order.entity'
import { SubscriptionEntity } from '../subscription/entities/subscription.entity'
import { PermissionRegistry } from '../system/permissions'

@Module({
  // 只读聚合直接使用业务实体 Repository：不改造 appcenter / member / subscription 的对外接口，
  // 依赖方向为 dashboard → 业务实体 / system，不产生反向依赖（设计 §5.2）
  imports: [TypeOrmModule.forFeature([
    AppEntity,
    AppVersionEntity,
    MemberEntity,
    OrderEntity,
    SubscriptionEntity,
    MemberLoginLockEntity,
  ])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule implements OnModuleInit {
  // SystemModule 为 @Global 且导出 PermissionRegistry，业务模块直接注入（依赖方向：业务 → 系统）
  constructor(private readonly permissionRegistry: PermissionRegistry) {}

  /** 启动期接入权限注册表：首段校验 / 全局查重失败即拒绝启动 */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({ module: DASHBOARD_MODULE_NAME, points: DASHBOARD_PERMISSIONS })
  }
}
