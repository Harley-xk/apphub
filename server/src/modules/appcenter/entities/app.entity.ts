/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用实体：平台管理的基本单元，持有开放 API 调用凭证（AppKey / AppSecret，明文存库——数据库独立部署隔离）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('app')
// 部分唯一索引：软删历史行不占位（app_key 随机生成冲突概率极低，生成侧查重兜底）
@Index('uk_app_app_key', ['appKey'], { where: 'deleted_at IS NULL' })
export class AppEntity extends BaseEntity {
  /** 应用标识：`ah_` + 16 位随机小写字母数字，创建时生成（展示与接口携带用） */
  @Column({ type: 'varchar', length: 32 })
  appKey: string

  /** 调用凭证：32 位随机串，明文存库；管理端仅创建 / 重置后完整显示一次 */
  @Column({ type: 'varchar', length: 64 })
  appSecret: string

  /** 应用名称 */
  @Column({ type: 'varchar', length: 64 })
  name: string

  /** 形态标签：desktop / web / mobile 的组合，仅作管理归类与页面提示 */
  @Column({ type: 'varchar', length: 32, array: true })
  appType: string[]

  /** 调用方类型：confidential（有后端，Secret 存服务端）/ public（客户端直连，Secret 编译进二进制）——风控差异化依据（D17） */
  @Column({ type: 'varchar', length: 16 })
  clientType: string

  /** 技术框架归类：electron / tauri / custom——适配端点产物登记的校验依据（D24 主张 A5），纯管理归类不影响运行时 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  framework: string | null

  /** 应用图标（OSS 地址） */
  @Column({ type: 'varchar', length: 512, nullable: true })
  iconUrl: string | null

  /** 应用描述 */
  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null

  /** 状态：enabled / disabled（停用后其开放 API 调用全部拒绝） */
  @Column({ type: 'varchar', length: 16 })
  status: string

  /** 排序 */
  @Column({ type: 'int', default: 0 })
  sort: number
}
