/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅订单服务：状态机核心（markPaid 幂等 / 金额核对 / 惰性与兜底关单，设计 §3.2）与线下备案（§3.3）、
 * 在线下单与轮询顺带查单、关单前查单防护（在线支付渠道接入附录 §5 / §6）
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomBytes } from 'node:crypto'
import { DataSource, In, LessThan, type FindOptionsWhere, type Repository } from 'typeorm'

import type { MarkPaidResult, OfflineCreateDto, OrderPageDto, OrderVo } from './dto/order.dto'
import { businessError } from '../../../common/exceptions/business-error'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { AppEntity } from '../../appcenter/entities/app.entity'
import type { AuthMember } from '../../member/auth/current-member.decorator'
import { MemberEntity } from '../../member/entities/member.entity'
import { MemberErrorCode } from '../../member/error-codes'
import { AppScopeService } from '../../system/app-scope/app-scope.service'
import { OrderEntity } from '../entities/order.entity'
import { SubPlanEntity } from '../entities/sub-plan.entity'
import { SubscriptionEntity } from '../entities/subscription.entity'
import { SubscriptionErrorCode } from '../error-codes'
import type { OnlineOrderCreateDto, OnlineOrderCreateVo, OnlineOrderQueryVo } from '../open/dto/open-order.dto'
import { PAY_QUERY_MIN_AGE_MS, PayQueryThrottleService } from '../pay/pay-query-throttle.service'
import { PAYMENT_PROVIDERS } from '../pay/payment-provider'
import { PAY_CHANNELS, PaymentProviderRegistry } from '../pay/payment-provider.registry'
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

