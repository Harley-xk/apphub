/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅实例接口封装：分页查询（状态实时推导打标，主张 S2 不落状态列）
 */
import type { PageParam, PageResult } from '@/api/http'
import { http } from '@/api/http'

/** 订阅实例状态（按 expire_at 与当前时刻实时推导） */
export const SUBSCRIPTION_STATE_OPTIONS = [
  { value: 'active', label: '生效中' },
  { value: 'expired', label: '已过期' },
] as const

/** 实例状态中文文案 */
export function subscriptionStateText(state: string): string {
  return SUBSCRIPTION_STATE_OPTIONS.find(option => option.value === state)?.label ?? state
}

/** 订阅实例信息（后端 SubscriptionVo；时间为毫秒时间戳；permanent = 永久档哨兵值打标） */
export interface SubscriptionVO {
  id: string
  memberId: string
  memberNickname: string
  appId: string
  appName: string
  planId: string
  planName: string
  periodType: string
  startAt: number
  expireAt: number
  lastRenewAt: number | null
  state: 'active' | 'expired'
  permanent: boolean
}

/** 订阅实例分页查询条件 */
export interface SubscriptionPageParam extends Partial<PageParam> {
  appId?: string
  memberId?: string
  state?: string
}

export async function getSubscriptionPage(params: SubscriptionPageParam): Promise<PageResult<SubscriptionVO>> {
  const { data } = await http.get<PageResult<SubscriptionVO>>('/subscription/sub', { params })
  return data
}
