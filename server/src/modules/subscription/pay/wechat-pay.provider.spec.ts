import { describe, expect, it } from '@jest/globals'

import { mapWechatNotification, parseWechatQueryResult } from './wechat-pay.provider'

describe('微信查单状态映射（parseWechatQueryResult）', () => {
  it('SUCCESS 视为已支付并携带金额分（微信原生即分）与流水号', () => {
    const paid = parseWechatQueryResult({
      trade_state: 'SUCCESS', transaction_id: 'WX-1', amount: { total: 99000 },
    })
    expect(paid).toMatchObject({ paid: true, transactionId: 'WX-1', paidAmountFen: 99000, channelStatus: 'SUCCESS' })
  })

  it('NOTPAY / CLOSED / USERPAYING 为未支付', () => {
    for (const state of ['NOTPAY', 'CLOSED', 'USERPAYING']) {
      const result = parseWechatQueryResult({ trade_state: state })
      expect(result.paid).toBe(false)
      expect(result.channelStatus).toBe(state)
    }
  })

  it('缺 trade_state 抛错（渠道侧异常形态）', () => {
    expect(() => parseWechatQueryResult({})).toThrow()
    expect(() => parseWechatQueryResult(undefined)).toThrow()
  })

  it('已支付但未返回金额时金额为 null（markPaid 侧跳过核对）', () => {
    const result = parseWechatQueryResult({ trade_state: 'SUCCESS', transaction_id: 'WX-2' })
    expect(result.paid).toBe(true)
    expect(result.paidAmountFen).toBeNull()
  })
})

describe('微信回调通知报文映射（mapWechatNotification）', () => {
  it('SUCCESS 通知提取订单号 / 流水号 / 金额分', () => {
    const result = mapWechatNotification({
      out_trade_no: 'AH1', transaction_id: 'WX-9', trade_state: 'SUCCESS', amount: { total: 100 },
    })
    expect(result).toMatchObject({
      paid: true, orderNo: 'AH1', transactionId: 'WX-9', paidAmountFen: 100, channelStatus: 'SUCCESS',
    })
  })

  it('非 SUCCESS 状态通知不标记 paid（受理侧直接应答成功）', () => {
    const result = mapWechatNotification({ out_trade_no: 'AH1', trade_state: 'NOTPAY' })
    expect(result).not.toBeNull()
    expect(result!.paid).toBe(false)
  })

  it('缺少订单号返回 null', () => {
    expect(mapWechatNotification({ trade_state: 'SUCCESS' })).toBeNull()
  })
})
