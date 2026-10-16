/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅订单管理端 DTO：分页 / 线下备案 / 状态机出参（订阅与支付设计 §3.3、§3.5）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator'

import { PageParamDto } from '../../../../common/dto/page.dto'

/** 订单分页查询入参 */
export class OrderPageDto extends PageParamDto {
  @ApiPropertyOptional({ description: '应用 id' })
  @IsOptional()
  @IsUUID()
  appId?: string

  @ApiPropertyOptional({ description: '会员 id' })
  @IsOptional()
  @IsUUID()
  memberId?: string

  @ApiPropertyOptional({ description: '渠道（wechat / alipay / offline）' })
  @IsOptional()
  @IsIn(['wechat', 'alipay', 'offline'])
  channel?: string

  @ApiPropertyOptional({ description: '状态（pending / paid / closed）' })
  @IsOptional()
  @IsIn(['pending', 'paid', 'closed'])
  status?: string

  @ApiPropertyOptional({ description: '订单号（精确）' })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: '订单号长度非法' })
  orderNo?: string
}

/** 线下收款备案入参（备案即生效 paid，无二次审核——收款事实由经办人负责，设计 §3.3） */
export class OfflineCreateDto {
  @ApiProperty({ description: '会员 id' })
  @IsUUID()
  memberId!: string

  @ApiProperty({ description: '订阅计划 id' })
  @IsUUID()
  planId!: string

  @ApiProperty({ description: '实收金额（分，可与计划价不同——协商价场景以录入为准）' })
  @IsInt()
  @Min(0, { message: '金额不得为负' })
  amount!: number

  @ApiPropertyOptional({ description: '转账流水号（选填）' })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '流水号长度非法' })
  transactionId?: string

  @ApiPropertyOptional({ description: '收款凭证备注' })
  @IsOptional()
  @IsString()
  @Length(0, 512, { message: '备注长度须在 0-512 位之间' })
  offlineNote?: string
}

/** 订单列表行 */
export interface OrderVo {
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
  paidAt: Date | null
  expireAt: Date
  offlineNote: string | null
  createTime: Date
}

/**
 * markPaid 状态机结果（单测模拟回调的断言对象，M5 回调端点按此映射响应）：
 * - applied 首次支付成功（已顺延订阅）
 * - duplicate 幂等命中（已 paid 重复回调，不重复顺延）
 * - closed_stale 超时关单后回调到达（留痕受理，避免渠道重试）
 */
export type MarkPaidResult = 'applied' | 'duplicate' | 'closed_stale'
