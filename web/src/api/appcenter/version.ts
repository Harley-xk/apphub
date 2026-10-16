/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 版本接口封装：应用内分页 / 创建草稿 / 编辑（状态机分流）/ 发布 / 下线 / 删除（仅草稿）
 */
import type { PageParam, PageResult } from '@/api/http'
import { http } from '@/api/http'

/** 版本信息（后端 VersionVo，通道信息由服务层回填；时间为毫秒时间戳） */
export interface VersionVO {
  id: string
  appId: string
  channelId: string
  channelCode: string
  channelName: string
  /** 版本号（semver 格式） */
  version: string
  title: string
  notes: string | null
  forceUpdate: boolean
  /** 状态机：draft → published → offline（终态） */
  status: string
  publishedAt: number | null
  createTime: number
}

/** 版本创建请求（channelId 创建后不可改：跨通道发布需新建版本） */
export interface VersionCreateData {
  channelId: string
  version: string
  title: string
  notes?: string
  forceUpdate?: boolean
}

/** 版本编辑请求（version / title 仅 draft 可改，published 传入即被服务端拒绝） */
export interface VersionUpdateData {
  id: string
  version?: string
  title?: string
  notes?: string
  forceUpdate?: boolean
}

/** 版本分页查询条件 */
export interface VersionPageParam extends Partial<PageParam> {
  channelId?: string
  status?: string
}

export async function getVersionPage(appId: string, params: VersionPageParam): Promise<PageResult<VersionVO>> {
  const { data } = await http.get<PageResult<VersionVO>>(`/appcenter/app/${appId}/version`, { params })
  return data
}

export async function createVersion(appId: string, payload: VersionCreateData): Promise<string> {
  const { data } = await http.post<string>(`/appcenter/app/${appId}/version`, payload)
  return data!
}

export async function updateVersion(payload: VersionUpdateData): Promise<void> {
  await http.put<null>(`/appcenter/version/${payload.id}`, payload)
}

export async function deleteVersion(id: string): Promise<void> {
  await http.delete<null>(`/appcenter/version/${id}`)
}

/** 发布版本（前置校验：包记录 / 通道内版本号 / 框架产物完整） */
export async function publishVersion(id: string): Promise<void> {
  await http.post<null>(`/appcenter/version/${id}/publish`)
}

/** 下线版本（终态，更新检测不再返回） */
export async function offlineVersion(id: string): Promise<void> {
  await http.post<null>(`/appcenter/version/${id}/offline`)
}
