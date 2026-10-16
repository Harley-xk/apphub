/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅计划接口封装：分页 / 新增 / 编辑 / 删除（订阅与支付设计 §3.5）；durationMonths 由服务端按档位映射
 */
import type { PageParam, PageResult } from '@/api/http'
import { http } from '@/api/http'

/** 周期档位（后端 PERIOD_TYPES 四档；permanent 永久档 durationMonths 为空） */
export const PERIOD_TYPE_OPTIONS = [
  { value: 'monthly', label: '月付' },
  { value: 'quarterly', label: '季付' },
  { value: 'yearly', label: '年付' },
  { value: 'permanent', label: '永久' },
] as const

/** 档位中文文案（表格 / 弹窗共用取值域） */
export function periodTypeText(periodType: string): string {
  return PERIOD_TYPE_OPTIONS.find(option => option.value === periodType)?.label ?? periodType
}

/** 计划信息（后端 PlanVo；价格为分，时间为毫秒时间戳） */
export interface PlanVO {
  id: string
  appId: string
  appName: string
  name: string
  periodType: string
  durationMonths: number | null
  price: number
  originalPrice: number | null
  /** 状态：on 在售 / off 下架 */
  status: string
  sort: number
  remark: string | null
  createTime: number
}

/** 计划分页查询条件 */
export interface PlanPageParam extends Partial<PageParam> {
  appId?: string
  keyword?: string
  status?: string
}

/** 计划新增请求（编辑归属不可变更） */
export interface PlanCreateData {
  appId: string
  name: string
  periodType: string
  price: number
  originalPrice?: number
  sort?: number
  remark?: string
}

/** 计划编辑请求（改名改价只影响此后新订单，status 控制上下架） */
export interface PlanUpdateData {
  name: string
  periodType: string
  price: number
  status: string
  originalPrice?: number
  sort?: number
  remark?: string
}

export async function getPlanPage(params: PlanPageParam): Promise<PageResult<PlanVO>> {
  const { data } = await http.get<PageResult<PlanVO>>('/subscription/plan', { params })
  return data
}

export async function createPlan(payload: PlanCreateData): Promise<string> {
  const { data } = await http.post<string>('/subscription/plan', payload)
  return data!
}

export async function updatePlan(id: string, payload: PlanUpdateData): Promise<void> {
  await http.put<null>(`/subscription/plan/${id}`, payload)
}

/** 删除计划（软删，存量订阅不受影响） */
export async function deletePlan(id: string): Promise<void> {
  await http.delete<null>(`/subscription/plan/${id}`)
}
