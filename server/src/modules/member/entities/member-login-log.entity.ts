/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员登录日志实体：member 域独立于 system 域登录日志（字段面向开放 API 场景），流水只增不改，
 * 不继承 BaseEntity（同 system_login_log 先例：无审计无软删，物理删除）
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('member_login_log')
@Index('idx_member_login_log_member', ['memberId'])
@Index('idx_member_login_log_time', ['loginTime'])
@Index('idx_member_login_log_app_key', ['appKey'])
export class MemberLoginLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  /** 会员 id（登录失败且无法确定归属时为 null） */
  @Column({ type: 'uuid', nullable: true })
  memberId: string | null

  /** 来源应用 AppKey */
  @Column({ type: 'varchar', length: 32 })
  appKey: string

  /** 凭证类型（常量见 member.constants.ts） */
  @Column({ type: 'varchar', length: 16 })
  credentialType: string

  /** 登录标识（失败也留痕，供风控回溯；管理端不展示明文手机号场景由查询侧脱敏） */
  @Column({ type: 'varchar', length: 128 })
  identifier: string

  /** 日志类型：10 登录 / 20 登出 */
  @Column({ type: 'smallint' })
  logType: number

  /** 结果码：成功 0 / 业务码 */
  @Column({ type: 'int' })
  resultCode: number

  /** 结果消息 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  resultMsg: string | null

  /** 客户端 IP */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null

  /** 客户端 User-Agent */
  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent: string | null

  /** 事件时间（登录 / 登出发生时刻） */
  @Column({ type: 'timestamptz' })
  loginTime: Date

  /** 落库时间（异步入库，晚于 loginTime） */
  @CreateDateColumn({ type: 'timestamptz' })
  createTime: Date
}
