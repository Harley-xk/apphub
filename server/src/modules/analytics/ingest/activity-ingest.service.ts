/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 活跃事件接收服务：窗口过滤 → 按自然日与维度分组 → 设备-日状态行幂等 upsert（设计 §4.3，AT4~AT11）
 */
import { Injectable, Logger } from '@nestjs/common'
import { valid as validSemver } from 'semver'
import { DataSource } from 'typeorm'

import { GlobalErrorCode } from '../../../common/errors/error-code'
import { businessError } from '../../../common/exceptions/business-error'
import { APP_STATUS, PACKAGE_PLATFORM } from '../../appcenter/appcenter.constants'
import { AppLookupRegistry } from '../../system/app-scope/app-lookup.port'
import { toShanghaiDateKey } from '../activity/activity.range'
import type { ActivityReportDto, ActivityReportVo } from '../activity/dto/activity.dto'
import { normalizeDeviceId } from '../activity/dto/activity.dto'
import {
  ACTIVITY_EVENT_TYPE,
  ANONYMOUS_MEMBER_ID,
  DEVICE_ID_PATTERN,
  REPORT_BACKFILL_MS,
  REPORT_FUTURE_TOLERANCE_MS,
  REPORT_MAX_EVENTS,
} from '../analytics.constants'
import { AnalyticsErrorCode } from '../error-codes'
import { MemberIdentityRegistry } from '../ports/member-identity.port'

/** 单个（自然日 × 维度组合）的合并状态 */
interface GroupState {
  statDate: string
  hasStart: boolean
  hasActivate: boolean
  hasStop: boolean
  firstAt: Date
  lastAt: Date
}

/** 日表批量 upsert（幂等语义见设计 §3.1） */
const DAY_UPSERT_SQL = `INSERT INTO analytics_device_day
  (app_id, stat_date, device_id, member_id, platform, arch, client_version,
   has_start, has_activate, has_stop, first_at, last_at)
VALUES %ROWS%
ON CONFLICT (app_id, stat_date, device_id, member_id, platform, arch, client_version)
DO UPDATE SET
  has_start    = analytics_device_day.has_start    OR EXCLUDED.has_start,
  has_activate = analytics_device_day.has_activate OR EXCLUDED.has_activate,
  has_stop     = analytics_device_day.has_stop     OR EXCLUDED.has_stop,
  first_at     = LEAST(analytics_device_day.first_at, EXCLUDED.first_at),
  last_at      = GREATEST(analytics_device_day.last_at, EXCLUDED.last_at)`

/** 设备画像 upsert：first_seen_at 不参与更新（设计 §3.2） */
const DEVICE_UPSERT_SQL = `INSERT INTO analytics_device
  (app_id, device_id, platform, arch, last_version, first_seen_at, last_seen_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (app_id, device_id)
DO UPDATE SET
  platform     = EXCLUDED.platform,
  arch         = EXCLUDED.arch,
  last_version = EXCLUDED.last_version,
  last_seen_at = GREATEST(analytics_device.last_seen_at, EXCLUDED.last_seen_at)`

@Injectable()
export class ActivityIngestService {
  private readonly logger = new Logger(ActivityIngestService.name)

  constructor(
    private readonly dataSource: DataSource,
    private readonly appLookupRegistry: AppLookupRegistry,
    private readonly memberIdentityRegistry: MemberIdentityRegistry,
  ) {}

  /** 接收一批活跃事件：超窗丢弃不报错，合法事件按组合收敛为少量状态行（AT6 / AT7） */
  async report(
    appKey: string | undefined,
    authorization: string | undefined,
    dto: ActivityReportDto,
  ): Promise<ActivityReportVo> {
    const deviceId = normalizeDeviceId(dto.deviceId)
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
      throw businessError(AnalyticsErrorCode.DEVICE_ID_INVALID.message, {
        code: AnalyticsErrorCode.DEVICE_ID_INVALID,
      })
    }
    if (dto.events.length > REPORT_MAX_EVENTS) {
      throw businessError(AnalyticsErrorCode.REPORT_TOO_MANY_EVENTS.message, {
        code: AnalyticsErrorCode.REPORT_TOO_MANY_EVENTS,
      })
    }
    if (!validSemver(dto.clientVersion)) {
      throw businessError('客户端版本号格式非法（须为 semver）', {
        code: GlobalErrorCode.INVALID_REQUEST_PARAM,
      })
    }
    if (!(Object.values(PACKAGE_PLATFORM) as string[]).includes(dto.platform)) {
      throw businessError('平台取值不合法', { code: GlobalErrorCode.INVALID_REQUEST_PARAM })
    }

    const app = await this.resolveApp(appKey)
    const memberId = await this.resolveMember(appKey, authorization)
    const arch = dto.arch ?? ''
    const now = Date.now()
    const lowerBound = now - REPORT_BACKFILL_MS
    const upperBound = now + REPORT_FUTURE_TOLERANCE_MS

