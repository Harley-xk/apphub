/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员实体：终端用户身份信息载体，自身不承载登录能力（凭证全部在 member_credential，统一认证设计 §2.1）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('member')
@Index('idx_member_status', ['status'])
export class MemberEntity extends BaseEntity {
  /** 昵称（注册未填时自动生成兜底，如「用户a1b2c3」） */
  @Column({ type: 'varchar', length: 64 })
  nickname: string

  /** 头像 */
  @Column({ type: 'varchar', length: 512, nullable: true })
  avatarUrl: string | null

  /** 状态：active / disabled（禁用后全部令牌即时失效——逐请求查库） */
  @Column({ type: 'varchar', length: 16 })
  status: string

  /** 首次注册来源应用（逻辑外键 app.id，统计用） */
  @Column({ type: 'uuid', nullable: true })
  registeredAppId: string | null

  /** 最近登录时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null
}
