import { describe, expect, it, jest } from '@jest/globals'

import { SubscriptionModule } from './subscription.module'

/** 配置桩：按 key 返回预设值（键名与 configuration.ts pay 段对齐） */
function makeModule(values: Record<string, string | number | boolean | undefined>) {
  const config = { get: jest.fn((key: string) => values[key]) }
  const registry = { registerModule: jest.fn() }
  const module = new SubscriptionModule(config as never, registry as never)
  return { module, registry }
}

const WECHAT_OK = {
  'pay.wechat.appId': 'wx-app',
  'pay.wechat.mchId': 'mch',
  'pay.wechat.certSerial': 'serial',
  'pay.wechat.privateKeyPath': '/path/key.pem',
  'pay.wechat.apiv3Key': 'v3key',
}

describe('SubscriptionModule 启动校验（生产 fail-fast，P10 契约守护）', () => {
  it('非生产环境缺渠道配置不应阻断启动', () => {
    const { module } = makeModule({ env: 'development' })
    expect(() => module.onModuleInit()).not.toThrow()
  })

  it('生产环境渠道齐备应正常启动', () => {
    const { module, registry } = makeModule({ env: 'production', ...WECHAT_OK })
    expect(() => module.onModuleInit()).not.toThrow()
    expect(registry.registerModule).toHaveBeenCalled()
  })

  it('生产环境两渠道全部未配应拒绝启动', () => {
    const { module } = makeModule({ env: 'production' })
    expect(() => module.onModuleInit()).toThrow('支付渠道配置缺失')
  })

  it('生产环境微信渠道部分填写应拒绝启动（配置错误不静默降级）', () => {
    const { module } = makeModule({ env: 'production', 'pay.wechat.appId': 'wx-app' })
    expect(() => module.onModuleInit()).toThrow('微信渠道配置不完整')
  })

  it('生产环境支付宝渠道部分填写应拒绝启动', () => {
    const { module } = makeModule({ env: 'production', 'pay.alipay.appId': 'ali-app' })
    expect(() => module.onModuleInit()).toThrow('支付宝渠道配置不完整')
  })
})

describe('ALLOW_CHANNEL_FALLBACK 开关（上线批次 DEP-5）', () => {
  it('生产环境开启开关且两渠道全未配应降级启动不抛错', () => {
    const { module } = makeModule({ env: 'production', channelFallback: true })
    expect(() => module.onModuleInit()).not.toThrow()
  })

  it('开关不豁免部分填写（配置错误照常 fail-fast）', () => {
    const { module } = makeModule({ env: 'production', channelFallback: true, 'pay.wechat.appId': 'wx-app' })
    expect(() => module.onModuleInit()).toThrow('微信渠道配置不完整')
  })
})