    const groups = new Map<string, GroupState>()
    let accepted = 0
    let ignored = 0
    let firstActivateAt: Date | null = null
    let latestAt: Date | null = null

    for (const event of dto.events) {
      const at = new Date(event.occurredAt)
      // 未来超窗 / 过旧 / 非法时间：静默丢弃并计数，避免客户端对个别脏数据无限重试（AT4 / AT7）
      if (Number.isNaN(at.getTime()) || at.getTime() < lowerBound || at.getTime() > upperBound) {
        ignored += 1
        continue
      }
      accepted += 1
      if (!latestAt || at > latestAt)
        latestAt = at
      if (event.type === ACTIVITY_EVENT_TYPE.ACTIVATE && (!firstActivateAt || at < firstActivateAt))
        firstActivateAt = at

      const statDate = toShanghaiDateKey(at)
      const key = [statDate, dto.platform, arch, dto.clientVersion, memberId ?? ANONYMOUS_MEMBER_ID].join('|')
      const state = groups.get(key)
      if (!state) {
        groups.set(key, {
          statDate,
          hasStart: event.type === ACTIVITY_EVENT_TYPE.START,
          hasActivate: event.type === ACTIVITY_EVENT_TYPE.ACTIVATE,
          hasStop: event.type === ACTIVITY_EVENT_TYPE.STOP,
          firstAt: at,
          lastAt: at,
        })
        continue
      }
      if (event.type === ACTIVITY_EVENT_TYPE.START)
        state.hasStart = true
      else if (event.type === ACTIVITY_EVENT_TYPE.ACTIVATE)
        state.hasActivate = true
      else if (event.type === ACTIVITY_EVENT_TYPE.STOP)
        state.hasStop = true
      if (at < state.firstAt)
        state.firstAt = at
      if (at > state.lastAt)
        state.lastAt = at
    }

    if (groups.size > 0) {
      const rows = [...groups.values()]
      await this.persist(app.id, deviceId, dto, arch, memberId, rows, firstActivateAt, latestAt)
    }

    return { accepted, ignored, memberResolved: memberId !== null }
  }

  /** 应用解析：AppKey 由签名层保证，查无 / 停用按 007300003 兜底 */
  private async resolveApp(appKey: string | undefined): Promise<{ id: string }> {
    const app = appKey
      ? (await this.appLookupRegistry.get()?.getByAppKey(appKey)) ?? null
      : null
    if (app?.status !== APP_STATUS.ENABLED) {
      throw businessError(AnalyticsErrorCode.APP_UNAVAILABLE.message, {
        code: AnalyticsErrorCode.APP_UNAVAILABLE,
      })
    }
    return app
  }

  /** 会员态解析：缺失 / 端口未注册 / 验签失败 / appKey 不一致一律按匿名（AT8 / §4.4） */
  private async resolveMember(appKey: string | undefined, authorization: string | undefined): Promise<string | null> {
    const token = this.readBearer(authorization)
    if (!token)
      return null
    const port = this.memberIdentityRegistry.get()
    if (!port) {
      this.logger.warn('会员身份端口未注册，活跃上报按匿名处理')
      return null
    }
    try {
      const identity = await port.verifyAccessToken(token)
      if (!identity || !appKey || identity.appKey !== appKey)
        return null
      return identity.memberId
    }
    catch {
      return null
    }
  }

  /** 请求头 Bearer 解析：非 Bearer / 空 token 视为匿名 */
  private readBearer(header: string | undefined): string | null {
    if (!header?.startsWith('Bearer '))
      return null
    const token = header.slice('Bearer '.length).trim()
    return token === '' ? null : token
  }

  /** 同事务写入日表与设备表（仅含 start / stop 的批次不维护设备表，§4.3） */
  private async persist(
    appId: string,
    deviceId: string,
    dto: ActivityReportDto,
    arch: string,
    memberId: string | null,
    rows: GroupState[],
    firstActivateAt: Date | null,
    latestAt: Date | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const params: unknown[] = []
      const placeholders = rows.map((row) => {
        const values: unknown[] = [
          appId,
          row.statDate,
          deviceId,
          memberId ?? ANONYMOUS_MEMBER_ID,
          dto.platform,
          arch,
          dto.clientVersion,
          row.hasStart,
          row.hasActivate,
          row.hasStop,
          row.firstAt,
          row.lastAt,
        ]
        return `(${values.map((value) => {
          params.push(value)
          return `$${params.length}`
        }).join(', ')})`
      })
      await manager.query(DAY_UPSERT_SQL.replace('%ROWS%', placeholders.join(', ')), params)

      // 设备表只在批次包含 activate 时维护：first_seen_at 语义为「首次窗口激活」
      if (firstActivateAt && latestAt) {
        await manager.query(DEVICE_UPSERT_SQL, [
          appId,
          deviceId,
          dto.platform,
          dto.arch ?? null,
          dto.clientVersion,
          firstActivateAt,
          latestAt,
        ])
      }
    })
  }
}
