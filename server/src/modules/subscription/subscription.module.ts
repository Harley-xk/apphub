/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅与支付模块：计划 / 订单状态机（M3 线下备案，在线渠道 M5）/ 订阅实例顺延 / introspect 真值注入
 */
import { Logger, Module, type OnModuleInit } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { OrderEntity } from './entities/order.entity'
import { SubPlanEntity } from './entities/sub-plan.entity'
import { SubscriptionEntity } from './entities/subscription.entity'
import { OpenSubscriptionController } from './open/open-subscription.controller'
import { OrderSweepTimer } from './order/order-sweep-timer.service'
import { OrderController } from './order/order.controller'
import { OrderService } from './order/order.service'
import { SUBSCRIPTION_MODULE_NAME, SUBSCRIPTION_PERMISSIONS } from './permissions'
import { PlanController } from './plan/plan.controller'
import { PlanService } from './plan/plan.service'
import { SubscriptionRenewService } from './sub/subscription-renew.service'
import { SubscriptionController } from './sub/subscription.controller'
import { SubscriptionService } from './sub/subscription.service'
import { AppEntity } from '../appcenter/entities/app.entity'
import { MemberEntity } from '../member/entities/member.entity'
import { PermissionRegistry } from '../system/permissions'

@Module({
  imports: [
    // MemberEntity / AppEntity 供订单备案主体校验与 introspect 应用解析（跨域只读，与 member 引 appcenter 实体同构）
    TypeOrmModule.forFeature([
      SubPlanEntity,
      SubscriptionEntity,
      OrderEntity,
      MemberEntity,
      AppEntity,
    ]),
  ],
  controllers: [PlanController, OrderController, SubscriptionController, OpenSubscriptionController],
  providers: [PlanService, OrderService, SubscriptionRenewService, SubscriptionService, OrderSweepTimer],
  exports: [SubscriptionService],
})
export class SubscriptionModule implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionModule.name)

  constructor(private readonly permissionRegistry: PermissionRegistry) {}

  /** 启动期接入权限注册表（首段不符 / 串冲突即拒绝启动） */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({
      module: SUBSCRIPTION_MODULE_NAME,
      points: SUBSCRIPTION_PERMISSIONS,
    })
    this.logger.log('subscription 模块已接入（8 权限点，M3 线下备案通道）')
  }
}
