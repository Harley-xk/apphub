/*
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台接口封装：聚合概览 VO 类型与查询函数（设计 §4.2）
 */
import { http } from '@/api/http'

/** 统计区间：近 7 天 / 近 30 天（含今天） */
export type DashboardRange = '7d' | '30d'

/** 待办：null 表示当前用户无权查看该块 */
export interface DashboardTodoVO {
  expiringSubscriptions: number | null
  pendingOrders: number | null
  lockedMembers: number | null
}

/** 指标：null 表示当前用户无权查看该块；0 表示有权且确实为 0 */
export interface DashboardMetricsVO {
  appTotal: number | null
  appEnabled: number | null
  versionTotal: number | null
  versionPublished: number | null
  memberTotal: number | null
  memberNewInRange: number | null
  subscriptionActive: number | null
  subscriptionExpiringSoon: number | null
  /** 区间内已支付订单金额合计（分） */
  revenueInRange: number | null
}

/** sparkline：按自然日聚合，缺日补 0，元素个数恰好等于区间天数 */
export interface DashboardSparklineVO {
  memberDaily: Array<{ date: string, count: number }> | null
  revenueDaily: Array<{ date: string, amount: number }> | null
}

/** 最新动态：null 表示无权；空数组表示有权但暂无数据 */
export interface DashboardLatestVO {
  orders: Array<{
    id: string
    orderNo: string
    memberNickname: string
    appName: string
    amount: number
    channel: string
    status: string
    createTime: number
  }> | null
  members: Array<{
    id: string
    nickname: string
    registeredAppName: string | null
    createTime: number
  }> | null
  versions: Array<{
    id: string
    appName: string
    version: string
    status: string
    createTime: number
  }> | null
}

/** 工作台聚合概览 */
export interface DashboardOverviewVO {
  /** 服务端生成时间（毫秒时间戳） */
  generatedAt: number
  range: DashboardRange
  todos: DashboardTodoVO
  metrics: DashboardMetricsVO
  sparkline: DashboardSparklineVO
  latest: DashboardLatestVO
}

/** 拉取工作台聚合概览 */
export async function getDashboardOverview(range: DashboardRange): Promise<DashboardOverviewVO> {
  const { data } = await http.get<DashboardOverviewVO>('/dashboard/overview', { params: { range } })
  return data
}
