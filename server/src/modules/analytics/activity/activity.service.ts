/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 活跃度查询服务：数据范围收窄 → 自然日区间校验 → 日表去重聚合（概览 / 趋势 / 平台架构版本分布，设计 §5）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository, SelectQueryBuilder } from 'typeorm'

import { buildDateKeys, countDateKeys, shanghaiDayEndExclusive, shanghaiDayStart } from './activity.range'
import {
  ACTIVITY_DIMENSION_COLUMN,
  ACTIVITY_QUERY_MAX_DAYS,
  ANONYMOUS_MEMBER_ID,
} from '../analytics.constants'
import { normalizeFilter } from './dto/activity.dto'
import { GlobalErrorCode } from '../../../common/errors/error-code'
import { AnalyticsDeviceDayEntity } from '../entities/analytics-device-day.entity'
import { AnalyticsDeviceEntity } from '../entities/analytics-device.entity'
import { AnalyticsErrorCode } from '../error-codes'
import type {
  ActivityDistributionItemVo,
  ActivityDistributionQueryDto,
  ActivityRangeQueryDto,
  ActivitySummaryVo,
} from './dto/activity.dto'
import { businessError } from '../../../common/exceptions/business-error'
import type { AppScope } from '../../system/app-scope/app-scope.service'
import { AppScopeService } from '../../system/app-scope/app-scope.service'

/** 逐日聚合原始行（PG 的 COUNT 以字符串返回） */
interface DailyRow {
  day: string
  device_count: string
  member_count: string
}

/** 区间去重聚合原始行 */
interface ActiveRow {
  device_count: string
  member_count: string
}

