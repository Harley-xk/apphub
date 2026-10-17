/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 微信支付 Native 渠道适配器（在线支付渠道接入附录 §2.1 / §4.3）：SDK wechatpay-node-v3 封装——
 * 预下单 / 查单 / 关单 + 回调验签解密；验签凭据双模（P6）：公钥模式注入 SDK 证书表（子类合法访问 protected static），
 * 平台证书模式由 SDK 在 serial 未命中时自动拉取
 */
import { Logger } from '@nestjs/common'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingHttpHeaders } from 'node:http'
import Pay from 'wechatpay-node-v3'

import type { WechatPayChannelConfig } from './pay-config'
import { isWechatPublicKeyMode } from './pay-config'
import type {
  CallbackParseResult,
  ChannelQueryResult,
  PaymentProvider,
  QrOrderParams,
} from './payment-provider'

/** SDK Native 下单参数类型（export = 模块无具名导出，经方法签名提取） */
type WechatNativeParams = Parameters<Pay['transactions_native']>[0]

/**
 * 暴露静态证书表注入能力的 SDK 子类（protected static 经子类合法访问，PY6）：
 * 公钥模式下把「公钥序列号 → 公钥 PEM」写入 Pay.certificates，
 * verifySign 按 Wechatpay-Serial 头取用时直接命中（不触发自动拉取，注入条目不被覆盖）
 */
class WxPayWithInject extends Pay {
  injectVerifyKey(serial: string, publicKeyPem: string): void {
    // SDK 内部 certificates 为「serial → PEM 字符串」的普通对象（已核实 verifySign 取值形态）
    WxPayWithInject.certificates[serial] = publicKeyPem
  }
}

/** 微信回调通知解密后的业务报文（v3 支付结果通知） */
export interface WechatPayNotification {
  out_trade_no?: string
  transaction_id?: string
  trade_state?: string
  amount?: { total?: number }
}

/** 微信查单响应映射（SDK 统一 { status, data } 包装，此处取 data；抽纯函数供单测） */
export function parseWechatQueryResult(data: unknown): ChannelQueryResult {
  const raw = (data ?? {}) as WechatPayNotification & Record<string, unknown>
  const tradeState = raw.trade_state
  if (!tradeState)
    throw new Error(`微信查单未返回 trade_state：${JSON.stringify(raw)}`)
  return {
    paid: tradeState === 'SUCCESS',
    transactionId: raw.transaction_id,
    paidAmountFen: tradeState === 'SUCCESS' ? (raw.amount?.total ?? null) : undefined,
    channelStatus: tradeState,
  }
}

/** 微信回调通知报文映射（验签解密后调用；缺订单号返回 null） */
export function mapWechatNotification(notification: WechatPayNotification): CallbackParseResult | null {
  const orderNo = notification.out_trade_no
  if (!orderNo)
    return null
  const paid = notification.trade_state === 'SUCCESS'
  return {
    paid,
    orderNo,
    transactionId: notification.transaction_id,
    paidAmountFen: paid ? (notification.amount?.total ?? null) : undefined,
    channelStatus: notification.trade_state ?? 'UNKNOWN',
  }
}

export class WechatPayProvider implements PaymentProvider {
  private readonly logger = new Logger(WechatPayProvider.name)
  private readonly wxpay: WxPayWithInject

