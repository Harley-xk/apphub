/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅计划实体：应用维度的在售商品（周期 × 价格），订单侧以快照引用（订阅与支付设计 §2.1）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('sub_plan')
@Index('idx_sub_plan_app', ['appId'])
export class SubPlanEntity extends BaseEntity {
  /** 所属应用（逻辑外键 app.id） */
  @Column({ type: 'uuid' })
  appId: string

  /** 计划名（如「专业版 · 年付」） */
  @Column({ type: 'varchar', length: 64 })
  name: string

  /** 周期档位：monthly / quarterly / yearly / permanent */
  @Column({ type: 'varchar', length: 16 })
  periodType: string

  /** 周期月数：1 / 3 / 12（permanent 为 null，由服务端按档位映射，不信任前端） */
  @Column({ type: 'int', nullable: true })
  durationMonths: number | null

  /** 现价，单位分（整数杜绝浮点误差） */
  @Column({ type: 'int' })
  price: number

  /** 划线原价（分，展示用） */
  @Column({ type: 'int', nullable: true })
  originalPrice: number | null

  /** 状态：on 在售 / off 下架（下架不可新购，存量订阅不受影响） */
  @Column({ type: 'varchar', length: 16 })
  status: string

  /** 排序（开放端点按 sort 升序输出） */
  @Column({ type: 'int', default: 0 })
  sort: number

  /** 备注 */
  @Column({ type: 'varchar', length: 512, nullable: true })
  remark: string | null
}
