import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AlipayProvider } from './alipay.provider'
import { PayCallbackService } from './pay-callback.service'
import { PaymentProviderRegistry } from './payment-provider.registry'
import { WechatPayProvider } from './wechat-pay.provider'
import { BusinessError } from '../../../common/exceptions/business-error'
import type { OrderService } from '../order/order.service'

/**
 * 装配真实 Provider 实例（回调受理以 instanceof 识别渠道实现）——密钥用临时生成的
 * RSA 对落临时目录，spy 其 parseCallback 隔离验签边界（验签本身是 SDK 责任）
 */
describe('渠道回调受理（附录 §4.4 / PY8 / PY9）', () => {
  let workDir: string
  let wechat: WechatPayProvider
  let alipay: AlipayProvider

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pay-callback-spec-'))
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const privateKeyPath = join(workDir, 'apiclient_key.pem')
    writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs1', format: 'pem' }))
    wechat = new WechatPayProvider({
      appId: 'wx-app', mchId: '1900000001', certSerial: 'SERIAL',
      privateKeyPath, apiv3Key: 'api-v3-secret-32-bytes!!!!!!',
      publicKeySerial: '', publicKeyPath: '',
    })
    const alipayPublic = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
    const aliPrivatePath = join(workDir, 'ali_priv.pem')
    const aliPublicPath = join(workDir, 'ali_pub.pem')
    writeFileSync(aliPrivatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    writeFileSync(aliPublicPath, alipayPublic.export({ type: 'spki', format: 'pem' }))
    alipay = new AlipayProvider({
      appId: '2021xxx', privateKeyPath: aliPrivatePath, publicKeyPath: aliPublicPath,
      gateway: 'https://openapi.alipay.com/gateway.do',
    })
  })

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  const makeService = (markPaid: jest.Mock, provider?: object) => {
    const registry = {
      getProvider: jest.fn(() => provider),
    } as unknown as PaymentProviderRegistry
    const orderService = { markPaid } as unknown as OrderService
    return new PayCallbackService(orderService, registry)
  }

  it('微信：验签失败应答失败（false），渠道重推', async () => {
    const markPaid = jest.fn()
    const service = makeService(markPaid, wechat)
    jest.spyOn(wechat, 'parseCallback').mockResolvedValue(null)
    await expect(service.handleWechat({}, Buffer.from('{}'))).resolves.toBe(false)
    expect(markPaid).not.toHaveBeenCalled()
  })

  it('微信：未支付通知应答成功且不进 markPaid', async () => {
    const markPaid = jest.fn()
    const service = makeService(markPaid, wechat)
    jest.spyOn(wechat, 'parseCallback').mockResolvedValue({
      paid: false, orderNo: 'AH1', channelStatus: 'NOTPAY',
    })
    await expect(service.handleWechat({}, Buffer.from('{}'))).resolves.toBe(true)
    expect(markPaid).not.toHaveBeenCalled()
  })

  it('微信：markPaid 三态（applied / duplicate / closed_stale）均应答成功（PY9）', async () => {
    for (const result of ['applied', 'duplicate', 'closed_stale'] as const) {
      const markPaid = jest.fn(() => Promise.resolve(result))
      const service = makeService(markPaid, wechat)
      jest.spyOn(wechat, 'parseCallback').mockResolvedValue({
        paid: true, orderNo: 'AH1', transactionId: 'WX-1', paidAmountFen: 100, channelStatus: 'SUCCESS',
      })
      await expect(service.handleWechat({}, Buffer.from('{}'))).resolves.toBe(true)
      expect(markPaid).toHaveBeenCalledWith('AH1', 'WX-1', 100)
    }
  })

  it('微信：金额不符（BusinessError）仍应答成功止推（PY8，资金差异走人工对账）', async () => {
    const markPaid = jest.fn(() => Promise.reject(new BusinessError('支付金额与订单不符')))
    const service = makeService(markPaid, wechat)
    jest.spyOn(wechat, 'parseCallback').mockResolvedValue({
      paid: true, orderNo: 'AH1', transactionId: 'WX-1', paidAmountFen: 1, channelStatus: 'SUCCESS',
    })
    await expect(service.handleWechat({}, Buffer.from('{}'))).resolves.toBe(true)
  })

  it('微信：未知异常（如 DB 故障）应答失败待渠道重推', async () => {
    const markPaid = jest.fn(() => Promise.reject(new Error('connection refused')))
    const service = makeService(markPaid, wechat)
    jest.spyOn(wechat, 'parseCallback').mockResolvedValue({
      paid: true, orderNo: 'AH1', channelStatus: 'SUCCESS',
    })
    await expect(service.handleWechat({}, Buffer.from('{}'))).resolves.toBe(false)
  })

  it('微信：渠道未装配（配置漂移）拒绝受理应答失败', async () => {
    const markPaid = jest.fn()
    const service = makeService(markPaid, undefined)
    await expect(service.handleWechat({}, Buffer.from('{}'))).resolves.toBe(false)
    expect(markPaid).not.toHaveBeenCalled()
  })

  it('支付宝：验签失败应答失败', async () => {
    const markPaid = jest.fn()
    const service = makeService(markPaid, alipay)
    jest.spyOn(alipay, 'parseCallback').mockResolvedValue(null)
    await expect(service.handleAlipay({})).resolves.toBe(false)
  })

  it('支付宝：成功通知受理（markPaid 收到元转分后的金额）', async () => {
    const markPaid = jest.fn(() => Promise.resolve('applied'))
    const service = makeService(markPaid, alipay)
    jest.spyOn(alipay, 'parseCallback').mockResolvedValue({
      paid: true, orderNo: 'AH2', transactionId: 'ALI-1', paidAmountFen: 19999, channelStatus: 'TRADE_SUCCESS',
    })
    await expect(service.handleAlipay({})).resolves.toBe(true)
    expect(markPaid).toHaveBeenCalledWith('AH2', 'ALI-1', 19999)
  })

  it('支付宝：渠道未装配拒绝受理', async () => {
    const service = makeService(jest.fn(), undefined)
    await expect(service.handleAlipay({})).resolves.toBe(false)
  })
})
