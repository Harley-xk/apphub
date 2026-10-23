/*
 * 作者: Harley-xk
 * 创建: 2026-10-23
 *
 * 描述: 账户-应用授权实体：纯关联值对象，物理删除（差集增量绑定，同 user-role 理由——软删会被唯一索引历史行占位打穿）
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('system_user_app_scope')
@Index('uk_system_user_app_scope', ['userId', 'appId'], { unique: true })
export class UserAppScopeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  /** 用户 id（逻辑外键，不加物理约束） */
  @Column({ type: 'uuid' })
  userId: string

  /** 应用 id（逻辑外键，不加物理约束；应用软删后授权行保留但不再生效） */
  @Column({ type: 'uuid' })
  appId: string

  /** 绑定时间 */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date
}
