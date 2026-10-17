import { describe, expect, it } from '@jest/globals'
import { ConfigService } from '@nestjs/config'

import {
  isAlipayConfigured,
  isAlipayPartiallyFilled,
  isWechatConfigured,
  isWechatPartiallyFilled,
  isWechatPublicKeyMode,
  readAlipayConfig,
  readWechatConfig,
} from './pay-config'

/** 构造指定键值环境的 ConfigService 桩（pay 段；未设键返回 undefined 以还原默认值兜底路径） */
const makeConfig = (values: Record<string, string>): ConfigService =>
  ({ get: (path: string) => values[path] }) as unknown as ConfigService

describe('支付渠道配置判定（附录 §7.2 装配矩阵）', () => {
  it('微信五项齐备视为已配置', () => {
    const config = readWechatConfig(makeConfig({
      'pay.wechat.appId': 'wx123',
      'pay.wechat.mchId': '1900000001',
      'pay.wechat.certSerial': 'SERIAL1',
      'pay.wechat.privateKeyPath': 'D:/keys/apiclient_key.pem',
      'pay.wechat.apiv3Key': 'k32bytessecret',
    }))
    expect(isWechatConfigured(config)).toBe(true)
    expect(isWechatPartiallyFilled(config)).toBe(false)
  })

  it('微信缺任一必配项即未配置；有任一项填写即部分填写', () => {
    const config = readWechatConfig(makeConfig({
      'pay.wechat.appId': 'wx123',
      'pay.wechat.mchId': '1900000001',
    }))
    expect(isWechatConfigured(config)).toBe(false)
    expect(isWechatPartiallyFilled(config)).toBe(true)
  })

  it('微信全空既未配置也非部分填写（干净的未接入态）', () => {
    const config = readWechatConfig(makeConfig({}))
    expect(isWechatConfigured(config)).toBe(false)
    expect(isWechatPartiallyFilled(config)).toBe(false)
  })

  it('微信公钥模式判定：序列号与公钥路径两项配齐才启用（P6）', () => {
    const base = {
      'pay.wechat.appId': 'wx123',
      'pay.wechat.mchId': 'm',
      'pay.wechat.certSerial': 's',
      'pay.wechat.privateKeyPath': 'k',
      'pay.wechat.apiv3Key': 'v',
    }
    expect(isWechatPublicKeyMode(readWechatConfig(makeConfig(base)))).toBe(false)
    expect(isWechatPublicKeyMode(readWechatConfig(makeConfig({
      ...base,
      'pay.wechat.publicKeySerial': 'PUB_KEY_ID_1',
    })))).toBe(false)
    expect(isWechatPublicKeyMode(readWechatConfig(makeConfig({
      ...base,
      'pay.wechat.publicKeySerial': 'PUB_KEY_ID_1',
      'pay.wechat.publicKeyPath': 'D:/keys/pubkey.pem',
    })))).toBe(true)
  })

  it('支付宝三项齐备视为已配置；gateway 有默认值不参与判定', () => {
    const config = readAlipayConfig(makeConfig({
      'pay.alipay.appId': '2021000000000001',
      'pay.alipay.privateKeyPath': 'D:/keys/app_priv.pem',
      'pay.alipay.publicKeyPath': 'D:/keys/ali_pub.pem',
    }))
    expect(isAlipayConfigured(config)).toBe(true)
    expect(config.gateway).toBe('https://openapi.alipay.com/gateway.do')
  })

  it('支付宝部分填写判定', () => {
    expect(isAlipayPartiallyFilled(readAlipayConfig(makeConfig({
      'pay.alipay.appId': '2021000000000001',
    })))).toBe(true)
    expect(isAlipayPartiallyFilled(readAlipayConfig(makeConfig({})))).toBe(false)
  })
})
