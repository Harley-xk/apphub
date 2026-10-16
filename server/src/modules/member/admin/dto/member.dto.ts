/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员管理端 DTO：分页 / 详情（凭证清单脱敏）/ 重置密码出参（统一认证设计 §3.4）
 */
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

import { PageParamDto } from '../../../../common/dto/page.dto'

/** 会员分页查询入参 */
export class MemberPageDto extends PageParamDto {
  @ApiPropertyOptional({ description: '关键字（昵称 / 手机 / 邮箱模糊）' })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '关键字长度非法' })
  keyword?: string
}

/** 凭证出参（脱敏：手机 / 邮箱 / 第三方标识打码，密文永不返回） */
export interface CredentialVo {
  id: string
  credentialType: string
  /** 脱敏后的标识（password 为自设账号原样；phone 138****1234；email a***@xx.com；openid 前后段保留） */
  identifier: string
  verified: boolean
  lastUsedAt: Date | null
  createTime: Date
}

/** 会员列表行 */
export interface MemberVo {
  id: string
  nickname: string
  avatarUrl: string | null
  status: string
  /** 手机号（脱敏，无手机凭证为 null） */
  phone: string | null
  /** 邮箱（脱敏，无邮箱凭证为 null） */
  email: string | null
  registeredAppId: string | null
  lastLoginAt: Date | null
  createTime: Date
}

/** 会员详情（含凭证清单） */
export interface MemberDetailVo extends MemberVo {
  credentials: CredentialVo[]
}

/** 重置密码出参（新密码明文仅此一次返回） */
export interface ResetPasswordVo {
  password: string
}
