/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅计划管理端 DTO：分页 / 新增 / 修改（订阅与支付设计 §3.5）；durationMonths 由服务端按档位映射，不收前端值
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'

import { PageParamDto } from '../../../../common/dto/page.dto'
import { PERIOD_TYPES } from '../../subscription.constants'

/** 计划分页查询入参 */
export class PlanPageDto extends PageParamDto {
  @ApiPropertyOptional({ description: '应用 id' })
  @IsOptional()
  @IsUUID()
  appId?: string

  @ApiPropertyOptional({ description: '关键字（计划名模糊）' })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '关键字长度非法' })
  keyword?: string

  @ApiPropertyOptional({ description: '状态（on / off）' })
  @IsOptional()
  @IsIn(['on', 'off'])
  status?: string
}

/** 计划新增入参 */
export class CreatePlanDto {
  @ApiProperty({ description: '所属应用 id' })
  @IsUUID()
  appId!: string

  @ApiProperty({ description: '计划名（如「专业版 · 年付」）' })
  @IsString()
  @Length(1, 64, { message: '计划名长度须在 1-64 位之间' })
  name!: string

  @ApiProperty({ description: '周期档位（monthly / quarterly / yearly / permanent）' })
  @IsIn(PERIOD_TYPES)
  periodType!: string

  @ApiProperty({ description: '现价（单位分，整数）' })
  @IsInt()
  @Min(0, { message: '价格不得为负' })
  price!: number

  @ApiPropertyOptional({ description: '划线原价（分，展示用）' })
  @IsOptional()
  @IsInt()
  @Min(0, { message: '原价不得为负' })
  originalPrice?: number

  @ApiPropertyOptional({ description: '排序（升序输出）' })
  @IsOptional()
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 512, { message: '备注长度须在 0-512 位之间' })
  remark?: string
}

/** 计划修改入参（应用归属不可变更——迁移订阅主体不在本期语义内） */
export class UpdatePlanDto {
  @ApiProperty({ description: '计划名' })
  @IsString()
  @Length(1, 64, { message: '计划名长度须在 1-64 位之间' })
  name!: string

  @ApiProperty({ description: '周期档位' })
  @IsIn(PERIOD_TYPES)
  periodType!: string

  @ApiProperty({ description: '现价（分）' })
  @IsInt()
  @Min(0, { message: '价格不得为负' })
  price!: number

  @ApiPropertyOptional({ description: '划线原价（分）' })
  @IsOptional()
  @IsInt()
  @Min(0, { message: '原价不得为负' })
  originalPrice?: number

  @ApiProperty({ description: '状态（on / off）' })
  @IsIn(['on', 'off'])
  status!: string

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 512, { message: '备注长度须在 0-512 位之间' })
  remark?: string
}

/** 计划列表行 */
export interface PlanVo {
  id: string
  appId: string
  appName: string
  name: string
  periodType: string
  durationMonths: number | null
  price: number
  originalPrice: number | null
  status: string
  sort: number
  remark: string | null
  createTime: Date
}

/** 开放端点在售计划条目（应用内橱窗，主张 S9：仅 AppKey 签名） */
export interface OpenPlanVo {
  id: string
  name: string
  periodType: string
  durationMonths: number | null
  price: number
  originalPrice: number | null
  remark: string | null
}
