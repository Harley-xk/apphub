/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 终端认证开放接口 DTO：注册 / 登录 / 刷新 / 登出 / 绑定入参与 introspect 出参（统一认证设计 §3.1/§3.2）。
 * 凭证类型合法性（M2 仅 password，0042001）由服务层校验以透出分段业务码
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator'

import { PASSWORD_IDENTIFIER_PATTERN } from '../../member.constants'

/** 密码强度：8-64 位且至少含字母与数字（首期不强制特殊字符，统一认证设计 §3.3） */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/

/** 注册入参 */
export class RegisterMemberDto {
  @ApiProperty({ description: '凭证类型（M2 首期仅 password，其余类型 0042001）' })
  @IsString()
  @MaxLength(16, { message: '凭证类型非法' })
  type!: string

  @ApiProperty({ description: '登录标识（password 类型为自设账号：字母数字下划线 4-32 位）' })
  @IsString()
  @Matches(PASSWORD_IDENTIFIER_PATTERN, { message: '登录标识须为字母数字下划线 4-32 位' })
  identifier!: string

  @ApiProperty({ description: '凭证密文（密码：8-64 位且至少含字母与数字）' })
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: '密码须为 8-64 位且至少包含字母与数字' })
  credential!: string

  @ApiPropertyOptional({ description: '昵称（未填时自动生成兜底）' })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '昵称长度须在 1-64 位之间' })
  nickname?: string
}

/** 登录入参（M2 为 password 类型；phone/email/扫码形态按 M4 接入，结构不变）。
 * 标识与凭证只做宽松长度校验：不存在 / 不匹配统一走 0043001 文案，不向探测者反馈格式正确性 */
export class LoginMemberDto {
  @ApiProperty({ description: '凭证类型' })
  @IsString()
  @MaxLength(16, { message: '凭证类型非法' })
  type!: string

  @ApiProperty({ description: '登录标识' })
  @IsString()
  @Length(1, 128, { message: '登录标识长度非法' })
  identifier!: string

  @ApiProperty({ description: '凭证密文' })
  @IsString()
  @Length(1, 128, { message: '凭证长度非法' })
  credential!: string
}

/** 刷新入参 */
export class RefreshTokenDto {
  @ApiProperty({ description: '刷新令牌（原文，64 位十六进制）' })
  @IsString()
  @Length(64, 64, { message: '刷新令牌格式非法' })
  refreshToken!: string
}

/** 登出入参（定位吊销目标，主张 I5） */
export class LogoutMemberDto {
  @ApiProperty({ description: '刷新令牌（原文，64 位十六进制）' })
  @IsString()
  @Length(64, 64, { message: '刷新令牌格式非法' })
  refreshToken!: string
}

/** 绑定新凭证入参（绑定合并，统一认证设计 §3.2） */
export class BindCredentialDto {
  @ApiProperty({ description: '凭证类型（M2 首期仅 password）' })
  @IsString()
  @MaxLength(16, { message: '凭证类型非法' })
  type!: string

  @ApiProperty({ description: '登录标识' })
  @IsString()
  @Matches(PASSWORD_IDENTIFIER_PATTERN, { message: '登录标识须为字母数字下划线 4-32 位' })
  identifier!: string

  @ApiProperty({ description: '凭证密文（密码）' })
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: '密码须为 8-64 位且至少包含字母与数字' })
  credential!: string
}

/** introspect 出参：认证与订阅校验合一（D7/P4） */
export interface IntrospectVo {
  member: {
    id: string
    nickname: string
    avatarUrl: string | null
    status: string
  }
  /** 订阅状态（M3 起注入真值，periodType 补齐见订阅设计主张 S10） */
  subscription: {
    subscribed: boolean
    planName: string | null
    periodType: string | null
    expireAt: string | null
  }
}

/** 凭证绑定结果（新绑 / 幂等两种成功形态） */
export interface BindResultVo {
  /** added：新增凭证；existed：幂等成功（该凭证已归属当前会员） */
  result: 'added' | 'existed'
}
