/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅订单服务：状态机核心（markPaid 幂等 / 金额核对 / 惰性与兜底关单，设计 §3.2）与线下备案（§3.3）。
 * 在线渠道 HTTP 端点 M5 随 SDK 交付（主张 S4），markPaid 即回调与兜底查单共用的幂等入口
 */
import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomBytes } from 'node:crypto'
import { DataSource, In, LessThan, type FindOptionsWhere, type Repository } from 'typeorm'

import type { MarkPaidResult, OfflineCreateDto, OrderPageDto, OrderVo } from './dto/order.dto'
import { businessError } from '../../../common/exceptions/business-error'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { AppEntity } from '../../appcenter/entities/app.entity'
import { MemberEntity } from '../../member/entities/member.entity'
import { MemberErrorCode } from '../../member/error-codes'
import { OrderEntity } from '../entities/order.entity'
import { SubPlanEntity } from '../entities/sub-plan.entity'
import { SubscriptionEntity } from '../entities/subscription.entity'
import { SubscriptionErrorCode } from '../error-codes'
import { SubscriptionRenewService } from '../sub/subscription-renew.service'
import { isPermanentExpire } from '../subscription-period'
import {
  ORDER_CHANNEL,
  ORDER_PAY_TIMEOUT_HOURS,
  ORDER_STATUS,
  PLAN_STATUS,
} from '../subscription.constants'

