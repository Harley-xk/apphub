/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 支付渠道注册表（在线支付渠道接入附录 §4.2）：channel → Provider 映射，
 * 由模块工厂按配置装配（齐备装真实渠道 / 非生产降级 Mock / 生产未配不注册）；
 * 附带回调地址拼装（PAY_PUBLIC_BASE_URL，P7）
 */
import { ORDER_CHANNEL } from '../subscription.constants'
import type { PaymentProvider } from './payment-provider'

export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>()

  constructor(
    /** 回调公网地址（空串表示未配置——预下单不传 notify_url，回落渠道控制台默认） */
    private readonly publicBaseUrl: string,
  ) {}

  /** 注册渠道适配器（装配期调用） */
  register(channel: string, provider: PaymentProvider): void {
    this.providers.set(channel, provider)
  }

  /** 渠道是否已注册（生产未配置渠道为 false，下单报 005200005，P10） */
  hasChannel(channel: string): boolean {
    return this.providers.has(channel)
  }

  /** 取渠道适配器（未注册返回 undefined，调用方按防御分支处理） */
  getProvider(channel: string): PaymentProvider | undefined {
    return this.providers.get(channel)
  }

  /** 回调地址（配置了公网基址才有值；渠道名即回调路由段，附录 §5.3） */
  buildNotifyUrl(channel: string): string | undefined {
    if (!this.publicBaseUrl)
      return undefined
    return `${this.publicBaseUrl.replace(/\/+$/, '')}/api/pay/callback/${channel}`
  }
}

/** 渠道名 → 常量（回调路由 / 装配共用；抽出避免字符串漂移） */
export const PAY_CHANNELS = [ORDER_CHANNEL.WECHAT, ORDER_CHANNEL.ALIPAY] as const
