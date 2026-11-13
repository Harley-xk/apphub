/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 应用活跃度接口封装：概览与维度分布 VO 类型及查询函数（设计 §5）
 */
import { http } from '@/api/http'

/** 分布维度 */
export type ActivityDimension = 'platform' | 'arch' | 'version'

/** 区间查询入参（日期为 Asia/Shanghai 自然日，含首尾） */
export interface ActivityQueryParam {
  appId?: string
  startDate: string
  endDate: string
  platform?: string
  arch?: string
  version?: string
}

/** 逐日趋势点 */
export interface ActivityTrendPointVO {
  date: string
  deviceDau: number
  memberDau: number
}

/** 概览出参 */
export interface ActivitySummaryVO {
  /** 区间最后一天的设备日活 */
  deviceDau: number
  /** 区间最后一天的会员日活（登录态活跃） */
  memberDau: number
  /** 区间去重设备数 */
  deviceActive: number
  /** 区间去重会员数 */
  memberActive: number
  /** 区间内首次出现窗口激活的设备数 */
  newDevices: number
  /** 定长 N 点趋势（缺日补 0） */
  trend: ActivityTrendPointVO[]
}

/** 维度分布条目 */
export interface ActivityDistributionItemVO {
  key: string
  deviceCount: number
  memberCount: number
}

/** 拉取活跃度概览 */
export async function getActivitySummary(params: ActivityQueryParam): Promise<ActivitySummaryVO> {
  const { data } = await http.get<ActivitySummaryVO>('/analytics/activity/summary', { params })
  return data
}

/** 拉取维度分布 */
export async function getActivityDistribution(
  params: ActivityQueryParam & { dimension: ActivityDimension },
): Promise<ActivityDistributionItemVO[]> {
  const { data } = await http.get<ActivityDistributionItemVO[]>('/analytics/activity/distribution', { params })
  return data
}
