/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 设备-日状态行实体：同一设备 / 自然日 / 会员键 / 维度组合只保留一行，上报直接 upsert（设计 §3.1，AT1）
 */
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 聚合状态行，不继承 BaseEntity（无审计与软删语义，先例 member_login_log）。
 * 唯一键包含会员键与维度快照：匿名用全零 UUID 哨兵填充（AT10）。
 */
@Entity('analytics_device_day')
@Index(
  'uk_analytics_device_day',
  ['appId', 'statDate', 'deviceId', 'memberId', 'platform', 'arch', 'clientVersion'],
  { unique: true },
)
@Index('idx_analytics_device_day_app_date', ['appId', 'statDate'])
@Index('idx_analytics_device_day_app_member', ['appId', 'memberId', 'statDate'])
export class AnalyticsDeviceDayEntity {
  /** 代理主键（唯一事实源仍是上方的业务唯一键，id 仅供 ORM 定位行） */
  @PrimaryGeneratedColumn('uuid')
  id: string

  /** 应用 id：服务端由签名层 AppKey 解析，不信任客户端自报 */
  @Column({ type: 'uuid' })
  appId: string

  /** 自然日（occurred_at 在 Asia/Shanghai 下的日期） */
  @Column({ type: 'date' })
  statDate: string

  /** 客户端生成并持久化的设备标识 */
  @Column({ type: 'varchar', length: 64 })
  deviceId: string

  /** 会员 id：严格切分，匿名行填全零哨兵（AT3 / AT10） */
  @Column({ type: 'uuid' })
  memberId: string

  /** 平台快照（取值同 PACKAGE_PLATFORM） */
  @Column({ type: 'varchar', length: 16 })
  platform: string

  /** 架构快照，空值用空串占位（规避 NULL 唯一性语义） */
  @Column({ type: 'varchar', length: 16, default: '' })
  arch: string

  /** 客户端版本快照（semver） */
  @Column({ type: 'varchar', length: 32 })
  clientVersion: string

  /** 当天是否上报过启动（仅窗口可见的启动） */
  @Column({ type: 'boolean' })
  hasStart: boolean

  /** 当天是否发生过窗口激活（含跨天补偿），日活口径唯一依据 */
  @Column({ type: 'boolean' })
  hasActivate: boolean

  /** 当天是否上报过退出 */
  @Column({ type: 'boolean' })
  hasStop: boolean

  /** 当天该组合最早事件时间 */
  @Column({ type: 'timestamptz' })
  firstAt: Date

  /** 当天该组合最晚事件时间 */
  @Column({ type: 'timestamptz' })
  lastAt: Date
}
