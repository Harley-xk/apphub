/*
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台聚合接口 DTO：区间查询入参与概览出参（待办 / 指标 / sparkline / 最新动态，设计 §4.2）
 */
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'

import type { DashboardRange } from '../dashboard.range'

/** 概览查询入参：range 缺省 7d，非法值由 ValidationPipe 拒绝 */
export class DashboardQueryDto {
  @ApiPropertyOptional({ description: '统计区间（7d / 30d，缺省 7d）', enum: ['7d', '30d'] })
  @IsOptional()
  @IsIn(['7d', '30d'])
  range?: DashboardRange
}

/** 待办：null 表示当前用户无权查看该块 */
export interface DashboardTodoVo {
  expiringSubscriptions: number | null
  pendingOrders: number | null
  lockedMembers: number | null
}

/** 指标：null 表示当前用户无权查看该块；0 表示有权且确实为 0 */
export interface DashboardMetricsVo {
  appTotal: number | null
  appEnabled: number | null
  versionTotal: number | null
  versionPublished: number | null
  memberTotal: number | null
  memberNewInRange: number | null
  subscriptionActive: number | null
  subscriptionExpiringSoon: number | null
  /** 区间内已支付订单金额合计（分） */
  revenueInRange: number | null
}

/** sparkline：按自然日聚合、缺日补 0，null 表示无权 */
export interface DashboardSparklineVo {
  /** 元素形如 { date: '2026-11-01', count: 12 } */
  memberDaily: { date: string, count: number }[] | null
  /** 元素形如 { date: '2026-11-01', amount: 1200 }，amount 单位分 */
  revenueDaily: { date: string, amount: number }[] | null
}

/** 最新动态：null 表示无权；数组为空表示有权但暂无数据 */
export interface DashboardLatestVo {
  orders: {
    id: string
    orderNo: string
    memberNickname: string
    appName: string
    amount: number
    channel: string
    status: string
    createTime: number
  }[] | null
  members: {
    id: string
    nickname: string
    registeredAppName: string | null
    createTime: number
  }[] | null
  versions: {
    id: string
    appName: string
    version: string
    status: string
    createTime: number
  }[] | null
}

/** 工作台概览出参 */
export interface DashboardOverviewVo {
  /** 服务端生成时间（毫秒时间戳，与前端时间列约定一致） */
  generatedAt: number
  range: DashboardRange
  todos: DashboardTodoVo
  metrics: DashboardMetricsVo
  sparkline: DashboardSparklineVo
  latest: DashboardLatestVo
}
