/*
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台聚合服务：按权限点做字段级裁剪、按应用范围收窄统计，聚合待办 / 指标 / sparkline / 最新动态（设计 §4~§6）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { And, In, LessThan, LessThanOrEqual, MoreThan, MoreThanOrEqual } from 'typeorm'
import type { FindOptionsWhere, Repository } from 'typeorm'

import { buildDayKeys, resolveDashboardRange } from './dashboard.range'
import type { DashboardRange } from './dashboard.range'
import type {
  DashboardLatestVo,
  DashboardMetricsVo,
  DashboardOverviewVo,
  DashboardSparklineVo,
  DashboardTodoVo,
} from './dto/dashboard.dto'
import { BusinessError } from '../../common/exceptions/business-error'
import { AppVersionEntity } from '../appcenter/entities/app-version.entity'
import { AppEntity } from '../appcenter/entities/app.entity'
import { APPCENTER_PERMISSION_CODES } from '../appcenter/permissions'
import { MemberLoginLockEntity } from '../member/entities/member-login-lock.entity'
import { MemberEntity } from '../member/entities/member.entity'
import { MEMBER_PERMISSION_CODES } from '../member/permissions'
import { OrderEntity } from '../subscription/entities/order.entity'
import { SubscriptionEntity } from '../subscription/entities/subscription.entity'
import { SUBSCRIPTION_PERMISSION_CODES } from '../subscription/permissions'
import { ORDER_STATUS, PERMANENT_EXPIRE_AT } from '../subscription/subscription.constants'
import type { AppScope } from '../system/app-scope/app-scope.service'
import { AppScopeService } from '../system/app-scope/app-scope.service'
import { PermissionService } from '../system/permission.service'
import type { AppScopeDomain } from '../system/system.constants'

/** 动态列表固定条数（设计 §3.1） */
const LATEST_LIMIT = 5

