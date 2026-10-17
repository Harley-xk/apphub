/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 支付渠道配置读取与齐备判定（在线支付渠道接入附录 §7）：按渠道独立判定（P10），
 * 齐备 / 部分填写 / 全空三态驱动装配矩阵（生产 fail-fast、非生产降级 Mock）
 */
import type { ConfigService } from '@nestjs/config'

/** 微信支付渠道配置（五项齐备视为已配置；公钥两项为可选附加） */
export interface WechatPayChannelConfig {
  appId: string
  mchId: string
  /** 商户 API 证书序列号 */
  certSerial: string
  /** 商户 API 私钥文件路径（apiclient_key.pem） */
  privateKeyPath: string
  /** APIv3 密钥（回调解密 / 平台证书下载） */
  apiv3Key: string
  /** 公钥模式（2024 后新商户）：公钥序列号（PUB_KEY_ID_ 开头） */
  publicKeySerial: string
  /** 公钥模式：微信支付公钥文件路径 */
  publicKeyPath: string
}

/** 支付宝渠道配置（三项齐备视为已配置；gateway 有默认值不参与判定） */
export interface AlipayChannelConfig {
  appId: string
  /** 应用私钥文件路径 */
  privateKeyPath: string
  /** 支付宝公钥文件路径（异步通知验签） */
  publicKeyPath: string
  /** 网关（默认正式网关，沙箱联调改沙箱网关） */
  gateway: string
}

/** 从 ConfigService 读取渠道配置（业务代码不直接读 process.env） */
export function readWechatConfig(configService: ConfigService): WechatPayChannelConfig {
  return {
    appId: configService.get<string>('pay.wechat.appId') ?? '',
    mchId: configService.get<string>('pay.wechat.mchId') ?? '',
    certSerial: configService.get<string>('pay.wechat.certSerial') ?? '',
    privateKeyPath: configService.get<string>('pay.wechat.privateKeyPath') ?? '',
    apiv3Key: configService.get<string>('pay.wechat.apiv3Key') ?? '',
    publicKeySerial: configService.get<string>('pay.wechat.publicKeySerial') ?? '',
    publicKeyPath: configService.get<string>('pay.wechat.publicKeyPath') ?? '',
  }
}

export function readAlipayConfig(configService: ConfigService): AlipayChannelConfig {
  return {
    appId: configService.get<string>('pay.alipay.appId') ?? '',
    privateKeyPath: configService.get<string>('pay.alipay.privateKeyPath') ?? '',
    publicKeyPath: configService.get<string>('pay.alipay.publicKeyPath') ?? '',
    gateway: configService.get<string>('pay.alipay.gateway') ?? 'https://openapi.alipay.com/gateway.do',
  }
}

/** 微信渠道是否齐备（五项必填全非空） */
export function isWechatConfigured(config: WechatPayChannelConfig): boolean {
  return Boolean(
    config.appId
    && config.mchId
    && config.certSerial
    && config.privateKeyPath
    && config.apiv3Key,
  )
}

/** 微信渠道是否部分填写（有任一项非空但不齐备——配置错误形态） */
export function isWechatPartiallyFilled(config: WechatPayChannelConfig): boolean {
  return !isWechatConfigured(config)
    && Boolean(
      config.appId
      || config.mchId
      || config.certSerial
      || config.privateKeyPath
      || config.apiv3Key
      || config.publicKeySerial
      || config.publicKeyPath,
    )
}

/** 微信是否按公钥模式验签（两项附加配置配齐即公钥模式，否则平台证书模式，P6） */
export function isWechatPublicKeyMode(config: WechatPayChannelConfig): boolean {
  return Boolean(config.publicKeySerial && config.publicKeyPath)
}

/** 支付宝渠道是否齐备（三项必填全非空） */
export function isAlipayConfigured(config: AlipayChannelConfig): boolean {
  return Boolean(config.appId && config.privateKeyPath && config.publicKeyPath)
}

/** 支付宝渠道是否部分填写 */
export function isAlipayPartiallyFilled(config: AlipayChannelConfig): boolean {
  return !isAlipayConfigured(config) && Boolean(config.appId || config.privateKeyPath || config.publicKeyPath)
}
