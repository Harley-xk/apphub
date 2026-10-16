/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员凭证实体：绑定合并的载体，一条凭证一种登录方式（统一认证设计 §2.2）。
 * 唯一约束 (credential_type, identifier) 为全表唯一（刻意含软删行，防标识被恶意抢注——主张 I9，本仓唯一非部分唯一约束）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('member_credential')
// 全表唯一（不含 WHERE deleted_at IS NULL）：软删会员的凭证不释放标识（统一认证设计 §4.2）
@Index('uk_member_credential_type_identifier', ['credentialType', 'identifier'], { unique: true })
@Index('idx_member_credential_member', ['memberId'])
export class MemberCredentialEntity extends BaseEntity {
  /** 所属会员（逻辑外键 member.id） */
  @Column({ type: 'uuid' })
  memberId: string

  /** 凭证类型：password / phone / email / wechat / alipay */
  @Column({ type: 'varchar', length: 16 })
  credentialType: string

  /** 登录标识：password=自设账号（字母数字下划线 4-32 位）/ phone=手机号 / email=邮箱 / wechat=openid / alipay=支付宝 user_id */
  @Column({ type: 'varchar', length: 128 })
  identifier: string

  /** 凭证密文：仅 password 类型使用（bcrypt 哈希），永不返回客户端 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  credentialSecret: string | null

  /** 是否已验证：phone / email 经通道回执；password / 扫码恒 true */
  @Column({ type: 'boolean', default: true })
  verified: boolean

  /** 最近使用时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null
}
