/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅订单实体：线下备案与在线渠道共用（对账按 channel 筛选）；携带计划名/周期/金额快照（设计 §2.3、§4.3）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('order')
@Index('uk_order_no', ['orderNo'], { unique: true })
@Index('idx_order_member', ['memberId'])
@Index('idx_order_app', ['appId'])
@Index('idx_order_status_expire', ['status', 'expireAt'])
export class OrderEntity extends BaseEntity {
  /** 订单号：AH + yyMMddHHmmss + 6 位随机（可读前缀 + 时间 + 随机防枚举） */
  @Column({ type: 'varchar', length: 32 })
  orderNo: string

  /** 购买会员（逻辑外键 member.id） */
  @Column({ type: 'uuid' })
  memberId: string

  /** 应用（逻辑外键 app.id） */
  @Column({ type: 'uuid' })
  appId: string

  /** 计划（逻辑外键 sub_plan.id，历史订单不受计划删除影响） */
  @Column({ type: 'uuid' })
  planId: string

  /** 计划名快照（防改名 / 删除影响对账） */
  @Column({ type: 'varchar', length: 64 })
  planName: string

  /** 周期快照 */
  @Column({ type: 'varchar', length: 16 })
  periodType: string

  /** 应付金额（分）= 下单时计划价格快照（线下备案为经办人录入值） */
  @Column({ type: 'int' })
  amount: number

  /** 支付渠道：wechat / alipay / offline */
  @Column({ type: 'varchar', length: 16 })
  channel: string

  /** 状态机：pending → paid / closed（设计 §3.2） */
  @Column({ type: 'varchar', length: 16 })
  status: string

  /** 渠道交易号（回调回填；线下为转账流水号选填） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  transactionId: string | null

  /** 支付完成时间 */
  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null

  /** 待支付过期时间（下单 + 2h，超时关单） */
  @Column({ type: 'timestamptz' })
  expireAt: Date

  /** 线下备案备注（收款凭证说明，经办留痕走审计列） */
  @Column({ type: 'varchar', length: 512, nullable: true })
  offlineNote: string | null
}
