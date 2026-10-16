/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅订单接口封装：分页 / 线下收款备案 / 手动关单（订阅与支付设计 §3.5）；在线支付端点 M5 随 SDK 交付
 */
import type { PageParam, PageResult } from '@/api/http'
import { http } from '@/api/http'

/** 支付渠道（在线渠道 wechat / alipay 由 M5 回调链路产生，本期仅 offline） */
export const ORDER_CHANNEL_OPTIONS = [
  { value: 'wechat', label: '微信' },
  { value: 'alipay', label: '支付宝' },
  { value: 'offline', label: '线下备案' },
] as const

/** 订单状态机（pending 待支付 → paid 已支付 / closed 已关闭） */
export const ORDER_STATUS_OPTIONS = [
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'closed', label: '已关闭' },
] as const

/** 渠道中文文案 */
export function orderChannelText(channel: string): string {
  return ORDER_CHANNEL_OPTIONS.find(option => option.value === channel)?.label ?? channel
}

/** 状态中文文案 */
export function orderStatusText(status: string): string {
  return ORDER_STATUS_OPTIONS.find(option => option.value === status)?.label ?? status
}

/** 订单信息（后端 OrderVo；金额为分，时间为毫秒时间戳；快照字段保证计划删除后订单仍可追溯） */
export interface OrderVO {
  id: string
  orderNo: string
  memberId: string
  memberNickname: string
  appId: string
  appName: string
  planId: string
  planName: string
  periodType: string
  amount: number
  channel: string
  status: string
  transactionId: string | null
  paidAt: number | null
  /** 待支付过期时间（惰性关单 + 定时兜底的判断基准） */
  expireAt: number
  offlineNote: string | null
  createTime: number
}

/** 订单分页查询条件 */
export interface OrderPageParam extends Partial<PageParam> {
  appId?: string
  memberId?: string
  channel?: string
  status?: string
  orderNo?: string
}

/** 线下收款备案请求（备案即生效 paid，订阅即时顺延；金额可与计划价不同——协商价场景） */
export interface OfflineCreateData {
  memberId: string
  planId: string
  amount: number
  transactionId?: string
  offlineNote?: string
}

export async function getOrderPage(params: OrderPageParam): Promise<PageResult<OrderVO>> {
  const { data } = await http.get<PageResult<OrderVO>>('/subscription/order', { params })
  return data
}

/** 线下收款备案：响应即已支付订单（回显订单号供对账） */
export async function createOfflineOrder(payload: OfflineCreateData): Promise<OrderVO> {
  const { data } = await http.post<OrderVO>('/subscription/order/offline', payload)
  return data!
}

/** 手动关闭待支付订单（非 pending 后端拒绝） */
export async function closeOrder(id: string): Promise<void> {
  await http.post<null>(`/subscription/order/${id}/close`)
}
