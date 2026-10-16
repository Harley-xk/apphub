/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用版本实体：状态机 draft → published → offline（设计 §3.2），一个版本只属于一个通道，跨通道发布需新建版本
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('app_version')
// 部分唯一索引：通道内版本号唯一（软删历史占位由应用层 withDeleted 查重覆盖，设计 §4.6——软删后版本号不可复用）
@Index('uk_app_version_scope', ['appId', 'channelId', 'version'], { unique: true, where: 'deleted_at IS NULL' })
export class AppVersionEntity extends BaseEntity {
  /** 所属应用 id */
  @Column({ type: 'uuid' })
  appId: string

  /** 所属通道 id */
  @Column({ type: 'uuid' })
  channelId: string

  /** 版本号：semver 格式强制校验（service 层 semver.valid，DTO 只限长度） */
  @Column({ type: 'varchar', length: 32 })
  version: string

  /** 版本标题（如「1.3.0 性能优化版」） */
  @Column({ type: 'varchar', length: 128 })
  title: string

  /** 更新说明（多行纯文本；manifest 渲染时 force_update 为 true 首行前置 [force] 标记，D24） */
  @Column({ type: 'text', nullable: true })
  notes: string | null

  /** 强制更新标记：单一事实源，两种协议渲染（自研 forceUpdate 字段 / manifest notes 首行 [force]） */
  @Column({ type: 'boolean', default: false })
  forceUpdate: boolean

  /** 状态机：draft / published / offline（offline 为终态） */
  @Column({ type: 'varchar', length: 16 })
  status: string

  /** 发布时间 */
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null
}
