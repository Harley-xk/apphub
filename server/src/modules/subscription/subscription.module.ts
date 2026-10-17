/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅与支付模块：计划 / 订单状态机（M3 线下备案）/ 订阅实例顺延 / introspect 真值注入 /
 * 在线支付渠道适配与回调（M5，在线支付渠道接入附录 §4 / §7）
 */
import { forwardRef, Logger, Module, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'

import { OrderEntity } from './entities/order.entity'
import { SubPlanEntity } from './entities/sub-plan.entity'
import { SubscriptionEntity } from './entities/subscription.entity'
import { OpenSubscriptionController } from './open/open-subscription.controller'
import { OrderSweepTimer } from './order/order-sweep-timer.service'
import { OrderController } from './order/order.controller'
import { OrderService } from './order/order.service'
import { AlipayProvider } from './pay/alipay.provider'
import { MockPayProvider } from './pay/mock-pay.provider'
import { PayCallbackController } from './pay/pay-callback.controller'
import { PayCallbackService } from './pay/pay-callback.service'
import {
  isAlipayConfigured,
  isAlipayPartiallyFilled,
  isWechatConfigured,
  isWechatPartiallyFilled,
  readAlipayConfig,
  readWechatConfig,
} from './pay/pay-config'
import { PayMockSettleController } from './pay/pay-mock-settle.controller'
import { PayQueryThrottleService } from './pay/pay-query-throttle.service'
import { PAYMENT_PROVIDERS } from './pay/payment-provider'
import { PaymentProviderRegistry } from './pay/payment-provider.registry'
import { WechatPayProvider } from './pay/wechat-pay.provider'
import { SUBSCRIPTION_MODULE_NAME, SUBSCRIPTION_PERMISSIONS } from './permissions'
import { PlanController } from './plan/plan.controller'
import { PlanService } from './plan/plan.service'
import { SubscriptionRenewService } from './sub/subscription-renew.service'
import { SubscriptionController } from './sub/subscription.controller'
import { SubscriptionService } from './sub/subscription.service'
import { AppEntity } from '../appcenter/entities/app.entity'
import { MemberEntity } from '../member/entities/member.entity'
import { MemberModule } from '../member/member.module'
import { PermissionRegistry } from '../system/permissions'

/**
 * Mock 触发端点仅非生产注册（附录 §5.4 / P8）：模块装饰器求值早于 ConfigService 可用期，
 * 环境判定读 NODE_ENV 原始值——与 configuration.ts 同层的引导期读取，非业务代码读 env
 */
const isProductionEnv = process.env.NODE_ENV === 'production'

@Module({
  imports: [
    // MemberEntity / AppEntity 供订单备案主体校验与 introspect 应用解析（跨域只读，与 member 引 appcenter 实体同构）；
    // MemberModule 提供 MemberAuthGuard（开放下单 / 轮询用户态鉴权）——与 member→subscription（introspect）构成
    // 领域互依，双向 forwardRef 解环
    forwardRef(() => MemberModule),
    TypeOrmModule.forFeature([
      SubPlanEntity,
      SubscriptionEntity,
      OrderEntity,
      MemberEntity,
      AppEntity,
    ]),
  ],
  controllers: [
    PlanController,
    OrderController,
    SubscriptionController,
    OpenSubscriptionController,
    PayCallbackController,
    // 生产无 mock 触发路由（条件注册，附录 §5.4）
    ...(isProductionEnv ? [] : [PayMockSettleController]),
  ],
  providers: [
    PlanService,
    OrderService,
    SubscriptionRenewService,
    SubscriptionService,
    OrderSweepTimer,
    PayQueryThrottleService,
    PayCallbackService,
    {
      // 渠道注册表按配置装配（附录 §4.2 / §7.2）：齐备装真实渠道 / 非生产降级 Mock / 生产未配不注册
      provide: PAYMENT_PROVIDERS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): PaymentProviderRegistry => {
        const logger = new Logger('PaymentProviders')
        const isProduction = configService.get<string>('env') === 'production'
        const registry = new PaymentProviderRegistry(configService.get<string>('pay.publicBaseUrl') ?? '')

        const wechat = readWechatConfig(configService)
        if (isWechatConfigured(wechat)) {
          registry.register('wechat', new WechatPayProvider(wechat))
        }
        else if (!isProduction) {
          // PY16：非生产部分填写 warn + 降级 Mock（本地单渠道联调不必补全另一渠道）
          if (isWechatPartiallyFilled(wechat))
            logger.warn('微信渠道配置部分填写，按未配置处理（非生产降级 Mock）——补全五项必配后生效')
          registry.register('wechat', new MockPayProvider('wechat'))
        }

        const alipay = readAlipayConfig(configService)
        if (isAlipayConfigured(alipay)) {
          registry.register('alipay', new AlipayProvider(alipay))
        }
        else if (!isProduction) {
          if (isAlipayPartiallyFilled(alipay))
            logger.warn('支付宝渠道配置部分填写，按未配置处理（非生产降级 Mock）——补全三项必配后生效')
          registry.register('alipay', new MockPayProvider('alipay'))
        }
        return registry
      },
    },
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionModule.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly permissionRegistry: PermissionRegistry,
  ) {}

  /** 启动期接入权限注册表 + 生产渠道配置 fail-fast（P10 / PY16：全空或部分填写均拒绝启动） */
  onModuleInit(): void {
    this.permissionRegistry.registerModule({
      module: SUBSCRIPTION_MODULE_NAME,
      points: SUBSCRIPTION_PERMISSIONS,
    })
    if (this.configService.get<string>('env') !== 'production') {
      this.logger.log('subscription 模块已接入（8 权限点，M3 备案 + M5 在线支付渠道）')
      return
    }
    const wechat = readWechatConfig(this.configService)
    const alipay = readAlipayConfig(this.configService)
    const wechatOk = isWechatConfigured(wechat)
    const alipayOk = isAlipayConfigured(alipay)
    if (!wechatOk && !alipayOk) {
      this.logger.error('生产环境至少须接入一个真实支付渠道（微信五项 / 支付宝三项，见 .env.example 在线支付段）')
      throw new Error('支付渠道配置缺失（两渠道全部未配置），服务拒绝启动')
    }
    if (!wechatOk && isWechatPartiallyFilled(wechat)) {
      this.logger.error('生产环境微信渠道配置部分填写（配置错误不静默降级）：补全五项必配或清空全部项')
      throw new Error('微信渠道配置不完整，服务拒绝启动')
    }
    if (!alipayOk && isAlipayPartiallyFilled(alipay)) {
      this.logger.error('生产环境支付宝渠道配置部分填写（配置错误不静默降级）：补全三项必配或清空全部项')
      throw new Error('支付宝渠道配置不完整，服务拒绝启动')
    }
    this.logger.log('subscription 模块已接入（8 权限点，M3 备案 + M5 在线支付渠道，生产渠道装配已校验）')
  }
}
