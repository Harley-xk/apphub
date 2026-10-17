/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 验证码域（内存）：生成 / 频控（60s 重发间隔 + 自然日限额）/ 单次作废校验（认证方式扩展设计 §3.1）。
 * key 按 identifier 全局（不含 appKey，C10）；发送成功才落存（C9），重启全丢由用户重发兜底（单实例前提）
 */
import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import { randomInt } from 'node:crypto'

import { MemberErrorCode } from '../error-codes'
import {
  CREDENTIAL_TYPE,
  VERIFY_CODE_CLEANUP_INTERVAL_MS,
  VERIFY_CODE_DAILY_LIMIT,
  VERIFY_CODE_LENGTH,
  VERIFY_CODE_RESEND_INTERVAL_MS,
  VERIFY_CODE_TTL_MS,
} from '../member.constants'
import type { CodeSender } from './code-sender/code-sender'
import { MAIL_CODE_SENDER, SMS_CODE_SENDER } from './code-sender/code-sender'
import { businessError } from '../../../common/exceptions/business-error'

/** 活动验证码条目 */
interface CodeEntry {
  code: string
  expiresAt: number
}

/** 自然日计数条目 */
interface DailyEntry {
  day: string
  count: number
}

@Injectable()
export class CaptchaService implements OnApplicationShutdown {
  private readonly logger = new Logger(CaptchaService.name)

  /** 活动验证码（key = `${type}:${identifier}`） */
  private readonly codes = new Map<string, CodeEntry>()
  /** 最近一次成功发送时间：重发间隔基准，独立于验证码条目（作废后间隔仍生效） */
  private readonly sentAtMap = new Map<string, number>()
  /** 自然日发送计数（全局维度限额，C10） */
  private readonly daily = new Map<string, DailyEntry>()
  private readonly cleanupTimer: NodeJS.Timeout

  constructor(
    @Inject(SMS_CODE_SENDER) private readonly smsSender: CodeSender,
    @Inject(MAIL_CODE_SENDER) private readonly mailSender: CodeSender,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), VERIFY_CODE_CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref()
  }

  onApplicationShutdown(): void {
    clearInterval(this.cleanupTimer)
  }

  /** 发送验证码：间隔 → 日限 → 生成 → 通道发送 → 成功才落存计次（失败不占间隔，C9） */
  async send(type: string, identifier: string): Promise<void> {
    const key = this.keyOf(type, identifier)
    const now = this.readTime()

    const sentAt = this.sentAtMap.get(key)
    if (sentAt !== undefined && now - sentAt < VERIFY_CODE_RESEND_INTERVAL_MS) {
      throw businessError(MemberErrorCode.VERIFY_CODE_TOO_FREQUENT.message, {
        code: MemberErrorCode.VERIFY_CODE_TOO_FREQUENT,
      })
    }

    const day = this.dayKeyOf(now)
    const dailyEntry = this.daily.get(key)
    if (dailyEntry?.day === day && dailyEntry.count >= VERIFY_CODE_DAILY_LIMIT) {
      throw businessError(MemberErrorCode.VERIFY_CODE_DAILY_LIMIT.message, {
        code: MemberErrorCode.VERIFY_CODE_DAILY_LIMIT,
      })
    }

    const code = this.generateCode()
    try {
      await this.getSender(type).send(identifier, code)
    }
    catch (err) {
      // 通道失败不落存不计次：用户可立即换通道重试或稍后重试，不被失败发送占去间隔与额度
      this.logger.error(`验证码通道发送失败（${type}）：${(err as Error)?.message ?? err}`)
      throw businessError(MemberErrorCode.VERIFY_CODE_SEND_FAILED.message, {
        code: MemberErrorCode.VERIFY_CODE_SEND_FAILED,
      })
    }

    this.codes.set(key, { code, expiresAt: now + VERIFY_CODE_TTL_MS })
    this.sentAtMap.set(key, now)
    if (dailyEntry?.day === day) {
      dailyEntry.count += 1
    }
    else {
      this.daily.set(key, { day, count: 1 })
    }
  }

  /** 校验：查无 / 过期 / 不符一律 false；条目无论成败即删（单次作废，C6） */
  verify(type: string, identifier: string, code: string): boolean {
    const key = this.keyOf(type, identifier)
    const entry = this.codes.get(key)
    this.codes.delete(key)
    if (!entry) {
      return false
    }
    if (this.readTime() > entry.expiresAt) {
      return false
    }
    return entry.code === code
  }

  /** 时间源：protected 供测试子类覆写推进时钟 */
  protected readTime(): number {
    return Date.now()
  }

  private getSender(type: string): CodeSender {
    if (type === CREDENTIAL_TYPE.PHONE) {
      return this.smsSender
    }
    if (type === CREDENTIAL_TYPE.EMAIL) {
      return this.mailSender
    }
    throw new Error(`验证码类型无对应通道：${type}`)
  }

  private keyOf(type: string, identifier: string): string {
    return `${type}:${identifier}`
  }

  /** 自然日 key：服务器本地时区（YYYY-MM-DD） */
  private dayKeyOf(now: number): string {
    const date = new Date(now)
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }

  private generateCode(): string {
    return `${randomInt(0, 10 ** VERIFY_CODE_LENGTH)}`.padStart(VERIFY_CODE_LENGTH, '0')
  }

  /** 定期清理：过期验证码、超过最大生命周期的发送时间戳、非当日的日计数 */
  private cleanup(): void {
    const now = this.readTime()
    const day = this.dayKeyOf(now)
    for (const [key, entry] of this.codes) {
      if (now > entry.expiresAt) {
        this.codes.delete(key)
      }
    }
    for (const [key, sentAt] of this.sentAtMap) {
      // 间隔窗口 + 一日余量之后的发送时间戳不再有频控意义
      if (now - sentAt > VERIFY_CODE_RESEND_INTERVAL_MS + 24 * 60 * 60 * 1000) {
        this.sentAtMap.delete(key)
      }
    }
    for (const [key, entry] of this.daily) {
      if (entry.day !== day) {
        this.daily.delete(key)
      }
    }
  }
}
