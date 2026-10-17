/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: Mock 支付渠道（在线支付渠道接入附录 §4.2 / PY7）：非生产环境未配置渠道的降级实现——
 * 预下单返回 mock:// 二维码串（应用侧渲染占位二维码即可验收）；查单恒未支付
 * （Mock 支付经 /api/pay/mock/settle 端点直达 markPaid，不经查单路径）
 */
import { Logger } from '@nestjs/common'

import type { ChannelQueryResult, PaymentProvider, QrOrderParams } from './payment-provider'

export class MockPayProvider implements PaymentProvider {
  private readonly logger: Logger

  constructor(
    /** 渠道名（降级装配保留渠道语义：订单 channel 记 wechat / alipay） */
    private readonly channel: string,
  ) {
    this.logger = new Logger(`MockPayProvider(${channel})`)
    this.logger.warn(`渠道 ${channel} 未配置真实凭据，非生产环境降级 Mock 支付（附录 §7.2）`)
  }

  // 三个方法均无异步动作：去 async 以 Promise.resolve 兑现接口（避免无谓的微任务开销与 require-await 违例）

  createQrOrder(params: QrOrderParams): Promise<{ qrCodeUrl: string }> {
    return Promise.resolve({ qrCodeUrl: `mock://pay/${params.orderNo}` })
  }

  queryOrder(orderNo: string): Promise<ChannelQueryResult> {
    // Mock 支付不经查单路径（settle 端点直达 markPaid），恒返回未支付
    void orderNo
    return Promise.resolve({ paid: false, channelStatus: 'MOCK_NOT_PAID' })
  }

  closeChannelOrder(orderNo: string): Promise<void> {
    // Mock 渠道无渠道侧状态，空操作
    void orderNo
    return Promise.resolve()
  }
}
