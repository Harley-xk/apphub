/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 支付宝当面付渠道适配器（在线支付渠道接入附录 §2.2 / §4）：官方 alipay-sdk 封装——
 * alipay.trade.precreate 预下单 / alipay.trade.query 查单 / checkNotifySignV2 异步通知验签；
 * 金额元字符串 ↔ 分换算集中在适配器内（PY5）
 */
import { Logger } from '@nestjs/common'
import { AlipaySdk } from 'alipay-sdk'
import { readFileSync } from 'node:fs'

import type { AlipayChannelConfig } from './pay-config'
import type {
  CallbackParseResult,
  ChannelQueryResult,
  PaymentProvider,
  QrOrderParams,
} from './payment-provider'
import { ORDER_PAY_TIMEOUT_HOURS } from '../subscription.constants'

/** 元字符串 → 分（Math.round 消浮点误差；渠道金额两位小数，换算无损） */
export function yuanToFen(yuan: string): number {
  return Math.round(Number(yuan) * 100)
}

/** 支付宝查单响应映射（抽纯函数供单测：状态映射分支集中在 SDK 边界内） */
export function parseAlipayQueryResult(raw: Record<string, unknown>): ChannelQueryResult {
  if (raw?.code === '40004') {
    // 渠道侧无此交易（未产生过支付行为）——按未支付处理
    return { paid: false, channelStatus: typeof raw.sub_code === 'string' ? raw.sub_code : 'ACQ.TRADE_NOT_EXIST' }
  }
  if (raw?.code !== '10000')
    throw new Error(`支付宝查单失败：${JSON.stringify(raw)}`)
  const tradeStatus = typeof raw.trade_status === 'string' ? raw.trade_status : 'UNKNOWN'
  const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
  return {
    paid,
    transactionId: typeof raw.trade_no === 'string' ? raw.trade_no : undefined,
    paidAmountFen: paid
      ? (typeof raw.total_amount === 'string' ? yuanToFen(raw.total_amount) : null)
      : undefined,
    channelStatus: tradeStatus,
  }
}

/** 支付宝异步通知报文映射（验签通过后调用；缺订单号返回 null） */
export function mapAlipayNotification(body: Record<string, unknown>): CallbackParseResult | null {
  const orderNo = typeof body.out_trade_no === 'string' ? body.out_trade_no : ''
  if (!orderNo)
    return null
  const tradeStatus = typeof body.trade_status === 'string' ? body.trade_status : 'UNKNOWN'
  const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
  return {
    paid,
    orderNo,
    transactionId: typeof body.trade_no === 'string' ? body.trade_no : undefined,
    paidAmountFen: paid
      ? (typeof body.total_amount === 'string' ? yuanToFen(body.total_amount) : null)
      : undefined,
    channelStatus: tradeStatus,
  }
}

export class AlipayProvider implements PaymentProvider {
  private readonly logger = new Logger(AlipayProvider.name)
  private readonly sdk: AlipaySdk

  constructor(config: AlipayChannelConfig) {
    this.sdk = new AlipaySdk({
      appId: config.appId,
      privateKey: readFileSync(config.privateKeyPath, 'utf-8'),
      // 支付宝公钥：响应验签与异步通知验签
      alipayPublicKey: readFileSync(config.publicKeyPath, 'utf-8'),
      gateway: config.gateway,
      // 保持渠道原生 snake_case 字段（qr_code / trade_status / total_amount），取值口径与附录一致
      camelcase: false,
    })
  }

  async createQrOrder(params: QrOrderParams): Promise<{ qrCodeUrl: string }> {
    const result = await this.sdk.exec('alipay.trade.precreate', {
      bizContent: {
        out_trade_no: params.orderNo,
        // 渠道金额为元字符串（两位小数）
        total_amount: (params.amountFen / 100).toFixed(2),
        subject: params.description,
        // 渠道二维码有效期与本地 2h 关单对齐（PY12）
        timeout_express: `${ORDER_PAY_TIMEOUT_HOURS}h`,
      },
      // notifyUrl 为网关公共参数（SDK 顶层参数自动 snakecase 后拼入 URL）；未配置不传（P7）
      ...(params.notifyUrl ? { notifyUrl: params.notifyUrl } : {}),
    })
    if (result?.code !== '10000' || typeof result.qr_code !== 'string' || !result.qr_code) {
      throw new Error(`支付宝当面付预下单失败：${JSON.stringify(result)}`)
    }
    return { qrCodeUrl: result.qr_code }
  }

  async queryOrder(orderNo: string): Promise<ChannelQueryResult> {
    const raw = await this.sdk.exec('alipay.trade.query', {
      bizContent: { out_trade_no: orderNo },
    })
    return parseAlipayQueryResult(raw)
  }

  closeChannelOrder(orderNo: string): Promise<void> {
    // 渠道单随 timeout_express 自动失效，无需显式关闭（当面付无强制关单语义）
    void orderNo
    return Promise.resolve()
  }

  /**
   * 异步通知验签与解析（附录 §4.4 / PY13）：form-urlencoded 表单体（Nest 已解析为键值对象）
   * → checkNotifySignV2 验签 → 标准化结果；验签失败 / 报文异常返回 null
   */
  parseCallback(body: Record<string, unknown>): Promise<CallbackParseResult | null> {
    // checkNotifySignV2 为同步验签（SDK V2 接口），无 await 动作
    if (!this.sdk.checkNotifySignV2(body)) {
      this.logger.warn('支付宝异步通知验签失败')
      return Promise.resolve(null)
    }
    const notification = mapAlipayNotification(body)
    if (!notification)
      this.logger.warn('支付宝通知报文缺少 out_trade_no')
    return Promise.resolve(notification)
  }
}
