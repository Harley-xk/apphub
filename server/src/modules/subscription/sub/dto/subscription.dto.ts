/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅实例管理端 DTO：分页与状态筛选（含已过期打标，主张 S2 状态实时推导不落列）
 */
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsUUID } from 'class-validator'

import { PageParamDto } from '../../../../common/dto/page.dto'

/** 订阅实例分页查询入参 */
export class SubscriptionPageDto extends PageParamDto {
  @ApiPropertyOptional({ description: '应用 id' })
  @IsOptional()
  @IsUUID()
  appId?: string

  @ApiPropertyOptional({ description: '会员 id' })
  @IsOptional()
  @IsUUID()
  memberId?: string

  @ApiPropertyOptional({ description: '订阅状态（active 有效 / expired 已过期，实时推导）' })
  @IsOptional()
  @IsIn(['active', 'expired'])
  state?: string
}

/** 订阅实例列表行 */
export interface SubscriptionVo {
  id: string
  memberId: string
  memberNickname: string
  appId: string
  appName: string
  planId: string
  planName: string
  periodType: string
  startAt: Date
  expireAt: Date
  lastRenewAt: Date | null
  /** 状态打标（查询层按 expire_at > now 推导，主张 S2） */
  state: 'active' | 'expired'
  /** 是否永久档（expire_at 年份 ≥ 2999） */
  permanent: boolean
}

/** introspect 订阅段出参（对齐统一认证设计 §3.1，periodType 补齐见主张 S10） */
export interface IntrospectSubscriptionVo {
  subscribed: boolean
  planName: string | null
  periodType: string | null
  expireAt: string | null
}
