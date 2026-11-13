/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 设备画像实体：按 (app_id, device_id) 建档，first_seen_at 首次窗口激活后不再覆盖（设计 §3.2）
 */
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 设备画像，不继承 BaseEntity（无审计与软删语义）。
 * 不记录会员归属：严格切分下设备与会员没有持久绑定关系（AD4）。
 */
@Entity('analytics_device')
@Index('uk_analytics_device', ['appId', 'deviceId'], { unique: true })
@Index('idx_analytics_device_first_seen', ['appId', 'firstSeenAt'])
export class AnalyticsDeviceEntity {
  /** 代理主键（业务唯一键为 app_id + device_id） */
  @PrimaryGeneratedColumn('uuid')
  id: string

  /** 设备按应用分别建档（同一安装实例装多个应用时各占一行） */
  @Column({ type: 'uuid' })
  appId: string

  /** 客户端生成并持久化的设备标识 */
  @Column({ type: 'varchar', length: 64 })
  deviceId: string

  /** 最近一次上报的平台 */
  @Column({ type: 'varchar', length: 16 })
  platform: string

  /** 最近一次上报的架构（web / 移动端可为空） */
  @Column({ type: 'varchar', length: 16, nullable: true })
  arch: string | null

  /** 最近一次上报的版本 */
  @Column({ type: 'varchar', length: 32 })
  lastVersion: string

  /** 首次窗口激活时间（新增设备口径），首写后不再覆盖 */
  @Column({ type: 'timestamptz' })
  firstSeenAt: Date

  /** 最近一次上报时间 */
  @Column({ type: 'timestamptz' })
  lastSeenAt: Date
}
