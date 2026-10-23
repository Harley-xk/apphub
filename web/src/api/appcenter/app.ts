/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用中心应用接口封装：分页 / 注册（响应完整凭证仅此一次）/ 编辑 / 启停 / 凭证重置 / 删除
 */
import type { PageParam, PageResult } from '@/api/http'
import { http } from '@/api/http'

/** 应用信息（后端 AppVo，不含 Secret；时间为毫秒时间戳） */
export interface AppVO {
  id: string
  appKey: string
  name: string
  /** 形态标签：desktop / web / mobile 的组合 */
  appType: string[]
  /** 调用方类型：confidential（有后端）/ public（客户端直连） */
  clientType: string
  /** 技术框架：electron / tauri / custom */
  framework: string | null
  iconUrl: string | null
  description: string | null
  /** 状态：enabled / disabled（停用后开放 API 全部拒绝） */
  status: string
  sort: number
  createTime: number
}

/** 应用精简信息（授权弹窗与订阅页应用筛选的数据源，仅含当前用户可管理应用） */
export interface AppOptionVO {
  id: string
  appKey: string
  name: string
}

/** 应用完整凭证：仅注册 / 重置 Secret 后返回一次（之后不可再查） */
export interface AppCredentialVO {
  id: string
  appKey: string
  appSecret: string
}

/** 应用注册请求 */
export interface AppCreateData {
  name: string
  appType: string[]
  clientType: string
  framework?: string
  iconUrl?: string
  description?: string
  sort?: number
}

/** 应用编辑请求（clientType 创建后不可改） */
export interface AppUpdateData {
  id: string
  name: string
  appType: string[]
  framework?: string
  iconUrl?: string
  description?: string
  sort?: number
}

/** 应用分页查询条件 */
export interface AppPageParam extends Partial<PageParam> {
  name?: string
  status?: string
  clientType?: string
  framework?: string
}

export async function getAppPage(params: AppPageParam): Promise<PageResult<AppVO>> {
  const { data } = await http.get<PageResult<AppVO>>('/appcenter/app', { params })
  return data
}

/** 当前用户可管理的应用精简列表（后端按 appcenter 域数据范围收窄；keyword 匹配名称 / AppKey） */
export async function getAppOptions(keyword?: string): Promise<AppOptionVO[]> {
  const { data } = await http.get<AppOptionVO[]>('/appcenter/app/options', {
    params: { keyword: keyword || undefined },
  })
  return data!
}

export async function getApp(id: string): Promise<AppVO> {
  const { data } = await http.get<AppVO>(`/appcenter/app/${id}`)
  return data!
}

/** 注册应用：响应完整凭证（AppSecret 仅此一次，D22） */
export async function createApp(payload: AppCreateData): Promise<AppCredentialVO> {
  const { data } = await http.post<AppCredentialVO>('/appcenter/app', payload)
  return data!
}

export async function updateApp(payload: AppUpdateData): Promise<void> {
  await http.put<null>(`/appcenter/app/${payload.id}`, payload)
}

export async function updateAppStatus(id: string, status: string): Promise<void> {
  await http.put<null>(`/appcenter/app/${id}/status`, { status })
}

/** 重置 Secret：旧凭证立即失效，响应新完整凭证（仅此一次） */
export async function resetAppSecret(id: string): Promise<AppCredentialVO> {
  const { data } = await http.put<AppCredentialVO>(`/appcenter/app/${id}/secret`)
  return data!
}

export async function deleteApp(id: string): Promise<void> {
  await http.delete<null>(`/appcenter/app/${id}`)
}
