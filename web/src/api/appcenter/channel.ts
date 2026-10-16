/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 更新通道接口封装：应用内通道的列表 / 创建 / 编辑 / 删除（stable 通道后端拒绝删除）
 */
import { http } from '@/api/http'

/** 通道信息（后端 ChannelVo；时间为毫秒时间戳） */
export interface ChannelVO {
  id: string
  appId: string
  /** 通道代码（应用内唯一，创建后不可改——参与 OSS 对象键与 feed URL） */
  code: string
  name: string
  /** 状态：enabled / disabled（停用后该通道更新检测返回无更新） */
  status: string
  sort: number
  createTime: number
}

/** 通道创建请求 */
export interface ChannelCreateData {
  code: string
  name: string
  sort?: number
}

/** 通道编辑请求（code 不可改） */
export interface ChannelUpdateData {
  name: string
  status?: string
  sort?: number
}

export async function getChannelList(appId: string): Promise<ChannelVO[]> {
  const { data } = await http.get<ChannelVO[]>(`/appcenter/app/${appId}/channel`)
  return data!
}

export async function createChannel(appId: string, payload: ChannelCreateData): Promise<string> {
  const { data } = await http.post<string>(`/appcenter/app/${appId}/channel`, payload)
  return data!
}

export async function updateChannel(appId: string, channelId: string, payload: ChannelUpdateData): Promise<void> {
  await http.put<null>(`/appcenter/app/${appId}/channel/${channelId}`, payload)
}

export async function deleteChannel(appId: string, channelId: string): Promise<void> {
  await http.delete<null>(`/appcenter/app/${appId}/channel/${channelId}`)
}
