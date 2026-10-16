/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅顺延引擎（D20 单实例顺延）：订单支付成功后在事务内驱动订阅实例的四分支流转（设计 §2.2）。
 * 完全由订单快照驱动（periodType / planId），不回查计划——计划删除不影响续费语义
 */
import { Injectable, Logger } from '@nestjs/common'
import type { EntityManager } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
import type { OrderEntity } from '../entities/order.entity'
import { SubscriptionEntity } from '../entities/subscription.entity'
import { SubscriptionErrorCode } from '../error-codes'
import { calcExpireAt, isPermanentExpire } from '../subscription-period'
import {
  PERIOD_MONTHS,
  PERMANENT_EXPIRE_AT,
  type PeriodType,
} from '../subscription.constants'

/** 顺延结果：created 新开 / extended 未过期顺延 / revived 过期复活 / permanent_kept 永久覆盖 / conflict 周期续永久（S5 兜底，订阅未变） */
export type RenewOutcome = 'created' | 'extended' | 'revived' | 'permanent_kept' | 'conflict'

@Injectable()
export class SubscriptionRenewService {
  private readonly logger = new Logger(SubscriptionRenewService.name)

  /**
   * 事务内顺延（manager 由调用方传入，与订单状态变更同事务）：
   * - 无实例 → 创建（T = now）
   * - 实例未过期 → 在原到期时刻上顺延（T = 原 expire_at，顺延不满不亏）
   * - 实例已过期 → 从当下起算复活（T = now）
   * - 购买永久档 → 到期写哨兵值（覆盖，此后再续周期类由下单侧拦截）
   * - 周期类续到永久实例 → conflict，不改订阅（主拦截在下单侧 005003002，此处为回调时序兜底，主张 S5）
   */
  async renewInTx(manager: EntityManager, order: OrderEntity, now: Date): Promise<RenewOutcome> {
    const repository = manager.getRepository(SubscriptionEntity)
    const existing = await repository.findOne({
      where: { memberId: order.memberId, appId: order.appId },
    })

    if (!existing) {
      const entity = new SubscriptionEntity()
      entity.memberId = order.memberId
      entity.appId = order.appId
      entity.planId = order.planId
      entity.startAt = now
      entity.expireAt = this.calcNextExpireAt(now, order.periodType)
      entity.lastRenewAt = now
      await repository.insert(entity)
      return 'created'
    }

    let expireAt: Date
    let outcome: RenewOutcome
    if (order.periodType === 'permanent') {
      // 永久覆盖：无论原状态一律写哨兵（幂等）
      expireAt = PERMANENT_EXPIRE_AT
      outcome = 'permanent_kept'
    }
    else if (isPermanentExpire(existing.expireAt)) {
      // S5 兜底：pending 期间该会员经其他渠道已成永久，周期回调到达——订阅保持永久，调用方记日志留痕
      this.logger.error(
        `回调时序冲突：订单 ${order.orderNo} 为周期类但订阅实例已永久，订阅保持不变（需人工对账）`,
      )
      return 'conflict'
    }
    else if (existing.expireAt.getTime() > now.getTime()) {
      expireAt = this.calcNextExpireAt(existing.expireAt, order.periodType)
      outcome = 'extended'
    }
    else {
      expireAt = this.calcNextExpireAt(now, order.periodType)
      outcome = 'revived'
    }

    existing.planId = order.planId
    existing.expireAt = expireAt
    existing.lastRenewAt = now
    await repository.save(existing)
    return outcome
  }

  /** 按订单周期快照计算下一到期时刻（permanent 写哨兵；周期档缺失映射属数据异常，防御性拒绝） */
  private calcNextExpireAt(start: Date, periodType: string): Date {
    if (periodType === 'permanent')
      return PERMANENT_EXPIRE_AT
    const months = PERIOD_MONTHS[periodType as Exclude<PeriodType, 'permanent'>]
    if (!months) {
      throw businessError(SubscriptionErrorCode.SUBSCRIPTION_RENEW_FAILED.message, {
        code: SubscriptionErrorCode.SUBSCRIPTION_RENEW_FAILED,
      })
    }
    return calcExpireAt(start, months)
  }
}
