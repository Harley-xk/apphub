/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: subscription 模块常量：周期档位、计划状态、订单渠道与状态、永久哨兵与关单参数（订阅与支付设计 §2）
 */
/** 计划周期档位（D8 四档，不支持自定义周期） */
export const PERIOD_TYPES = ['monthly', 'quarterly', 'yearly', 'permanent'] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

/** 周期档位 → 日历月数（permanent 无月数，到期写哨兵值） */
export const PERIOD_MONTHS: Record<Exclude<PeriodType, 'permanent'>, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
}

/** 计划状态：on 在售 / off 下架（下架不可新购，存量订阅不受影响） */
export const PLAN_STATUS = {
  ON: 'on',
  OFF: 'off',
} as const

/** 订单渠道（D3 三通道，wechat / alipay 在线渠道 M5 接入） */
export const ORDER_CHANNEL = {
  WECHAT: 'wechat',
  ALIPAY: 'alipay',
  OFFLINE: 'offline',
} as const

/** 订单状态机：pending 待支付（2h 超时）/ paid 终态（D21 无退款）/ closed 已关闭 */
export const ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  CLOSED: 'closed',
} as const

/** 永久买断到期哨兵值（不用 null，判定统一为 expire_at > now，设计 §2.2） */
export const PERMANENT_EXPIRE_AT = new Date('2999-12-31T23:59:59+00:00')

/** 待支付订单超时关单时长（小时） */
export const ORDER_PAY_TIMEOUT_HOURS = 2

/** 兜底关单扫描间隔（毫秒）：每小时，惰性关单为主路径（主张 S6） */
export const ORDER_SWEEP_INTERVAL_MS = 60 * 60 * 1000
