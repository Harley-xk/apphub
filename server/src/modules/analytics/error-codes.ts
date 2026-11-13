/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: analytics 模块错误码常量表（模块段 007，段位登记表见 docs/指南/统一响应与异常处理设计.md）
 */
import { ErrorCode } from '../../common/errors/error-code'

/**
 * analytics 模块（模块段 007）分域错误码。
 *
 * 子域划分：001 设备 / 002 上报 / 003 活跃度查询（设计 §7.1 预留 003 子域）。
 * 数值 = 模块段 7 × 10^8 + 子域号 × 10^5 + 序号（如 700300001）。
 */
export const AnalyticsErrorCode = {
  // ===== 子域 003：活跃度 =====
  /** 设备标识缺失或格式非法 */
  DEVICE_ID_INVALID: new ErrorCode(700300001, '设备标识缺失或格式非法'),
  /** 单次上报事件数超过 50 条 */
  REPORT_TOO_MANY_EVENTS: new ErrorCode(700300002, '单次上报事件数超过 50 条'),
  /** 上报应用不可用（停用 / 不存在，兜底） */
  APP_UNAVAILABLE: new ErrorCode(700300003, '上报应用不可用'),
  /** 查询区间超过 180 天 */
  DATE_RANGE_TOO_LARGE: new ErrorCode(700300004, '查询区间超过 180 天'),
  /** 请求的应用不在数据授权范围内（403） */
  APP_SCOPE_FORBIDDEN: new ErrorCode(700300005, '无权查看该应用的活跃度数据'),
} as const