/** 在线渠道判定：offline 等线下单无渠道侧状态，查单 / 关渠道单等渠道交互一律跳过 */
function isOnlineChannel(channel: string): boolean {
  return (PAY_CHANNELS as readonly string[]).includes(channel)
}

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
    @Inject(PAYMENT_PROVIDERS)
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly queryThrottle: PayQueryThrottleService,
    private readonly appScopeService: AppScopeService,
  ) {}

  /** 订单分页列表（先惰性关单再查询，渠道 / 状态 / 应用 / 会员 / 订单号筛选；按订阅域数据范围收窄） */
  async getPage(dto: OrderPageDto, userId: string): Promise<PageResult<OrderVo>> {
    await this.closeExpiredPending()
    const scopeAppIds = await this.appScopeService.getListAppIds(userId, 'subscription')
    const where: FindOptionsWhere<OrderEntity> = {}
    if (dto.appId) {
      this.appScopeService.assertListAppId(dto.appId, scopeAppIds)
      where.appId = dto.appId
    }
    else if (scopeAppIds !== null) {
      if (scopeAppIds.length === 0)
        return { list: [], total: 0 }
      where.appId = In(scopeAppIds)
    }
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
  async createOfflineOrder(dto: OfflineCreateDto, userId: string): Promise<OrderVo> {
    const plan = await this.planRepository.findOne({ where: { id: dto.planId } })
    if (!plan) {
      throw businessError(SubscriptionErrorCode.PLAN_NOT_EXISTS.message, {
        code: SubscriptionErrorCode.PLAN_NOT_EXISTS,
      })
    }
    // 备案落单的应用须在订阅域数据范围内（订单 appId 由计划带出）
    await this.appScopeService.assertAppAllowed(userId, plan.appId, 'subscription')
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

  /** 在线下单（在线支付渠道接入附录 §5.1 / PY10 / PY11）：校验链 → 落库 pending → 渠道预下单 */
  async createOnlineOrder(member: AuthMember, dto: OnlineOrderCreateDto): Promise<OnlineOrderCreateVo> {
    // 渠道合法性（DTO 已收窄）+ 渠道已注册（生产未配置渠道 005200005，P10）
    if (!this.providerRegistry.hasChannel(dto.channel)) {
      throw businessError(SubscriptionErrorCode.ORDER_CHANNEL_ERROR.message, {
        code: SubscriptionErrorCode.ORDER_CHANNEL_ERROR,
      })
    }
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
    // 计划应用归属（设计 §4.2 跨域下单校验）：计划所属应用的 appKey 须等于令牌绑定应用
    const app = await this.appRepository.findOne({ where: { id: plan.appId } })
    if (app?.appKey !== member.appKey) {
      throw businessError(SubscriptionErrorCode.PLAN_APP_MISMATCH.message, {
        code: SubscriptionErrorCode.PLAN_APP_MISMATCH,
      })
    }
    // S5 主拦截：周期类不可续到永久实例（此处拦截于下单前；回调侧兜底见 renewInTx）
    await this.assertNotPeriodToPermanent(member.id, plan)

    const now = new Date()
    const expireAt = new Date(now.getTime() + ORDER_PAY_TIMEOUT_HOURS * 3600 * 1000)
    // PY10 先落库后预下单：渠道侧永不出现本地查无的孤儿单，回调必有订单可认领
    const order = new OrderEntity()
    order.orderNo = this.generateOrderNo(now)
    order.memberId = member.id
    order.appId = plan.appId
    order.planId = plan.id
    order.planName = plan.name
    order.periodType = plan.periodType
    order.amount = plan.price
    order.channel = dto.channel
    order.status = ORDER_STATUS.PENDING
    order.transactionId = null
    order.paidAt = null
    order.expireAt = expireAt
    await this.orderRepository.insert(order)

    const provider = this.providerRegistry.getProvider(dto.channel)!
    try {
      const { qrCodeUrl } = await provider.createQrOrder({
        orderNo: order.orderNo,
        amountFen: order.amount,
        description: `${plan.name} · 订阅`,
        expireAt,
        notifyUrl: this.providerRegistry.buildNotifyUrl(dto.channel),
      })
      return { orderNo: order.orderNo, amount: order.amount, qrCodeUrl, expireAt: expireAt.toISOString() }
    }
    catch (error) {
      // 预下单失败立即关单留痕（closed 记录渠道错误日志），渠道侧无此单无需关闭
      await this.orderRepository.update({ id: order.id }, { status: ORDER_STATUS.CLOSED })
      this.logger.warn(
        `渠道 ${dto.channel} 预下单失败，订单 ${order.orderNo} 已关闭：${error instanceof Error ? error.message : String(error)}`,
      )
      throw businessError(SubscriptionErrorCode.ORDER_CHANNEL_ERROR.message, {
        code: SubscriptionErrorCode.ORDER_CHANNEL_ERROR,
      })
    }
  }

  /** 订单轮询（在线支付渠道接入附录 §5.2 / PY2 / PY3）：越权双校验 + pending 顺带渠道查单（节流） */
  async queryOnlineOrderStatus(member: AuthMember, orderNo: string): Promise<OnlineOrderQueryVo> {
    let order = await this.orderRepository.findOne({ where: { orderNo } })
    if (!order || !(await this.isOrderOwned(order, member))) {
      // 越权（跨应用 / 跨会员）与不存在统一文案，防订单号枚举探测（PY2）
      throw businessError(SubscriptionErrorCode.ORDER_NOT_EXISTS.message, {
        code: SubscriptionErrorCode.ORDER_NOT_EXISTS,
      })
    }
    if (order.status === ORDER_STATUS.PENDING && isOnlineChannel(order.channel)) {
      // 轮询顺带查单（P5 第二层）：距创建超 10s 且距上次渠道查单超 10s 才查
      // （仅在线渠道——offline 单无渠道侧状态，正常业务创建即 paid，异常态 pending 直接返回本地状态）
      const orderAge = Date.now() - order.createTime.getTime()
      if (orderAge >= PAY_QUERY_MIN_AGE_MS && this.queryThrottle.allow(orderNo)) {
        await this.queryChannelAndSettle(order)
        order = (await this.orderRepository.findOne({ where: { orderNo } })) ?? order
      }
    }
    if (order.status !== ORDER_STATUS.PENDING)
      this.queryThrottle.clear(orderNo)
    return { status: order.status, paidAt: order.paidAt ? order.paidAt.toISOString() : null }
  }

  /** 手动关闭待支付订单（关单前查单防护「已付被关」，附录 §6 / PY4；paid / closed 一律拒绝） */
  async closeOrder(id: string, userId: string): Promise<void> {
    const order = await this.getExistsOrder(id)
    await this.appScopeService.assertAppAllowed(userId, order.appId, 'subscription')
    if (order.status !== ORDER_STATUS.PENDING) {
      throw businessError(SubscriptionErrorCode.ORDER_STATUS_CONFLICT.message, {
        code: SubscriptionErrorCode.ORDER_STATUS_CONFLICT,
      })
    }
    if (!isOnlineChannel(order.channel)) {
      // 线下单（无渠道侧状态）：无「已付被关」风险，直接本地关单（M3 手动关单语义回归）
      await this.orderRepository.update({ id }, { status: ORDER_STATUS.CLOSED })
      this.queryThrottle.clear(order.orderNo)
      return
    }
    const provider = this.providerRegistry.getProvider(order.channel)
    if (!provider) {
      // 渠道未装配（环境配置漂移等异常态）：无法核验渠道侧状态，拒绝关单（宁可不动不可错关）
      throw businessError(SubscriptionErrorCode.ORDER_CHANNEL_ERROR.message, {
        code: SubscriptionErrorCode.ORDER_CHANNEL_ERROR,
      })
    }
    let result
    try {
      result = await provider.queryOrder(order.orderNo)
    }
    catch (error) {
      // 渠道核验失败：关单操作失败，稍后重试（资金安全优先于操作推进）
      this.logger.warn(
        `关单前渠道查单异常，订单 ${order.orderNo} 暂不关闭：${error instanceof Error ? error.message : String(error)}`,
      )
      throw businessError(SubscriptionErrorCode.ORDER_CHANNEL_ERROR.message, {
        code: SubscriptionErrorCode.ORDER_CHANNEL_ERROR,
      })
    }
    if (result.paid) {
      // 渠道已支付：受理转 paid 后按状态冲突提示（金额不符则 markPaid 原 005002004 抛出，转人工核查）
      await this.markPaid(order.orderNo, result.transactionId ?? null, result.paidAmountFen ?? null)
      throw businessError(SubscriptionErrorCode.ORDER_STATUS_CONFLICT.message, {
        code: SubscriptionErrorCode.ORDER_STATUS_CONFLICT,
      })
    }
    await this.orderRepository.update({ id }, { status: ORDER_STATUS.CLOSED })
    this.queryThrottle.clear(order.orderNo)
    await this.safeCloseChannel(provider, order.orderNo)
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

  /**
   * 惰性 / 定时兜底共用（附录 §6 / PY4）：逐单「先查渠道后关单」——
   * 渠道已支付 → markPaid 受理；渠道异常 / 渠道未装配 → 跳过不关留待下轮（资金安全优先）；
   * 未支付 → 关单 + 同步关渠道单；不受查单节流限制（sweep 是最后防线）
   */
  async closeExpiredPending(): Promise<number> {
    const expired = await this.orderRepository.find({
      where: { status: ORDER_STATUS.PENDING, expireAt: LessThan(new Date()) },
    })
    let closed = 0
    for (const order of expired) {
      if (!isOnlineChannel(order.channel)) {
        // 线下单无渠道侧状态（异常态 pending / 历史数据）：无资金风险，直接关
        await this.orderRepository.update({ id: order.id }, { status: ORDER_STATUS.CLOSED })
        closed++
        continue
      }
      const provider = this.providerRegistry.getProvider(order.channel)
      if (!provider) {
        // 在线渠道未装配（配置漂移等异常态）：留痕跳过
        this.logger.warn(`兜底关单跳过（渠道 ${order.channel} 未装配）：订单 ${order.orderNo}`)
        continue
      }
      try {
        const result = await provider.queryOrder(order.orderNo)
        if (result.paid) {
          await this.markPaid(order.orderNo, result.transactionId ?? null, result.paidAmountFen ?? null)
        }
        else {
          await this.orderRepository.update({ id: order.id }, { status: ORDER_STATUS.CLOSED })
          closed++
          await this.safeCloseChannel(provider, order.orderNo)
        }
      }
      catch (error) {
        // markPaid 业务拒绝（金额不符需人工核查）与渠道查单异常都跳过该单：留待下轮或人工
        this.logger.warn(
          `兜底关单跳过（查单 / 受理异常）：订单 ${order.orderNo}——${error instanceof Error ? error.message : String(error)}`,
        )
      }
      this.queryThrottle.clear(order.orderNo)
    }
    return closed
  }

  /** 轮询路径的渠道查单与受理：渠道已支付则 markPaid（受理异常不向轮询调用方传播，下次轮询重试） */
  private async queryChannelAndSettle(order: OrderEntity): Promise<void> {
    const provider = this.providerRegistry.getProvider(order.channel)
    if (!provider)
      return
    try {
      const result = await provider.queryOrder(order.orderNo)
      if (result.paid) {
        const markResult = await this.markPaid(
          order.orderNo,
          result.transactionId ?? null,
          result.paidAmountFen ?? null,
        )
        this.logger.log(`轮询顺带查单受理（markPaid=${markResult}）：${order.orderNo}`)
      }
    }
    catch (error) {
      this.logger.warn(
        `轮询顺带查单异常（忽略，下次轮询重试）：${order.orderNo}——${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 关单后同步关渠道侧交易；渠道关单失败不影响本地已关事实（渠道单亦随过期时间自动失效） */
  private async safeCloseChannel(provider: { closeChannelOrder(orderNo: string): Promise<void> }, orderNo: string): Promise<void> {
    try {
      await provider.closeChannelOrder(orderNo)
    }
    catch (error) {
      this.logger.warn(
        `渠道关单同步失败（渠道侧将随二维码过期自动失效）：${orderNo}——${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 订单越权校验（PY2）：会员本人 + 订单所属应用的 appKey 与请求一致 */
  private async isOrderOwned(order: OrderEntity, member: AuthMember): Promise<boolean> {
    if (order.memberId !== member.id)
      return false
    const app = await this.appRepository.findOne({
      select: ['appKey'],
      where: { id: order.appId },
      withDeleted: true,
    })
    return app?.appKey === member.appKey
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
