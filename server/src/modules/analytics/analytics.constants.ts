/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: analytics 模块公共常量：事件类型、上报窗口与批量上限、匿名会员哨兵、查询区间上限（应用活跃度统计设计 §2~§4）
 */

/** 活跃事件类型：启动 / 窗口激活 / 退出（AD3 / AD8） */
export const ACTIVITY_EVENT_TYPE = {
  START: 'start',
  ACTIVATE: 'activate',
  STOP: 'stop',
} as const

/** 事件类型取值域 */
export const ACTIVITY_EVENT_TYPES: readonly string[] = Object.values(ACTIVITY_EVENT_TYPE)

/** 单次上报事件条数上限（AT7） */
export const REPORT_MAX_EVENTS = 50

/** 事件时间窗：早于 7 天前的事件丢弃（AT4 / AT7） */
export const REPORT_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000

/** 事件时间窗：晚于服务器时间 5 分钟的事件丢弃（容忍轻微时钟漂移，AT4） */
export const REPORT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

/**
 * 匿名会员哨兵：全零 UUID。
 * 日表唯一键含 member_id，PG 唯一索引对 NULL 不判等，故匿名行以哨兵填充（AT10，同 app_package.arch 先例）。
 * 该值只由服务端写入，不接收客户端输入，不参与 DTO 的 UUID 合法性校验。
 */
export const ANONYMOUS_MEMBER_ID = '00000000-0000-0000-0000-000000000000'

/** 设备标识格式：客户端生成的 UUID / 随机串，限制在 URL 安全的字符集（错误码 007300001 的判定依据） */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/** 查询区间上限（自然日，含首尾；Q3） */
export const ACTIVITY_QUERY_MAX_DAYS = 180

/** 日表默认保留月数（AT14 / Q2） */
export const ACTIVITY_DEFAULT_RETENTION_MONTHS = 24

/** 分布查询维度取值域 */
export const ACTIVITY_DISTRIBUTION_DIMENSIONS = ['platform', 'arch', 'version'] as const

/** 分布维度类型 */
export type ActivityDistributionDimension = (typeof ACTIVITY_DISTRIBUTION_DIMENSIONS)[number]

/** 分布维度 → 实体列名（白名单映射，禁止把请求参数拼进 SQL） */
export const ACTIVITY_DIMENSION_COLUMN: Readonly<Record<ActivityDistributionDimension, string>> = {
  platform: 'd.platform',
  arch: 'd.arch',
  version: 'd.clientVersion',
}