/** 分布聚合原始行 */
interface DistributionRow {
  key: string | null
  device_count: string
  member_count: string
}

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(AnalyticsDeviceDayEntity)
    private readonly dayRepository: Repository<AnalyticsDeviceDayEntity>,
    @InjectRepository(AnalyticsDeviceEntity)
    private readonly deviceRepository: Repository<AnalyticsDeviceEntity>,
    private readonly appScopeService: AppScopeService,
  ) {}

  /** 概览：区间最后一天 DAU + 区间去重活跃 + 新增设备 + 定长趋势 */
  async getSummary(dto: ActivityRangeQueryDto, userId: string): Promise<ActivitySummaryVo> {
    const appIds = await this.resolveScope(dto, userId)
    const dayKeys = this.resolveDayKeys(dto)
    if (appIds !== null && appIds.length === 0)
      return this.emptySummary(dayKeys)

    const [dailyRows, activeRow, newDevices] = await Promise.all([
      this.loadDaily(appIds, dto),
      this.loadActive(appIds, dto),
      this.countNewDevices(appIds, dto),
    ])

    const dailyMap = new Map(dailyRows.map(row => [row.day, row]))
    const lastKey = dayKeys[dayKeys.length - 1]
    const lastRow = dailyMap.get(lastKey)

    return {
      deviceDau: Number(lastRow?.device_count ?? 0),
      memberDau: Number(lastRow?.member_count ?? 0),
      deviceActive: Number(activeRow?.device_count ?? 0),
      memberActive: Number(activeRow?.member_count ?? 0),
      newDevices,
      trend: dayKeys.map((date) => {
        const row = dailyMap.get(date)
        return {
          date,
          deviceDau: Number(row?.device_count ?? 0),
          memberDau: Number(row?.member_count ?? 0),
        }
      }),
    }
  }

  /** 维度分布：区间内 has_activate 行按平台 / 架构 / 版本分组的去重设备数与会员数 */
  async getDistribution(
    dto: ActivityDistributionQueryDto,
    userId: string,
  ): Promise<ActivityDistributionItemVo[]> {
    const appIds = await this.resolveScope(dto, userId)
    this.resolveDayKeys(dto)
    if (appIds !== null && appIds.length === 0)
      return []

    const column = ACTIVITY_DIMENSION_COLUMN[dto.dimension]
    const rows = await this.dayQuery(appIds, dto)
      .select(column, 'key')
      .addSelect('COUNT(DISTINCT d.deviceId)', 'device_count')
      .addSelect(
        'COUNT(DISTINCT CASE WHEN d.memberId <> :anonymousMemberId THEN d.memberId END)',
        'member_count',
      )
      .setParameter('anonymousMemberId', ANONYMOUS_MEMBER_ID)
      .groupBy(column)
      // 按 select 序号排序（1 key / 2 device_count）：避免 ORM 对原始别名做列名转义
      .orderBy('2', 'DESC')
      .addOrderBy('1', 'ASC')
      .getRawMany<DistributionRow>()

    return rows.map(row => ({
      key: row.key ?? '',
      deviceCount: Number(row.device_count),
      memberCount: Number(row.member_count),
    }))
  }

  /**
   * 数据范围收窄：显式 appId 越权 → 403 + 007300005；
   * 缺省 appId → 数据范围内全部应用（null = 全量，[] = fail-closed 空集）。
   */
  private async resolveScope(dto: ActivityRangeQueryDto, userId: string): Promise<string[] | null> {
    const scope: AppScope = await this.appScopeService.resolve(userId, 'analytics')
    const scopeAppIds = scope.mode === 'all' ? null : scope.appIds
    const explicitAppId = dto.appId
    if (explicitAppId) {
      if (scopeAppIds !== null && !scopeAppIds.includes(explicitAppId)) {
        throw businessError(AnalyticsErrorCode.APP_SCOPE_FORBIDDEN.message, {
          status: 403,
          code: AnalyticsErrorCode.APP_SCOPE_FORBIDDEN,
        })
      }
      return [explicitAppId]
    }
    return scopeAppIds
  }

  /** 区间合法性：真实日历日、正序、跨度 ≤ 180 天；返回升序日期轴 */
  private resolveDayKeys(dto: ActivityRangeQueryDto): string[] {
    const count = countDateKeys(dto.startDate, dto.endDate)
    if (count === 0) {
      throw businessError('开始日期不能晚于结束日期，且须为合法日期', {
        code: GlobalErrorCode.INVALID_REQUEST_PARAM,
      })
    }
    if (count > ACTIVITY_QUERY_MAX_DAYS) {
      throw businessError(AnalyticsErrorCode.DATE_RANGE_TOO_LARGE.message, {
        code: AnalyticsErrorCode.DATE_RANGE_TOO_LARGE,
      })
    }
    return buildDateKeys(dto.startDate, dto.endDate)
  }

  /** 日表基础查询：区间 + has_activate + 数据范围 + 可选平台 / 架构 / 版本筛选 */
  private dayQuery(
    appIds: string[] | null,
    dto: ActivityRangeQueryDto,
  ): SelectQueryBuilder<AnalyticsDeviceDayEntity> {
    const query = this.dayRepository.createQueryBuilder('d')
      .where('d.hasActivate = :hasActivate', { hasActivate: true })
      .andWhere('d.statDate >= :startDate', { startDate: dto.startDate })
      .andWhere('d.statDate <= :endDate', { endDate: dto.endDate })
    if (appIds !== null)
      query.andWhere('d.appId IN (:...appIds)', { appIds })
    const platform = normalizeFilter(dto.platform)
    if (platform)
      query.andWhere('d.platform = :platform', { platform })
    const arch = normalizeFilter(dto.arch)
    if (arch)
      query.andWhere('d.arch = :arch', { arch })
    const version = normalizeFilter(dto.version)
    if (version)
      query.andWhere('d.clientVersion = :version', { version })
    return query
  }

  /** 逐自然日设备 / 会员去重数（匿名哨兵不计入会员口径） */
  private async loadDaily(
    appIds: string[] | null,
    dto: ActivityRangeQueryDto,
  ): Promise<DailyRow[]> {
    return this.dayQuery(appIds, dto)
      .select(`to_char(d.statDate, 'YYYY-MM-DD')`, 'day')
      .addSelect('COUNT(DISTINCT d.deviceId)', 'device_count')
      .addSelect(
        'COUNT(DISTINCT CASE WHEN d.memberId <> :anonymousMemberId THEN d.memberId END)',
        'member_count',
      )
      .setParameter('anonymousMemberId', ANONYMOUS_MEMBER_ID)
      .groupBy('d.statDate')
      .orderBy('d.statDate', 'ASC')
      .getRawMany<DailyRow>()
  }

  /** 区间去重活跃设备 / 会员（不能由日活加总，MAU 口径） */
  private async loadActive(
    appIds: string[] | null,
    dto: ActivityRangeQueryDto,
  ): Promise<ActiveRow | null> {
    const row = await this.dayQuery(appIds, dto)
      .select('COUNT(DISTINCT d.deviceId)', 'device_count')
      .addSelect(
        'COUNT(DISTINCT CASE WHEN d.memberId <> :anonymousMemberId THEN d.memberId END)',
        'member_count',
      )
      .setParameter('anonymousMemberId', ANONYMOUS_MEMBER_ID)
      .getRawOne<ActiveRow>()
    return row ?? null
  }

  /** 新增设备：first_seen_at 落在区间内的设备数（设备已按首次窗口激活建档） */
  private async countNewDevices(
    appIds: string[] | null,
    dto: ActivityRangeQueryDto,
  ): Promise<number> {
    const query = this.deviceRepository.createQueryBuilder('dev')
      .select('COUNT(DISTINCT dev.deviceId)', 'count')
      .where('dev.firstSeenAt >= :from', { from: shanghaiDayStart(dto.startDate) })
      .andWhere('dev.firstSeenAt < :to', { to: shanghaiDayEndExclusive(dto.endDate) })
    if (appIds !== null)
      query.andWhere('dev.appId IN (:...appIds)', { appIds })
    const platform = normalizeFilter(dto.platform)
    if (platform)
      query.andWhere('dev.platform = :platform', { platform })
    const arch = normalizeFilter(dto.arch)
    if (arch)
      query.andWhere('dev.arch = :arch', { arch })
    // 版本筛选不作用于新增设备：设备表只保存最近一次版本，无法还原首次激活时的版本（设计 §2 补充约定）
    const row = await query.getRawOne<{ count: string }>()
    return Number(row?.count ?? 0)
  }

  /** fail-closed / 无数据：返回定长 N 点全 0 趋势，前端无需特判 */
  private emptySummary(dayKeys: string[]): ActivitySummaryVo {
    return {
      deviceDau: 0,
      memberDau: 0,
      deviceActive: 0,
      memberActive: 0,
      newDevices: 0,
      trend: dayKeys.map(date => ({ date, deviceDau: 0, memberDau: 0 })),
    }
  }
}
