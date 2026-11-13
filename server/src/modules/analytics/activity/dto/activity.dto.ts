/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 活跃度接口 DTO：开放上报入参 / 响应、查询入参与概览 / 分布出参（设计 §4.2 / §5）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator'

import { PACKAGE_PLATFORM } from '../../../appcenter/appcenter.constants'
import {
  ACTIVITY_DISTRIBUTION_DIMENSIONS,
  ACTIVITY_EVENT_TYPES,
} from '../../analytics.constants'
import type { ActivityDistributionDimension } from '../../analytics.constants'

const PLATFORM_VALUES: readonly string[] = Object.values(PACKAGE_PLATFORM)

/** 单条活跃事件 */
export class ActivityEventDto {
  @ApiProperty({ description: '事件类型：start / activate / stop', enum: ACTIVITY_EVENT_TYPES })
  @IsIn(ACTIVITY_EVENT_TYPES as string[], { message: '事件类型不合法' })
  type: string

  @ApiProperty({ description: '事件发生时间（ISO 8601 带时区）', example: '2026-11-13T08:30:00+08:00' })
  @IsISO8601({ strict: true }, { message: '事件时间须为 ISO 8601 格式' })
  occurredAt: string

  /** 客户端本地事件编号（可选，仅用于排障透传，不落库、不参与幂等判定，设计 §4.2） */
  @ApiPropertyOptional({ description: '客户端本地事件编号（可选，仅排障用）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventId?: string
}

/** 活跃上报入参（单次 1~50 条，超量由服务端按 007300002 拒绝） */
export class ActivityReportDto {
  @ApiProperty({ description: '设备标识：客户端首次启动生成并持久化' })
  @IsString()
  @MaxLength(64, { message: '设备标识长度不能超过 64' })
  deviceId: string

  @ApiProperty({ description: '平台：windows / macos / linux / android / ios / web', enum: PLATFORM_VALUES })
  @IsIn(PLATFORM_VALUES as string[], { message: '平台取值不合法' })
  platform: string

  @ApiPropertyOptional({ description: '架构（桌面端必填）：x64 / arm64 / universal' })
  @IsOptional()
  @IsString()
  @MaxLength(16, { message: '架构长度不能超过 16' })
  arch?: string

  @ApiProperty({ description: '客户端版本（semver）', example: '1.2.3' })
  @IsString()
  @MaxLength(32, { message: '客户端版本长度不能超过 32' })
  clientVersion: string

  @ApiProperty({ description: '事件批量（1~50 条）', type: [ActivityEventDto] })
  @IsArray({ message: '事件必须是数组' })
  @ArrayMinSize(1, { message: '事件不能为空' })
  @ValidateNested({ each: true })
  @Type(() => ActivityEventDto)
  events: ActivityEventDto[]
}

/** 上报响应 */
export interface ActivityReportVo {
  /** 被接受并参与 upsert 的事件数 */
  accepted: number
  /** 超窗 / 非法被丢弃的事件数 */
  ignored: number
  /** 本次请求是否解析到有效会员态 */
  memberResolved: boolean
}

/** 概览 / 分布查询公共入参 */
export class ActivityRangeQueryDto {
  @ApiPropertyOptional({ description: '应用 id；缺省为数据范围内全部应用合计' })
  @IsOptional()
  @IsUUID('all', { message: '应用 id 格式不合法' })
  appId?: string

  @ApiProperty({ description: '区间起点（含，Asia/Shanghai 自然日）', example: '2026-11-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 须为 YYYY-MM-DD' })
  startDate: string

  @ApiProperty({ description: '区间终点（含，Asia/Shanghai 自然日）', example: '2026-11-07' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 须为 YYYY-MM-DD' })
  endDate: string

  @ApiPropertyOptional({ description: '平台筛选（与上报 platform 同值域）' })
  @IsOptional()
  @IsIn(PLATFORM_VALUES as string[], { message: '平台取值不合法' })
  platform?: string

  @ApiPropertyOptional({ description: '架构筛选' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  arch?: string

  @ApiPropertyOptional({ description: '客户端版本筛选' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string
}

/** 分布查询入参 */
export class ActivityDistributionQueryDto extends ActivityRangeQueryDto {
  @ApiProperty({ description: '分布维度', enum: ACTIVITY_DISTRIBUTION_DIMENSIONS })
  @IsIn(ACTIVITY_DISTRIBUTION_DIMENSIONS, { message: '分布维度不合法' })
  dimension: ActivityDistributionDimension
}

/** 概览出参 */
export interface ActivitySummaryVo {
  /** 区间最后一天的设备日活 */
  deviceDau: number
  /** 区间最后一天的会员日活 */
  memberDau: number
  /** 区间去重设备数（MAU / 自定义区间活跃） */
  deviceActive: number
  /** 区间去重会员数 */
  memberActive: number
  /** 区间内首次出现窗口激活的设备数 */
  newDevices: number
  /** 逐自然日趋势（定长 N 点，缺日补 0） */
  trend: { date: string, deviceDau: number, memberDau: number }[]
}

/** 维度分布条目 */
export interface ActivityDistributionItemVo {
  key: string
  deviceCount: number
  memberCount: number
}

/** 日期筛选去空白（前端空字符串按未筛选处理） */
export function normalizeFilter(value: string | undefined): string | undefined {
  if (value === undefined)
    return undefined
  const trimmed = String(value).trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上报 DTO 的设备标识去空白（客户端偶发带空格不应拒绝整批） */
export function normalizeDeviceId(value: string): string {
  return String(value ?? '').trim()
}
