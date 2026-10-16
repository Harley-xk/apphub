/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: subscription 模块错误码常量表（模块段 005，段位登记表见 docs/指南/统一响应与异常处理设计.md）
 */
import { ErrorCode } from '../../common/errors/error-code'

/**
 * subscription 模块（模块段 005）分域错误码。
 *
 * 子域划分：001 计划 / 002 订单 / 003 订阅实例；
 * 数值 = 模块段 3 × 10^8 + 子域号 × 10^5 + 序号（如 500100001）。
 */
export const SubscriptionErrorCode = {
  // ===== 子域 001：计划 =====
  /** 计划不存在 */
  PLAN_NOT_EXISTS: new ErrorCode(500100001, '订阅计划不存在'),
  /** 计划已下架（不可新购） */
  PLAN_OFF_SHELF: new ErrorCode(500100002, '订阅计划已下架'),
  /** 计划不属于该应用（跨域下单校验，设计 §4.2） */
  PLAN_APP_MISMATCH: new ErrorCode(500100003, '订阅计划不属于该应用'),
  // ===== 子域 002：订单 =====
  /** 订单不存在 */
  ORDER_NOT_EXISTS: new ErrorCode(500200001, '订单不存在'),
  /** 订单状态冲突（重复支付 / 关闭已支付订单等） */
  ORDER_STATUS_CONFLICT: new ErrorCode(500200002, '订单状态冲突'),
  /** 订单已关闭（超时关单后支付回调到达，记录并按成功受理避免渠道重试） */
  ORDER_CLOSED_STALE: new ErrorCode(500200003, '订单已关闭，支付结果已留痕'),
  /** 支付金额与订单不符 */
  ORDER_AMOUNT_MISMATCH: new ErrorCode(500200004, '支付金额与订单不符'),
  /** 支付渠道错误 / 预下单失败（在线渠道 M5） */
  ORDER_CHANNEL_ERROR: new ErrorCode(500200005, '支付渠道错误或未接入'),
  // ===== 子域 003：订阅实例 =====
  /** 订阅实例不存在 */
  SUBSCRIPTION_NOT_EXISTS: new ErrorCode(500300001, '订阅实例不存在'),
  /** 周期类续费至永久实例（永久即终态） */
  SUBSCRIPTION_PERIOD_TO_PERMANENT: new ErrorCode(500300002, '永久订阅不支持再续周期'),
  /** 订阅顺延失败（事务异常兜底） */
  SUBSCRIPTION_RENEW_FAILED: new ErrorCode(500300003, '订阅顺延失败'),
} as const
