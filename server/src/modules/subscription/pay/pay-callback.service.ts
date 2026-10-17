/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 渠道回调受理（在线支付渠道接入附录 §4.4）：验签解析（渠道 Provider）→ markPaid 幂等受理 →
 * 应答布尔映射（PY8 / PY9：三态与金额不符均应答成功，仅验签失败与未知异常应答失败触发渠道重推）
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { IncomingHttpHeaders } from 'node:http'

import { AlipayProvider } from './alipay.provider'
import type { CallbackParseResult } from './payment-provider'
import { PAYMENT_PROVIDERS } from './payment-provider'
import { WechatPayProvider } from './wechat-pay.provider'
import { BusinessError } from '../../../common/exceptions/business-error'
import { OrderService } from '../order/order.service'
import { ORDER_CHANNEL } from '../subscription.constants'
import { PaymentProviderRegistry } from './payment-provider.registry'

@Injectable()
export class PayCallbackService {
  private readonly logger = new Logger(PayCallbackService.name)

  constructor(
    private readonly orderService: OrderService,
    @Inject(PAYMENT_PROVIDERS)
    private readonly registry: PaymentProviderRegistry,
  ) {}

  /** 微信回调：返回是否对渠道应答成功（控制器据此发送 200 SUCCESS / 500 FAIL） */
  async handleWechat(headers: IncomingHttpHeaders, rawBody: Buffer): Promise<boolean> {
    const provider = this.registry.getProvider(ORDER_CHANNEL.WECHAT)
    // 能下单则渠道必已配置；未注册说明环境装配异常（如生产误删配置后重启），拒绝受理让渠道重推
    if (!(provider instanceof WechatPayProvider)) {
      this.logger.error('微信渠道未装配（配置缺失），回调无法验签')
      return false
    }
    const notification = await provider.parseCallback(headers, rawBody)
    if (!notification)
      return false
    return this.accept(notification, 'wechat')
  }

  /** 支付宝回调：form 表单体经 Nest 解析为键值对象 */
  async handleAlipay(body: Record<string, unknown>): Promise<boolean> {
    const provider = this.registry.getProvider(ORDER_CHANNEL.ALIPAY)
    if (!(provider instanceof AlipayProvider)) {
      this.logger.error('支付宝渠道未装配（配置缺失），回调无法验签')
      return false
    }
    const notification = await provider.parseCallback(body)
    if (!notification)
      return false
    return this.accept(notification, 'alipay')
  }

  /**
   * 受理公共骨架：未支付通知直接应答成功；已支付走 markPaid——
   * applied / duplicate / closed_stale 应答成功（PY9）；金额不符与订单不存在（BusinessError）
   * 同样应答成功（PY8：防重推风暴，资金差异走人工对账）；未知异常应答失败由渠道重推
   */
  private async accept(notification: CallbackParseResult, channel: string): Promise<boolean> {
    if (!notification.paid) {
      this.logger.log(`渠道 ${channel} 未支付通知（${notification.channelStatus}），无需受理：${notification.orderNo}`)
      return true
    }
    try {
      const result = await this.orderService.markPaid(
        notification.orderNo,
        notification.transactionId ?? null,
        notification.paidAmountFen ?? null,
      )
      this.logger.log(`渠道 ${channel} 回调受理（markPaid=${result}）：${notification.orderNo}`)
      return true
    }
    catch (error) {
      if (error instanceof BusinessError) {
        // 金额不符（markPaid 已记 error 需人工核查）/ 订单不存在（重推也无人认领）——均应答成功止推
        this.logger.warn(
          `渠道 ${channel} 回调业务性拒绝（code=${error.code}）：${notification.orderNo}——${error.message}`,
        )
        return true
      }
      this.logger.error(
        `渠道 ${channel} 回调受理异常（应答失败待重推）：${notification.orderNo}`,
        error instanceof Error ? error.stack : undefined,
      )
      return false
    }
  }
}
