/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员刷新令牌实体：原文仅返回客户端一次，库存 SHA-256；生命周期经 status 表达（active/revoked），
 * 不继承 BaseEntity（同 system_login_log 先例：无审计无软删语义，吊销即改 status，行保留供轮换审计）
 */
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('member_refresh_token')
@Index('uk_member_refresh_token_hash', ['tokenHash'], { unique: true })
@Index('idx_member_refresh_token_member', ['memberId'])
export class MemberRefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  /** 所属会员（逻辑外键 member.id） */
  @Column({ type: 'uuid' })
  memberId: string

  /** 签发应用（逻辑外键 app.id，令牌绑定应用 D19） */
  @Column({ type: 'uuid' })
  appId: string

  /** refresh token 的 SHA-256（不存原文） */
  @Column({ type: 'char', length: 64 })
  tokenHash: string

  /** 过期时间（签发起 30d） */
  @Column({ type: 'timestamptz' })
  expiresAt: Date

  /** 状态：active / revoked（登出 / 轮换 / 改密 / 禁用时吊销） */
  @Column({ type: 'varchar', length: 16 })
  status: string

  /** 签发时来源 IP（风控留痕） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  createdIp: string | null

  /** 签发时间 */
  @Column({ type: 'timestamptz' })
  createdAt: Date
}
