/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 更新通道域 DTO 集：创建 / 更新入参与出参契约（code 创建后不可改——参与 OSS 对象键与 feed URL）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'

import { CHANNEL_STATUS } from '../../appcenter.constants'

/** 通道出参 */
export interface ChannelVo {
  id: string
  appId: string
  code: string
  name: string
  status: string
  sort: number
  createTime: Date
}

export class ChannelCreateDto {
  @ApiProperty({ description: '通道代码（应用内唯一，创建后不可改）', example: 'beta' })
  @IsString()
  @IsNotEmpty({ message: '通道代码不能为空' })
  @MaxLength(32)
  code: string

  @ApiProperty({ description: '通道显示名', example: '公测版' })
  @IsString()
  @IsNotEmpty({ message: '通道显示名不能为空' })
  @MaxLength(64)
  name: string

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number
}

export class ChannelUpdateDto {
  @ApiProperty({ description: '通道显示名' })
  @IsString()
  @IsNotEmpty({ message: '通道显示名不能为空' })
  @MaxLength(64)
  name: string

  @ApiPropertyOptional({ description: '状态（enabled / disabled，停用后该通道更新检测返回无更新）' })
  @IsOptional()
  @IsIn([CHANNEL_STATUS.ENABLED, CHANNEL_STATUS.DISABLED])
  status?: string

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number
}