/** 订单号随机段字符集（去除易混字符 I / O / 0 / 1） */
const ORDER_NO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name)

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(SubPlanEntity)
    private readonly planRepository: Repository<SubPlanEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepository: Repository<SubscriptionEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
    private readonly renewService: SubscriptionRenewService,
  ) {}

  /** 订单分页列表（先惰性关单再查询，渠道 / 状态 / 应用 / 会员 / 订单号筛选） */
  async getPage(dto: OrderPageDto): Promise<PageResult<OrderVo>> {
    await this.closeExpiredPending()
    const where: FindOptionsWhere<OrderEntity> = {}
    if (dto.appId)
      where.appId = dto.appId
    if (dto.memberId)
      where.memberId = dto.memberId
    if (dto.channel)
      where.channel = dto.channel
    if (dto.status)
      where.status = dto.status
    if (dto.orderNo)
      where.orderNo = dto.orderNo
    const [list, total] = await this.orderRepository.findAndCount({
      where,
      skip: (dto.pageNo - 1) * dto.pageSize,
      take: dto.pageSize,
      order: { createTime: 'DESC' },
    })
    const memberMap = await this.loadMemberMap(list.map(order => order.memberId))
    const appMap = await this.loadAppMap(list.map(order => order.appId))
    return { list: list.map(order => this.toVo(order, memberMap, appMap)), total }
  }

  /** 线下收款备案：创建 channel=offline 订单并直接标记 paid，事务内即时顺延订阅（设计 §3.3） */
  async createOfflineOrder(dto: OfflineCreateDto): Promise<OrderVo> {
    const plan = await this.planRepository.findOne({ where: { id: dto.planId } })
    if (!plan) {
      throw businessError(SubscriptionErrorCode.PLAN_NOT_EXISTS.message, {
        code: SubscriptionErrorCode.PLAN_NOT_EXISTS,
      })
    }
    if (plan.status !== PLAN_STATUS.ON) {
      throw businessError(SubscriptionErrorCode.PLAN_OFF_SHELF.message, {
        code: SubscriptionErrorCode.PLAN_OFF_SHELF,
      })
    }
    const member = await this.memberRepository.findOne({ where: { id: dto.memberId } })
    if (!member) {
      throw businessError(MemberErrorCode.MEMBER_NOT_EXISTS.message, {
        code: MemberErrorCode.MEMBER_NOT_EXISTS,
      })
    }
    // S5 主拦截：周期类不可续到永久实例（此处拦截于收款前；回调侧兜底见 renewInTx）
    await this.assertNotPeriodToPermanent(member.id, plan)

    const now = new Date()
    const order = await this.dataSource.transaction(async (manager) => {
      const entity = new OrderEntity()
      entity.orderNo = this.generateOrderNo(now)
      entity.memberId = member.id
      entity.appId = plan.appId
      entity.planId = plan.id
      entity.planName = plan.name
      entity.periodType = plan.periodType
      entity.amount = dto.amount
      entity.channel = ORDER_CHANNEL.OFFLINE
      entity.status = ORDER_STATUS.PAID
      entity.transactionId = dto.transactionId ?? null
      entity.paidAt = now
      entity.expireAt = new Date(now.getTime() + ORDER_PAY_TIMEOUT_HOURS * 3600 * 1000)
      entity.offlineNote = dto.offlineNote ?? null
      await manager.getRepository(OrderEntity).insert(entity)
      await this.renewService.renewInTx(manager, entity, now)
      return entity
    })
    const memberMap = await this.loadMemberMap([order.memberId])
    const appMap = await this.loadAppMap([order.appId])
    return this.toVo(order, memberMap, appMap)
  }

  /** 手动关闭待支付订单（M5 接渠道查单接口后在关单前补「已付被关」防护；paid / closed 一律拒绝） */
  async closeOrder(id: string): Promise<void> {
    const order = await this.getExistsOrder(id)
    if (order.status !== ORDER_STATUS.PENDING) {
      throw businessError(SubscriptionErrorCode.ORDER_STATUS_CONFLICT.message, {
        code: SubscriptionErrorCode.ORDER_STATUS_CONFLICT,
      })
    }
    await this.orderRepository.update({ id }, { status: ORDER_STATUS.CLOSED })
  }

  /**
   * 状态机核心（回调 / 兜底查单共用幂等入口，单测模拟回调覆盖验收项 2）：
   * 金额核对 → paid 幂等返回 → closed 留痕受理 → pending 事务内 paid + 顺延。
   * 超时未关的 pending 单收到回调照常受理——回调即支付证据，惰性关单只发生在查询路径
   */
  async markPaid(orderNo: string, transactionId: string | null, paidAmount: number | null): Promise<MarkPaidResult> {
    const order = await this.orderRepository.findOne({ where: { orderNo } })
    if (!order) {
      throw businessError(SubscriptionErrorCode.ORDER_NOT_EXISTS.message, {
        code: SubscriptionErrorCode.ORDER_NOT_EXISTS,
      })
    }
    if (paidAmount !== null && paidAmount !== order.amount) {
      this.logger.error(`支付金额与订单不符：订单 ${order.orderNo} 应付 ${order.amount} 分，实收 ${paidAmount} 分（需人工核查）`)
      throw businessError(SubscriptionErrorCode.ORDER_AMOUNT_MISMATCH.message, {
        code: SubscriptionErrorCode.ORDER_AMOUNT_MISMATCH,
      })
    }
    if (order.status === ORDER_STATUS.PAID)
      return 'duplicate'
    if (order.status === ORDER_STATUS.CLOSED) {
      this.logger.warn(`订单 ${order.orderNo} 已关闭后收到支付通知，留痕受理不重开（需人工对账）`)
      return 'closed_stale'
    }

    const now = new Date()
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(OrderEntity).update(
        { id: order.id },
        { status: ORDER_STATUS.PAID, paidAt: now, transactionId: transactionId ?? order.transactionId },
      )
      // S5 兜底：conflict 时订单已记 paid（资金事实优先），订阅保持永久，renewInTx 内已留 error 日志
      await this.renewService.renewInTx(manager, order, now)
    })
    return 'applied'
  }

  /** 惰性 / 定时兜底共用：批量关闭超时未支付的 pending 单（关单前查单防护 M5 接渠道后生效） */
  async closeExpiredPending(): Promise<number> {
    const result = await this.orderRepository.update(
      { status: ORDER_STATUS.PENDING, expireAt: LessThan(new Date()) },
      { status: ORDER_STATUS.CLOSED },
    )
    return result.affected ?? 0
  }

  /** 周期类订单不可指向永久实例（下单侧主拦截，005003002） */
  private async assertNotPeriodToPermanent(memberId: string, plan: SubPlanEntity): Promise<void> {
    if (plan.periodType === 'permanent')
      return
    const existing = await this.subscriptionRepository.findOne({ where: { memberId, appId: plan.appId } })
    if (existing && isPermanentExpire(existing.expireAt)) {
      throw businessError(SubscriptionErrorCode.SUBSCRIPTION_PERIOD_TO_PERMANENT.message, {
        code: SubscriptionErrorCode.SUBSCRIPTION_PERIOD_TO_PERMANENT,
      })
    }
  }

  /** 订单号：AH + yyMMddHHmmss（本地时间，可读对账）+ 6 位随机（防枚举）；同秒撞库概率约 3e-9，库级唯一约束兜底 */
  private generateOrderNo(now: Date): string {
    const pad = (value: number, width: number) => String(value).padStart(width, '0')
    const timestamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`
    const random = [...randomBytes(6)].map(byte => ORDER_NO_ALPHABET[byte % ORDER_NO_ALPHABET.length]).join('')
    return `AH${timestamp}${random}`
  }

  private async getExistsOrder(id: string): Promise<OrderEntity> {
    const order = await this.orderRepository.findOne({ where: { id } })
    if (!order) {
      throw businessError(SubscriptionErrorCode.ORDER_NOT_EXISTS.message, {
        code: SubscriptionErrorCode.ORDER_NOT_EXISTS,
      })
    }
    return order
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

  private toVo(order: OrderEntity, memberMap: Map<string, string>, appMap: Map<string, string>): OrderVo {
    return {
      ...order,
      memberNickname: memberMap.get(order.memberId) ?? '（会员已删除）',
      appName: appMap.get(order.appId) ?? '（应用已删除）',
    }
  }
}
