/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 更新通道实体：通道由应用自定义（D9），创建应用时自动预置 stable 且不可删除（主张 A1）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('app_channel')
// 部分唯一索引：应用内通道 code 唯一（软删历史占位由应用层 withDeleted 查重覆盖，设计 §4.6）
@Index('uk_app_channel_app_code', ['appId', 'code'], { where: 'deleted_at IS NULL' })
export class AppChannelEntity extends BaseEntity {
  /** 所属应用 id */
  @Column({ type: 'uuid' })
  appId: string

  /** 通道代码：应用内唯一，如 stable / beta / internal */
  @Column({ type: 'varchar', length: 32 })
  code: string

  /** 通道显示名 */
  @Column({ type: 'varchar', length: 64 })
  name: string

  /** 状态：enabled / disabled（停用后该通道的更新检测返回无更新） */
  @Column({ type: 'varchar', length: 16 })
  status: string

  /** 排序 */
  @Column({ type: 'int', default: 0 })
  sort: number
}
