/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员管理接口封装：分页 / 详情（凭证清单脱敏）/ 启停 / 删除 / 解绑凭证 / 重置密码（统一认证设计 §3.4）
 */
import type { PageParam, PageResult } from '@/api/http'
import { http } from '@/api/http'

/** 会员信息（后端 MemberVo：手机 / 邮箱为脱敏后的联系标识；时间为毫秒时间戳） */
export interface MemberVO {
  id: string
  nickname: string
  avatarUrl: string | null
  /** 状态：active / disabled（禁用即时吊销全部令牌） */
  status: string
  phone: string | null
  email: string | null
  /** 首次注册来源应用 id（来源统计用，无展示语义） */
  registeredAppId: string | null
  lastLoginAt: number | null
  createTime: number
}

/** 凭证信息（后端 CredentialVo：标识按类型脱敏，密文不出服务） */
export interface CredentialVO {
  id: string
  /** 凭证类型：password / phone / email / wechat / alipay */
  credentialType: string
  identifier: string
  verified: boolean
  lastUsedAt: number | null
  createTime: number
}

/** 会员详情：基本信息 + 凭证清单 */
export interface MemberDetailVO extends MemberVO {
  credentials: CredentialVO[]
}

/** 会员分页查询条件（关键字匹配昵称 / 手机 / 邮箱） */
export interface MemberPageParam extends Partial<PageParam> {
  keyword?: string
}

export async function getMemberPage(params: MemberPageParam): Promise<PageResult<MemberVO>> {
  const { data } = await http.get<PageResult<MemberVO>>('/member', { params })
  return data
}

export async function getMember(id: string): Promise<MemberDetailVO> {
  const { data } = await http.get<MemberDetailVO>(`/member/${id}`)
  return data!
}

/** 禁用会员：全部令牌即时吊销（需重新登录） */
export async function disableMember(id: string): Promise<void> {
  await http.put<null>(`/member/${id}/disable`)
}

/** 启用会员：仅恢复状态，不签发令牌 */
export async function enableMember(id: string): Promise<void> {
  await http.put<null>(`/member/${id}/enable`)
}

/** 删除会员（软删：凭证标识不释放，防抢注） */
export async function deleteMember(id: string): Promise<void> {
  await http.delete<null>(`/member/${id}`)
}

/** 解绑凭证（最后一条密码凭证后端拒绝） */
export async function unbindCredential(memberId: string, credentialId: string): Promise<void> {
  await http.delete<null>(`/member/${memberId}/credential/${credentialId}`)
}

/** 重置密码：新密码明文仅此一次返回，旧会话全部吊销 */
export async function resetMemberPassword(id: string): Promise<{ password: string }> {
  const { data } = await http.post<{ password: string }>(`/member/${id}/password/reset`)
  return data!
}
