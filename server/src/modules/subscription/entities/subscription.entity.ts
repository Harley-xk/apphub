/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅实例实体：会员 × 应用唯一（D20 单实例顺延的根基）；状态由 expire_at 实时推导不落列（主张 S2）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('subscription')
@Index('uk_subscription_member_app', ['memberId', 'appId'], { unique: true, where: 'deleted_at IS NULL' })
@Index('idx_subscription_app', ['appId'])
export class SubscriptionEntity extends BaseEntity {
  /** 会员（逻辑外键 member.id） */
  @Column({ type: 'uuid' })
  memberId: string

  /** 应用（逻辑外键 app.id） */
  @Column({ type: 'uuid' })
  appId: string

  /** 当前生效计划（最近一次购买，逻辑外键 sub_plan.id） */
  @Column({ type: 'uuid' })
  planId: string

  /** 首次开通时间 */
  @Column({ type: 'timestamptz' })
  startAt: Date

  /** 到期时间（永久买断写哨兵值 2999-12-31 23:59:59+00，判定统一为 expire_at > now） */
  @Column({ type: 'timestamptz' })
  expireAt: Date

  /** 最近续费时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastRenewAt: Date | null
}
