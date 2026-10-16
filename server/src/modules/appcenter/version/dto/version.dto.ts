/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 版本域 DTO 集：分页 / 创建 / 编辑入参与出参契约（状态机对可编辑字段的分流校验在 service 层，设计 §3.2）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

import { PageParamDto } from '../../../../common/dto/page.dto'
import { VERSION_STATUS } from '../../appcenter.constants'

/** 版本出参（通道信息由服务层二次查询回填） */
export interface VersionVo {
  id: string
  appId: string
  channelId: string
  channelCode: string
  channelName: string
  version: string
  title: string
  notes: string | null
  forceUpdate: boolean
  status: string
  publishedAt: Date | null
  createTime: Date
}

export class VersionPageDto extends PageParamDto {
  @ApiPropertyOptional({ description: '按通道过滤' })
  @IsOptional()
  @IsUUID()
  channelId?: string

  @ApiPropertyOptional({ description: '按状态过滤（draft / published / offline）' })
  @IsOptional()
  @IsIn([VERSION_STATUS.DRAFT, VERSION_STATUS.PUBLISHED, VERSION_STATUS.OFFLINE])
  status?: string
}

export class VersionCreateDto {
  @ApiProperty({ description: '所属通道 id（创建后不可改：跨通道发布需新建版本）' })
  @IsUUID()
  channelId: string

  @ApiProperty({ description: '版本号（semver 格式，service 层校验）', example: '1.3.0' })
  @IsString()
  @MaxLength(32)
  version: string

  @ApiProperty({ description: '版本标题', example: '1.3.0 性能优化版' })
  @IsString()
  @MaxLength(128)
  title: string

  @ApiPropertyOptional({ description: '更新说明（多行纯文本）' })
  @IsOptional()
  @IsString()
  notes?: string

  @ApiPropertyOptional({ description: '强制更新标记（单一事实源，两种协议渲染）', default: false })
  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean
}

export class VersionUpdateDto {
  @ApiProperty({ description: '版本 id' })
  @IsUUID()
  id: string

  @ApiPropertyOptional({ description: '版本号（仅 draft 可改，published 状态传入即拒）' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string

  @ApiPropertyOptional({ description: '版本标题（仅 draft 可改，published 状态传入即拒）' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string

  @ApiPropertyOptional({ description: '更新说明（draft / published 均可改：发版后补救）' })
  @IsOptional()
  @IsString()
  notes?: string

  @ApiPropertyOptional({ description: '强制更新标记（draft / published 均可改）' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  forceUpdate?: boolean
}
