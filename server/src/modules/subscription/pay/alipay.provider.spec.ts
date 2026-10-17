import { describe, expect, it } from '@jest/globals'

import { mapAlipayNotification, parseAlipayQueryResult, yuanToFen } from './alipay.provider'

describe('支付宝金额换算（元字符串 → 分，PY5）', () => {
  it('两位小数无损换算', () => {
    expect(yuanToFen('0.01')).toBe(1)
    expect(yuanToFen('12.00')).toBe(1200)
    expect(yuanToFen('199.99')).toBe(19999)
    expect(yuanToFen('1000000.00')).toBe(100000000)
  })

  it('浮点中间误差经 Math.round 消除（0.07 / 0.29 类陷阱值）', () => {
    expect(yuanToFen('0.29')).toBe(29)
    expect(yuanToFen('19.99')).toBe(1999)
  })
})

describe('支付宝查单状态映射（parseAlipayQueryResult）', () => {
  it('TRADE_SUCCESS / TRADE_FINISHED 均视为已支付并携带金额分与流水号', () => {
    const paid = parseAlipayQueryResult({
      code: '10000', trade_status: 'TRADE_SUCCESS', trade_no: 'ALI-1', total_amount: '99.00',
    })
    expect(paid).toMatchObject({ paid: true, transactionId: 'ALI-1', paidAmountFen: 9900, channelStatus: 'TRADE_SUCCESS' })
    const finished = parseAlipayQueryResult({
      code: '10000', trade_status: 'TRADE_FINISHED', trade_no: 'ALI-2', total_amount: '0.01',
    })
    expect(finished.paid).toBe(true)
    expect(finished.paidAmountFen).toBe(1)
  })

  it('WAIT_BUYER_PAY / TRADE_CLOSED 为未支付且不带金额', () => {
    const waiting = parseAlipayQueryResult({ code: '10000', trade_status: 'WAIT_BUYER_PAY' })
    expect(waiting).toMatchObject({ paid: false, channelStatus: 'WAIT_BUYER_PAY' })
    expect(waiting.paidAmountFen).toBeUndefined()
    expect(parseAlipayQueryResult({ code: '10000', trade_status: 'TRADE_CLOSED' }).paid).toBe(false)
  })

  it('code 40004（渠道无此交易）按未支付处理并留痕 sub_code', () => {
    const result = parseAlipayQueryResult({ code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST' })
    expect(result).toMatchObject({ paid: false, channelStatus: 'ACQ.TRADE_NOT_EXIST' })
  })

  it('其他非 10000 code 抛错（渠道侧异常，由调用方按 005200005 或跳过处理）', () => {
    expect(() => parseAlipayQueryResult({ code: '20000', sub_code: 'ISP_UNKNOWN_ERROR' })).toThrow()
  })

  it('已支付但渠道未返回金额时金额为 null（markPaid 侧跳过核对）', () => {
    const result = parseAlipayQueryResult({ code: '10000', trade_status: 'TRADE_SUCCESS', trade_no: 'ALI-3' })
    expect(result.paid).toBe(true)
    expect(result.paidAmountFen).toBeNull()
  })
})

describe('支付宝异步通知报文映射（mapAlipayNotification）', () => {
  it('成功通知提取订单号 / 流水号 / 金额分', () => {
    const result = mapAlipayNotification({
      out_trade_no: 'AH1', trade_no: 'ALI-9', trade_status: 'TRADE_SUCCESS', total_amount: '199.99',
    })
    expect(result).toMatchObject({
      paid: true, orderNo: 'AH1', transactionId: 'ALI-9', paidAmountFen: 19999, channelStatus: 'TRADE_SUCCESS',
    })
  })

  it('未支付状态通知（如 WAIT_BUYER_PAY）不标记 paid（受理侧直接应答成功）', () => {
    const result = mapAlipayNotification({ out_trade_no: 'AH1', trade_status: 'WAIT_BUYER_PAY' })
    expect(result).not.toBeNull()
    expect(result!.paid).toBe(false)
  })

  it('缺少订单号返回 null', () => {
    expect(mapAlipayNotification({ trade_status: 'TRADE_SUCCESS' })).toBeNull()
  })
})
