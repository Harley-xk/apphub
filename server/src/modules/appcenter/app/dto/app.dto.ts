/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用域 DTO 集：分页 / 创建 / 更新 / 状态入参与出参契约（列表和详情不含 Secret，完整凭证经查看 / 创建 / 重置返回）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator'

import { PageParamDto } from '../../../../common/dto/page.dto'
import { APP_FRAMEWORK, APP_STATUS, CLIENT_TYPE } from '../../appcenter.constants'

/** 应用形态标签取值域 */
export const APP_TYPE_VALUES = ['desktop', 'web', 'mobile'] as const

/** 应用出参（不含 Secret） */
export interface AppVo {
  id: string
  appKey: string
  name: string
  appType: string[]
  clientType: string
  framework: string | null
  iconUrl: string | null
  description: string | null
  status: string
  sort: number
  createTime: Date
}

/** 应用凭证出参：查看凭证 / 创建 / 重置 Secret 三处共用（重置即旧凭证失效，D22） */
export interface AppCredentialVo {
  id: string
  appKey: string
  appSecret: string
}

/** 应用下拉查询入参（授权弹窗远程搜索与订阅页筛选） */
export class AppOptionsDto {
  @ApiPropertyOptional({ description: '关键字（同时匹配应用名称与 AppKey）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string
}

export class AppPageDto extends PageParamDto {
  @ApiPropertyOptional({ description: '应用名称模糊匹配' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string

  @ApiPropertyOptional({ description: '状态（enabled / disabled）' })
  @IsOptional()
  @IsIn([APP_STATUS.ENABLED, APP_STATUS.DISABLED])
  status?: string

  @ApiPropertyOptional({ description: '调用方类型（confidential / public）' })
  @IsOptional()
  @IsIn([CLIENT_TYPE.CONFIDENTIAL, CLIENT_TYPE.PUBLIC])
  clientType?: string

  @ApiPropertyOptional({ description: '技术框架（electron / tauri / custom）' })
  @IsOptional()
  @IsIn([APP_FRAMEWORK.ELECTRON, APP_FRAMEWORK.TAURI, APP_FRAMEWORK.CUSTOM])
  framework?: string
}

export class AppCreateDto {
  @ApiProperty({ description: '应用名称', example: '示例桌面应用' })
  @IsString()
  @IsNotEmpty({ message: '应用名称不能为空' })
  @MaxLength(64)
  name: string

  @ApiProperty({ description: '形态标签（desktop / web / mobile 的组合）', example: ['desktop'] })
  @IsArray()
  @ArrayNotEmpty({ message: '至少选择一个应用形态' })
  @IsIn(APP_TYPE_VALUES, { each: true, message: '应用形态取值须为 desktop / web / mobile' })
  appType: string[]

  @ApiProperty({ description: '调用方类型（confidential / public）', example: 'public' })
  @IsIn([CLIENT_TYPE.CONFIDENTIAL, CLIENT_TYPE.PUBLIC], { message: '调用方类型取值须为 confidential / public' })
  clientType: string

  @ApiPropertyOptional({ description: '技术框架归类（electron / tauri / custom）' })
  @IsOptional()
  @IsIn([APP_FRAMEWORK.ELECTRON, APP_FRAMEWORK.TAURI, APP_FRAMEWORK.CUSTOM], {
    message: '技术框架取值须为 electron / tauri / custom',
  })
  framework?: string

  @ApiPropertyOptional({ description: '应用图标地址' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  iconUrl?: string

  @ApiPropertyOptional({ description: '应用描述' })
  @IsOptional()
  @IsString()
  @MaxLength(512, { message: '应用描述不能超过 500 字' })
  description?: string

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number
}

export class AppUpdateDto {
  @ApiProperty({ description: '应用 id' })
  @IsUUID()
  id: string

  @ApiProperty({ description: '应用名称' })
  @IsString()
  @IsNotEmpty({ message: '应用名称不能为空' })
  @MaxLength(64)
  name: string

  @ApiProperty({ description: '形态标签（desktop / web / mobile 的组合）' })
  @IsArray()
  @ArrayNotEmpty({ message: '至少选择一个应用形态' })
  @IsIn(APP_TYPE_VALUES, { each: true, message: '应用形态取值须为 desktop / web / mobile' })
  appType: string[]

  @ApiPropertyOptional({ description: '技术框架归类（electron / tauri / custom）' })
  @IsOptional()
  @IsIn([APP_FRAMEWORK.ELECTRON, APP_FRAMEWORK.TAURI, APP_FRAMEWORK.CUSTOM], {
    message: '技术框架取值须为 electron / tauri / custom',
  })
  framework?: string

  @ApiPropertyOptional({ description: '应用图标地址' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  iconUrl?: string

  @ApiPropertyOptional({ description: '应用描述' })
  @IsOptional()
  @IsString()
  @MaxLength(512, { message: '应用描述不能超过 500 字' })
  description?: string

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number
}

export class AppStatusDto {
  @ApiProperty({ description: '目标状态（enabled / disabled）' })
  @IsIn([APP_STATUS.ENABLED, APP_STATUS.DISABLED], { message: '状态取值须为 enabled / disabled' })
  status: string
}
