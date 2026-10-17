/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 终端认证开放接口 DTO：注册 / 登录 / 刷新 / 登出 / 绑定 / 发码入参与 introspect 出参（统一认证设计 §3.1/§3.2、认证方式扩展设计 §3.3）。
 * 凭证入参统一宽松校验（长度），类型相关的格式与强度校验由服务层分流抛分段业务码（主张 C11——DTO 装饰器无法按运行时 type 分支）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

/** 注册入参（五类型：password=密码 / phone|email=验证码 / wechat|alipay=扫码标识，矩阵见认证方式扩展设计 §3.3） */
export class RegisterMemberDto {
  @ApiProperty({ description: '凭证类型（password / phone / email / wechat / alipay）' })
  @IsString()
  @MaxLength(16, { message: '凭证类型非法' })
  type!: string

  @ApiProperty({ description: '登录标识：password=自设账号 / phone=手机号 / email=邮箱 / wechat=unionid / alipay=支付宝 user_id' })
  @IsString()
  @Length(1, 128, { message: '登录标识长度非法' })
  identifier!: string

  @ApiProperty({ description: '凭证密文：password=密码 / phone|email=6 位验证码 / wechat|alipay=占位 oauth' })
  @IsString()
  @Length(1, 128, { message: '凭证长度非法' })
  credential!: string

  @ApiPropertyOptional({ description: '昵称（未填时自动生成兜底）' })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '昵称长度须在 1-64 位之间' })
  nickname?: string
}

/** 登录入参（五类型矩阵同注册；查无凭证时验证码 / 扫码类型自动注册——登录即注册，主张 C5）。
 * 标识与凭证只做宽松长度校验：password 不存在 / 不匹配统一走 0043001 文案，不向探测者反馈格式正确性 */
export class LoginMemberDto {
  @ApiProperty({ description: '凭证类型' })
  @IsString()
  @MaxLength(16, { message: '凭证类型非法' })
  type!: string

  @ApiProperty({ description: '登录标识' })
  @IsString()
  @Length(1, 128, { message: '登录标识长度非法' })
  identifier!: string

  @ApiProperty({ description: '凭证密文（password=密码 / phone|email=验证码 / wechat|alipay=占位 oauth）' })
  @IsString()
  @Length(1, 128, { message: '凭证长度非法' })
  credential!: string

  @ApiPropertyOptional({ description: '昵称：仅自动注册新会员时生效（扫码 / 验证码登录带出第三方昵称），已存在会员忽略' })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '昵称长度须在 1-64 位之间' })
  nickname?: string
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

/** 绑定新凭证入参（绑定合并，统一认证设计 §3.2；五类型同登录矩阵，验证类凭证为 6 位验证码） */
export class BindCredentialDto {
  @ApiProperty({ description: '凭证类型（password / phone / email / wechat / alipay）' })
  @IsString()
  @MaxLength(16, { message: '凭证类型非法' })
  type!: string

  @ApiProperty({ description: '登录标识' })
  @IsString()
  @Length(1, 128, { message: '登录标识长度非法' })
  identifier!: string

  @ApiProperty({ description: '凭证密文（password=密码 / phone|email=验证码 / wechat|alipay=占位 oauth）' })
  @IsString()
  @Length(1, 128, { message: '凭证长度非法' })
  credential!: string
}

/** 发送验证码入参（认证方式扩展设计 §3.3）：scene 为平台内部枚举，bind 场景触发归属预检（C12） */
export class SendCodeDto {
  @ApiProperty({ description: '验证码类型（phone / email）' })
  @IsString()
  @MaxLength(16, { message: '凭证类型非法' })
  type!: string

  @ApiProperty({ description: '接收标识（手机号 / 邮箱）' })
  @IsString()
  @Length(1, 128, { message: '登录标识长度非法' })
  identifier!: string

  @ApiProperty({ description: '场景（login / register / bind）' })
  @IsIn(['login', 'register', 'bind'], { message: '验证码场景非法' })
  scene!: 'login' | 'register' | 'bind'
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