  constructor(private readonly config: WechatPayChannelConfig) {
    const privateKeyPem = readFileSync(config.privateKeyPath)
    this.wxpay = new WxPayWithInject({
      appid: config.appId,
      mchid: config.mchId,
      serial_no: config.certSerial,
      // 商户 API 证书公钥由私钥推导（apiclient_cert.pem 与 apiclient_key.pem 公钥部分一致，SPKI 等价）
      publicKey: Buffer.from(
        createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }) as string,
        'utf-8',
      ),
      privateKey: privateKeyPem,
      // APIv3 密钥：回调解密与验签时平台证书自动拉取兜底
      key: config.apiv3Key,
    })
    if (isWechatPublicKeyMode(config)) {
      // 公钥模式（P6 / PY6）：注入即生效，SDK 不再自动拉取平台证书
      this.wxpay.injectVerifyKey(config.publicKeySerial, readFileSync(config.publicKeyPath, 'utf-8'))
      this.logger.log('微信回调验签：公钥模式（注入微信支付公钥）')
    }
    else {
      this.logger.log('微信回调验签：平台证书模式（首次验签时自动拉取平台证书）')
    }
  }

  async createQrOrder(params: QrOrderParams): Promise<{ qrCodeUrl: string }> {
    // SDK 统一返回 { status, data }（data 为 v3 响应体）；notify_url 未配置不传
    // （undefined 键 JSON 序列化自动丢弃，回落商户平台默认，P7；类型上必填故整体断言）
    const result = await this.wxpay.transactions_native({
      description: params.description,
      out_trade_no: params.orderNo,
      // 渠道二维码过期与本地 2h 关单对齐（PY12）；RFC3339 格式
      time_expire: params.expireAt.toISOString(),
      ...(params.notifyUrl ? { notify_url: params.notifyUrl } : {}),
      amount: { total: params.amountFen },
    } as WechatNativeParams)
    // SDK 返回统一 { status, data } 包装且 data 为宽松类型，code_url 取值后经运行时形态校验收敛
    const data: unknown = result?.data
    const codeUrl = (data as { code_url?: unknown } | null | undefined)?.code_url
    if (typeof codeUrl !== 'string' || !codeUrl) {
      throw new Error(`微信 Native 预下单失败：${JSON.stringify(result)}`)
    }
    return { qrCodeUrl: codeUrl }
  }

  async queryOrder(orderNo: string): Promise<ChannelQueryResult> {
    const result = await this.wxpay.query({ out_trade_no: orderNo })
    return parseWechatQueryResult(result?.data)
  }

  async closeChannelOrder(orderNo: string): Promise<void> {
    // 渠道单随 time_expire 自动失效，此处显式关闭对齐两侧状态（幂等，重复关不报错）
    await this.wxpay.close(orderNo)
  }

  /**
   * 回调验签与解析（附录 §4.4 / PY13）：四头齐取 → verifySign（rawBody 原始字节，main.ts rawBody: true）
   * → decipher_gcm 解密业务报文 → 标准化结果；验签 / 解密 / 报文异常一律返回 null（调用方按失败应答）
   */
  async parseCallback(headers: IncomingHttpHeaders, rawBody: Buffer): Promise<CallbackParseResult | null> {
    const timestamp = this.readHeader(headers, 'wechatpay-timestamp')
    const nonce = this.readHeader(headers, 'wechatpay-nonce')
    const serial = this.readHeader(headers, 'wechatpay-serial')
    const signature = this.readHeader(headers, 'wechatpay-signature')
    if (!timestamp || !nonce || !serial || !signature) {
      this.logger.warn('微信回调缺少 Wechatpay-* 验签头')
      return null
    }
    const body = rawBody.toString('utf-8')
    let verified = false
    try {
      // 显式传 apiSecret：serial 未命中证书表时 SDK 自动拉取平台证书需要它
      verified = await this.wxpay.verifySign({ timestamp, nonce, body, serial, signature, apiSecret: this.config.apiv3Key })
    }
    catch (error) {
      this.logger.warn(`微信回调验签异常：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    if (!verified) {
      this.logger.warn('微信回调验签失败（签名不匹配）')
      return null
    }

    let notification: WechatPayNotification | null = null
    try {
      const envelope = JSON.parse(body) as { resource?: { ciphertext?: string, associated_data?: string, nonce?: string } }
      const resource = envelope.resource
      if (!resource?.ciphertext || !resource.associated_data || !resource.nonce) {
        throw new Error('回调报文缺少 resource 密文段')
      }
      notification = this.wxpay.decipher_gcm<WechatPayNotification>(
        resource.ciphertext,
        resource.associated_data,
        resource.nonce,
        this.config.apiv3Key,
      )
    }
    catch (error) {
      this.logger.warn(`微信回调解密 / 解析失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    const result = mapWechatNotification(notification)
    if (!result)
      this.logger.warn('微信回调报文缺少 out_trade_no')
    return result
  }

  private readHeader(headers: IncomingHttpHeaders, name: string): string | null {
    const value = headers[name]
    return typeof value === 'string' && value !== '' ? value : null
  }
}
