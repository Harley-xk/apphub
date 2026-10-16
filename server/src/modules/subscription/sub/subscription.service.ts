/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅实例服务：管理端列表（过期打标）与 introspect 订阅段真值注入（设计 §3.4，替换 M2 占位 I6）。
 * 本服务导出给 member 模块消费（单实例查询是 introspect 的权威数据源）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, LessThan, MoreThan, type FindOptionsWhere, type Repository } from 'typeorm'

import type { IntrospectSubscriptionVo, SubscriptionPageDto, SubscriptionVo } from './dto/subscription.dto'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { AppEntity } from '../../appcenter/entities/app.entity'
import { MemberEntity } from '../../member/entities/member.entity'
import { SubPlanEntity } from '../entities/sub-plan.entity'
import { SubscriptionEntity } from '../entities/subscription.entity'
import { isPermanentExpire } from '../subscription-period'

/** introspect 未订阅段的固定形态（结构就绪，应用侧无需兼容字段缺失） */
const UNSUBSCRIBED: IntrospectSubscriptionVo = {
  subscribed: false,
  planName: null,
  periodType: null,
  expireAt: null,
}

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepository: Repository<SubscriptionEntity>,
    @InjectRepository(SubPlanEntity)
    private readonly planRepository: Repository<SubPlanEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
  ) {}

  /** 实例分页列表（应用 / 会员 / 状态筛选；状态由查询层按时间打标，S2） */
  async getPage(dto: SubscriptionPageDto): Promise<PageResult<SubscriptionVo>> {
    const where: FindOptionsWhere<SubscriptionEntity> = {}
    if (dto.appId)
      where.appId = dto.appId
    if (dto.memberId)
      where.memberId = dto.memberId
    if (dto.state === 'active')
      where.expireAt = MoreThan(new Date())
    if (dto.state === 'expired') {
      // 永久哨兵（2999）恒大于 now，LessThan 天然排除永久档——语义即「已过期的周期类实例」
      where.expireAt = LessThan(new Date())
    }
    const [list, total] = await this.subscriptionRepository.findAndCount({
      where,
      skip: (dto.pageNo - 1) * dto.pageSize,
      take: dto.pageSize,
      order: { expireAt: 'DESC' },
    })
    const memberMap = await this.loadMemberMap(list.map(sub => sub.memberId))
    const appMap = await this.loadAppMap(list.map(sub => sub.appId))
    const planMap = await this.loadPlanMap(list.map(sub => sub.planId))
    const now = Date.now()
    return {
      list: list.map(sub => this.toVo(sub, memberMap, appMap, planMap, now)),
      total,
    }
  }

  /** introspect 订阅段（member 域消费，D13 到期即失效：subscribed = expire_at > now） */
  async getIntrospectSegment(memberId: string, appKey: string): Promise<IntrospectSubscriptionVo> {
    const app = await this.appRepository.findOne({ select: ['id'], where: { appKey } })
    if (!app)
      return UNSUBSCRIBED
    const subscription = await this.subscriptionRepository.findOne({
      where: { memberId, appId: app.id },
    })
    if (!subscription)
      return UNSUBSCRIBED
    const plan = await this.planRepository.findOne({
      select: ['name', 'periodType'],
      where: { id: subscription.planId },
      withDeleted: true,
    })
    return {
      subscribed: subscription.expireAt.getTime() > Date.now(),
      planName: plan?.name ?? null,
      periodType: plan?.periodType ?? null,
      expireAt: subscription.expireAt.toISOString(),
    }
  }

  private async loadMemberMap(memberIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(memberIds)]
    if (uniqueIds.length === 0)
      return new Map()
    const members = await this.memberRepository.find({
      select: ['id', 'nickname'],
      where: { id: In(uniqueIds) },
      withDeleted: true,
    })
    return new Map(members.map(member => [member.id, member.nickname]))
  }

  private async loadAppMap(appIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(appIds)]
    if (uniqueIds.length === 0)
      return new Map()
    const apps = await this.appRepository.find({
      select: ['id', 'name'],
      where: { id: In(uniqueIds) },
      withDeleted: true,
    })
    return new Map(apps.map(app => [app.id, app.name]))
  }

  /** 计划名 / 周期回显（计划软删后仍可查——实例与订单语义不受计划删除影响） */
  private async loadPlanMap(planIds: string[]): Promise<Map<string, SubPlanEntity>> {
    const uniqueIds = [...new Set(planIds)]
    if (uniqueIds.length === 0)
      return new Map()
    const plans = await this.planRepository.find({
      where: { id: In(uniqueIds) },
      withDeleted: true,
    })
    return new Map(plans.map(plan => [plan.id, plan]))
  }

  private toVo(
    subscription: SubscriptionEntity,
    memberMap: Map<string, string>,
    appMap: Map<string, string>,
    planMap: Map<string, SubPlanEntity>,
    now: number,
  ): SubscriptionVo {
    const plan = planMap.get(subscription.planId)
    return {
      id: subscription.id,
      memberId: subscription.memberId,
      memberNickname: memberMap.get(subscription.memberId) ?? '（会员已删除）',
      appId: subscription.appId,
      appName: appMap.get(subscription.appId) ?? '（应用已删除）',
      planId: subscription.planId,
      planName: plan?.name ?? '（计划已删除）',
      periodType: plan?.periodType ?? '',
      startAt: subscription.startAt,
      expireAt: subscription.expireAt,
      lastRenewAt: subscription.lastRenewAt,
      state: isPermanentExpire(subscription.expireAt) || subscription.expireAt.getTime() > now
        ? 'active'
        : 'expired',
      permanent: isPermanentExpire(subscription.expireAt),
    }
  }
}
