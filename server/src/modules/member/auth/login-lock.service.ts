/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 登录失败锁定服务：同 (appKey, credentialType, identifier) 连续失败计数，达阈值锁 15 分钟（统一认证设计 §3.3，维度收紧主张 I4）
 */
import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'

import { MemberLoginLockEntity } from '../entities/member-login-lock.entity'
import { LOGIN_LOCK_MAX_FAILURES, LOGIN_LOCK_MINUTES } from '../member.constants'

@Injectable()
export class LoginLockService {
  private readonly logger = new Logger(LoginLockService.name)

  constructor(
    @InjectRepository(MemberLoginLockEntity)
    private readonly lockRepository: Repository<MemberLoginLockEntity>,
  ) {}

  /** 锁定中返回截止时间，未锁定返回 null（锁定已过期视同未锁定） */
  async getLockedUntil(appKey: string, credentialType: string, identifier: string): Promise<Date | null> {
    const row = await this.findRow(appKey, credentialType, identifier)
    if (!row?.lockedUntil)
      return null
    return row.lockedUntil.getTime() > Date.now() ? row.lockedUntil : null
  }

  /** 记一次失败：计数累加，达到阈值置锁定截止时间（锁定过期后的失败从 0 重新计数） */
  async recordFailure(appKey: string, credentialType: string, identifier: string): Promise<void> {
    const now = new Date()
    const existing = await this.findRow(appKey, credentialType, identifier)
    if (!existing) {
      const entity = new MemberLoginLockEntity()
      entity.appKey = appKey
      entity.credentialType = credentialType
      entity.identifier = identifier
      entity.failCount = 1
      entity.lastFailAt = now
      try {
        await this.lockRepository.insert(entity)
      }
      catch (error: unknown) {
        // 并发首次插入撞唯一键（两请求同时失败）：退化为累加路径，计数不丢
        this.logger.warn(`登录锁定计数插入冲突，转为累加：${(error as Error)?.message ?? error}`)
        await this.lockRepository.increment(
          { appKey, credentialType, identifier },
          'failCount',
          1,
        )
      }
    }
    else {
      // 锁定已过期：清零重计（上一轮惩罚已结束，不叠加历史）
      const expired = existing.lockedUntil instanceof Date && existing.lockedUntil.getTime() <= now.getTime()
      await this.lockRepository.update(existing.id, {
        failCount: expired ? 1 : existing.failCount + 1,
        lastFailAt: now,
      })
    }

    const row = await this.findRow(appKey, credentialType, identifier)
    if (row && row.failCount >= LOGIN_LOCK_MAX_FAILURES) {
      const lockedUntil = new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000)
      await this.lockRepository.update(row.id, { lockedUntil })
      this.logger.warn(`登录失败锁定：${appKey} ${credentialType} ${identifier}，截止 ${lockedUntil.toISOString()}`)
    }
  }

  /** 记一次成功：清除计数（成功登录即清零，统一认证设计 §3.3） */
  async recordSuccess(appKey: string, credentialType: string, identifier: string): Promise<void> {
    await this.lockRepository.delete({ appKey, credentialType, identifier })
  }

  private findRow(appKey: string, credentialType: string, identifier: string): Promise<MemberLoginLockEntity | null> {
    return this.lockRepository.findOne({ where: { appKey, credentialType, identifier } })
  }
}