/** 到期窗口固定 7 天（不受 range 切换影响，设计 §3.3） */
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** 按日聚合原始行（PG 的 COUNT / SUM 以字符串返回） */
interface DailyRow {
  day: string
  value: string
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
    @InjectRepository(AppVersionEntity)
    private readonly versionRepository: Repository<AppVersionEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(MemberLoginLockEntity)
    private readonly memberLoginLockRepository: Repository<MemberLoginLockEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepository: Repository<SubscriptionEntity>,
    private readonly permissionService: PermissionService,
    private readonly appScopeService: AppScopeService,
  ) {}

  /** 工作台概览：权限裁剪 → 范围收窄 → 并行聚合（全部只读，不写库） */
  async getOverview(range: DashboardRange, userId: string): Promise<DashboardOverviewVo> {
    const now = new Date()
    const { days, start } = resolveDashboardRange(range, now)
    const dayKeys = buildDayKeys(days, now)
    const expiringDeadline = new Date(now.getTime() + EXPIRING_WINDOW_MS)

    const codes = new Set(await this.permissionService.getUserPermissionCodes(userId))
    const canApp = codes.has(APPCENTER_PERMISSION_CODES.APP_QUERY)
    const canVersion = codes.has(APPCENTER_PERMISSION_CODES.VERSION_QUERY)
    const canMember = codes.has(MEMBER_PERMISSION_CODES.MEMBER_QUERY)
    const canOrder = codes.has(SUBSCRIPTION_PERMISSION_CODES.ORDER_QUERY)
    const canSub = codes.has(SUBSCRIPTION_PERMISSION_CODES.SUB_QUERY)

    // 仅在需要收窄的域上解析范围；同一域共用一次判定（避免重复查角色 / 授权）
    const [appScope, subScope] = await Promise.all([
      this.when(canApp || canVersion, () => this.resolveScopeSafe(userId, 'appcenter')),
      this.when(canOrder || canSub, () => this.resolveScopeSafe(userId, 'subscription')),
    ])

    const [
      appTotal,
      appEnabled,
      versionTotal,
      versionPublished,
      memberTotal,
      memberNewInRange,
      lockedMembers,
      subscriptionActive,
      expiringSubscriptions,
      pendingOrders,
      revenueInRange,
      memberDaily,
      revenueDaily,
      latestOrders,
      latestMembers,
      latestVersions,
    ] = await Promise.all([
      this.when(canApp, () => this.countApps(appScope, null)),
      this.when(canApp, () => this.countApps(appScope, 'enabled')),
      this.when(canVersion, () => this.countVersions(appScope, null)),
      this.when(canVersion, () => this.countVersions(appScope, 'published')),
      this.when(canMember, () => this.memberRepository.count()),
      this.when(canMember, () => this.memberRepository.count({ where: { createTime: MoreThanOrEqual(start) } })),
      this.when(canMember, () => this.memberLoginLockRepository.count({ where: { lockedUntil: MoreThan(now) } })),
      this.when(canSub, () => this.countSubscriptions(subScope, MoreThan(now))),
      this.when(canSub, () => this.countSubscriptions(
        subScope,
        And(MoreThan(now), LessThanOrEqual(expiringDeadline), LessThan(PERMANENT_EXPIRE_AT)),
      )),
      this.when(canOrder, () => this.countPendingOrders(subScope, now)),
      this.when(canOrder, () => this.sumPaidRevenue(subScope, start)),
      this.when(canMember, () => this.loadMemberDaily(start, dayKeys)),
      this.when(canOrder, () => this.loadRevenueDaily(subScope, start, dayKeys)),
      this.when(canOrder, () => this.loadLatestOrders(subScope)),
      this.when(canMember, () => this.loadLatestMembers()),
      this.when(canVersion, () => this.loadLatestVersions(appScope)),
    ])

    const todos: DashboardTodoVo = {
      expiringSubscriptions,
      pendingOrders,
      lockedMembers,
    }
    const metrics: DashboardMetricsVo = {
      appTotal,
      appEnabled,
      versionTotal,
      versionPublished,
      memberTotal,
      memberNewInRange,
      subscriptionActive,
      subscriptionExpiringSoon: expiringSubscriptions,
      revenueInRange,
    }
    const sparkline: DashboardSparklineVo = {
      memberDaily,
      revenueDaily,
    }
    const latest: DashboardLatestVo = {
      orders: latestOrders,
      members: latestMembers,
      versions: latestVersions,
    }

    return { generatedAt: now.getTime(), range, todos, metrics, sparkline, latest }
  }

  /**
   * 范围判定的防御包装：resolve 在「有权限点但角色未授予该域权限」时抛 403（正常请求已被 Guard 拦截）。
   * 工作台按空集处理，避免个别域的防御分支让整页 500；其他异常照常抛出。
   */
  private async resolveScopeSafe(userId: string, domain: AppScopeDomain): Promise<AppScope> {
    try {
      return await this.appScopeService.resolve(userId, domain)
    }
    catch (error) {
      if (error instanceof BusinessError && error.status === 403)
        return { mode: 'scoped', appIds: [] }
      throw error
    }
  }

  /** 无权限时不发起查询，直接返回 null（前端据此不渲染该块） */
  private when<T>(condition: boolean, task: () => Promise<T>): Promise<T | null> {
    return condition ? task() : Promise.resolve(null)
  }

  /** 范围收窄后的应用 id 集合：null = 全量；[] = 空集（fail-closed） */
  private scopeAppIds(scope: AppScope | null): string[] | null {
    return scope?.mode === 'scoped' ? scope.appIds : null
  }

  /** 应用计数：应用表按 id 收窄 */
  private async countApps(scope: AppScope | null, status: string | null): Promise<number> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return 0
    const where: FindOptionsWhere<AppEntity> = {}
    if (status !== null)
      where.status = status
    if (appIds !== null)
      where.id = In(appIds)
    return this.appRepository.count({ where })
  }

  /** 版本计数：版本表按 app_id 收窄 */
  private async countVersions(scope: AppScope | null, status: string | null): Promise<number> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return 0
    const where: FindOptionsWhere<AppVersionEntity> = {}
    if (status !== null)
      where.status = status
    if (appIds !== null)
      where.appId = In(appIds)
    return this.versionRepository.count({ where })
  }

  /** 订阅计数：按 app_id 收窄 + 到期条件（永久哨兵由调用方条件自然处理） */
  private async countSubscriptions(
    scope: AppScope | null,
    expireCondition: FindOptionsWhere<SubscriptionEntity>['expireAt'],
  ): Promise<number> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return 0
    const where: FindOptionsWhere<SubscriptionEntity> = { expireAt: expireCondition }
    if (appIds !== null)
      where.appId = In(appIds)
    return this.subscriptionRepository.count({ where })
  }

  /** 待支付且未超时的订单数（app_id 收窄） */
  private async countPendingOrders(scope: AppScope | null, now: Date): Promise<number> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return 0
    const where: FindOptionsWhere<OrderEntity> = {
      status: ORDER_STATUS.PENDING,
      expireAt: MoreThan(now),
    }
    if (appIds !== null)
      where.appId = In(appIds)
    return this.orderRepository.count({ where })
  }

  /** 区间已支付金额合计（分）：SUM 下推数据库，禁止整表拉取 */
  private async sumPaidRevenue(scope: AppScope | null, start: Date): Promise<number> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return 0
    const query = this.orderRepository
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.amount), 0)', 'value')
      .where('o.status = :status', { status: ORDER_STATUS.PAID })
      .andWhere('o.paidAt >= :start', { start })
      .andWhere('o.deletedAt IS NULL')
    if (appIds !== null)
      query.andWhere('o.appId IN (:...appIds)', { appIds })
    const row = await query.getRawOne<{ value: string }>()
    return Number(row?.value ?? 0)
  }

  /** 会员 sparkline：按上海自然日分组，服务端补齐缺失日期为定长 N 点 */
  private async loadMemberDaily(
    start: Date,
    dayKeys: string[],
  ): Promise<{ date: string, count: number }[]> {
    const rows = await this.memberRepository
      .createQueryBuilder('m')
      .select(`to_char((m.createTime AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD')`, 'day')
      .addSelect('COUNT(*)', 'value')
      .where('m.createTime >= :start', { start })
      .andWhere('m.deletedAt IS NULL')
      .groupBy('1')
      .orderBy('1', 'ASC')
      .getRawMany<DailyRow>()
    const map = new Map(rows.map(row => [row.day, Number(row.value)]))
    return dayKeys.map(date => ({ date, count: map.get(date) ?? 0 }))
  }

  /** 收入 sparkline：按上海自然日分组求和（分），服务端补齐缺失日期为定长 N 点 */
  private async loadRevenueDaily(
    scope: AppScope | null,
    start: Date,
    dayKeys: string[],
  ): Promise<{ date: string, amount: number }[]> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return dayKeys.map(date => ({ date, amount: 0 }))
    const query = this.orderRepository
      .createQueryBuilder('o')
      .select(`to_char((o.paidAt AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD')`, 'day')
      .addSelect('COALESCE(SUM(o.amount), 0)', 'value')
      .where('o.status = :status', { status: ORDER_STATUS.PAID })
      .andWhere('o.paidAt >= :start', { start })
      .andWhere('o.deletedAt IS NULL')
      .groupBy('1')
      .orderBy('1', 'ASC')
    if (appIds !== null)
      query.andWhere('o.appId IN (:...appIds)', { appIds })
    const rows = await query.getRawMany<DailyRow>()
    const map = new Map(rows.map(row => [row.day, Number(row.value)]))
    return dayKeys.map(date => ({ date, amount: map.get(date) ?? 0 }))
  }

  /** 最新订单 5 条：批量映射会员昵称与应用名，避免 N+1 */
  private async loadLatestOrders(scope: AppScope | null): Promise<NonNullable<DashboardLatestVo['orders']>> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return []
    const where: FindOptionsWhere<OrderEntity> = {}
    if (appIds !== null)
      where.appId = In(appIds)
    const orders = await this.orderRepository.find({
      where,
      order: { createTime: 'DESC' },
      take: LATEST_LIMIT,
    })
    const [memberMap, appMap] = await Promise.all([
      this.loadMemberMap(orders.map(order => order.memberId)),
      this.loadAppMap(orders.map(order => order.appId)),
    ])
    return orders.map(order => ({
      id: order.id,
      orderNo: order.orderNo,
      memberNickname: memberMap.get(order.memberId) ?? '-',
      appName: appMap.get(order.appId) ?? '-',
      amount: order.amount,
      channel: order.channel,
      status: order.status,
      createTime: order.createTime.getTime(),
    }))
  }

  /** 最近注册会员 5 位：平台级，不做应用收窄（设计 §3.2 说明） */
  private async loadLatestMembers(): Promise<NonNullable<DashboardLatestVo['members']>> {
    const members = await this.memberRepository.find({
      order: { createTime: 'DESC' },
      take: LATEST_LIMIT,
    })
    const registeredAppIds = members
      .map(member => member.registeredAppId)
      .filter((appId): appId is string => appId !== null)
    const appMap = await this.loadAppMap(registeredAppIds)
    return members.map(member => ({
      id: member.id,
      nickname: member.nickname,
      registeredAppName: member.registeredAppId ? (appMap.get(member.registeredAppId) ?? '-') : null,
      createTime: member.createTime.getTime(),
    }))
  }

  /** 最近创建版本 5 个：版本表按 app_id 收窄 */
  private async loadLatestVersions(scope: AppScope | null): Promise<NonNullable<DashboardLatestVo['versions']>> {
    const appIds = this.scopeAppIds(scope)
    if (appIds !== null && appIds.length === 0)
      return []
    const where: FindOptionsWhere<AppVersionEntity> = {}
    if (appIds !== null)
      where.appId = In(appIds)
    const versions = await this.versionRepository.find({
      where,
      order: { createTime: 'DESC' },
      take: LATEST_LIMIT,
    })
    const appMap = await this.loadAppMap(versions.map(version => version.appId))
    return versions.map(version => ({
      id: version.id,
      appName: appMap.get(version.appId) ?? '-',
      version: version.version,
      status: version.status,
      createTime: version.createTime.getTime(),
    }))
  }

  /** 会员 id → 昵称（已删除会员不返回，调用方以 '-' 兜底） */
  private async loadMemberMap(memberIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(memberIds)]
    if (uniqueIds.length === 0)
      return new Map()
    const members = await this.memberRepository.find({ where: { id: In(uniqueIds) } })
    return new Map(members.map(member => [member.id, member.nickname]))
  }

  /** 应用 id → 名称（含软删行：已删除应用返回 '-' 占位，不阻断列表，设计 §6） */
  private async loadAppMap(appIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(appIds)]
    if (uniqueIds.length === 0)
      return new Map()
    const apps = await this.appRepository.find({ where: { id: In(uniqueIds) }, withDeleted: true })
    return new Map(apps.map(app => [app.id, app.deletedAt ? '-' : app.name]))
  }
}
