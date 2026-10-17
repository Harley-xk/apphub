/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 支付渠道适配器抽象（在线支付渠道接入附录 §4.1）：渠道差异收敛于 Provider，
 * 订单侧只见标准形态（金额统一为分）；回调（渠道调我方）不走本接口，见各 Provider 的回调解析方法
 */

/** 预下单入参（Native / 当面付共用） */
export interface QrOrderParams {
  orderNo: string
  /** 订单金额（分）——支付宝侧换算为元字符串 */
  amountFen: number
  /** 商品描述（计划名 + 应用名） */
  description: string
  /** 订单过期时刻（本地 expireAt，渠道二维码同步过期对齐，PY12） */
  expireAt: Date
  /** 回调地址（PAY_PUBLIC_BASE_URL 已配置时非空，P7） */
  notifyUrl?: string
}

/** 渠道查单标准化结果 */
export interface ChannelQueryResult {
  /** 渠道侧是否已支付 */
  paid: boolean
  /** 渠道流水号（paid 时必有） */
  transactionId?: string
  /** 实收金额（分，paid 时尽量携带；null 表示渠道未返回，markPaid 侧跳过金额核对） */
  paidAmountFen?: number | null
  /** 渠道原始状态（日志留痕） */
  channelStatus: string
}

/** 回调解析结果（两渠道回调统一形态；paid=false 表示未支付通知，受理侧直接应答成功不进 markPaid） */
export interface CallbackParseResult {
  paid: boolean
  orderNo: string
  transactionId?: string
  paidAmountFen?: number | null
  channelStatus: string
}

/** 支付渠道适配器：实现自行包装异常（抛原生 Error 携渠道上下文，由订单侧按路径转 005200005 或忽略） */
export interface PaymentProvider {
  /** 预下单：返回二维码内容串（应用侧自行渲染二维码图片） */
  createQrOrder(params: QrOrderParams): Promise<{ qrCodeUrl: string }>
  /** 渠道查单：返回标准化结果（金额已统一为分） */
  queryOrder(orderNo: string): Promise<ChannelQueryResult>
  /** 关闭渠道侧交易（本地关单时同步对齐；渠道自动过期的实现为空操作） */
  closeChannelOrder(orderNo: string): Promise<void>
}

/** 渠道注册表注入令牌（工厂按配置装配，附录 §4.2） */
export const PAYMENT_PROVIDERS = 'PAYMENT_PROVIDERS'
