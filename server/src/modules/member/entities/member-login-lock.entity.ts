/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 登录失败锁定计数实体：防爆破状态载体（重启不丢，统一认证设计 §2.5 / §3.3），
 * 纯计数状态表不继承 BaseEntity（无审计无软删语义，计数变更即更新行）
 */
import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity('member_login_lock')
// 锁定维度 (app_key, credential_type, identifier) 唯一（主张 I4）
@Index('uk_member_login_lock_dimension', ['appKey', 'credentialType', 'identifier'], { unique: true })
export class MemberLoginLockEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  /** 应用维度 */
  @Column({ type: 'varchar', length: 32 })
  appKey: string

  /** 凭证类型维度 */
  @Column({ type: 'varchar', length: 16 })
  credentialType: string

  /** 登录标识维度 */
  @Column({ type: 'varchar', length: 128 })
  identifier: string

  /** 连续失败次数（成功登录即清零） */
  @Column({ type: 'int', default: 0 })
  failCount: number

  /** 锁定截止时间（null 未锁定） */
  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null

  /** 最近一次失败时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastFailAt: Date | null

  /** 最近更新时间（计数 / 解锁变更） */
  @UpdateDateColumn({ type: 'timestamptz' })
  updateTime: Date
}
