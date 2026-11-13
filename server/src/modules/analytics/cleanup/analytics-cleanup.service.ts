/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 日表保留期清理：每日 03:00 删除超过保留月数的日表行（幂等，多实例重复执行无副作用，设计 §6）
 */
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'

import { subtractMonths, toShanghaiDateKey } from '../activity/activity.range'
import { ACTIVITY_DEFAULT_RETENTION_MONTHS } from '../analytics.constants'
import { AnalyticsDeviceDayEntity } from '../entities/analytics-device-day.entity'

const DAY_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 每日清理时刻（Asia/Shanghai 03:00，低峰期） */
const CLEANUP_HOUR = 3

@Injectable()
export class AnalyticsCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsCleanupService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    @InjectRepository(AnalyticsDeviceDayEntity)
    private readonly dayRepository: Repository<AnalyticsDeviceDayEntity>,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduleNext()
  }

  onApplicationShutdown(): void {
    if (this.timer)
      clearTimeout(this.timer)
  }

  /** 删除 stat_date < 今天 - 保留月数 的日表行（设备表长期保留） */
  async cleanup(now: Date = new Date()): Promise<number> {
    const retentionMonths = this.configService.get<number>('analytics.retentionMonths')
      ?? ACTIVITY_DEFAULT_RETENTION_MONTHS
    const cutoff = subtractMonths(toShanghaiDateKey(now), retentionMonths)
    const result = await this.dayRepository
      .createQueryBuilder()
      .delete()
      .from(AnalyticsDeviceDayEntity)
      .where('stat_date < :cutoff', { cutoff })
      .execute()
    const affected = result.affected ?? 0
    if (affected > 0)
      this.logger.log(`活跃度日表清理完成：删除 ${affected} 行（cutoff=${cutoff}）`)
    return affected
  }

  /** 递归定时：计算距下一个 03:00（Asia/Shanghai）的毫秒数，执行后重新排期 */
  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      this.cleanup()
        .catch((error: unknown) => {
          this.logger.error(
            `活跃度日表清理失败：${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          )
        })
        .finally(() => this.scheduleNext())
    }, this.delayToNextRun())
    // 不阻塞进程退出（CLI / 测试场景下事件循环不因定时器挂住）
    this.timer.unref?.()
  }

  /** 距下一个 03:00 的毫秒数（上海固定 UTC+8，按偏移后的日历分量计算） */
  private delayToNextRun(now: Date = new Date()): number {
    const shiftedMs = now.getTime() + SHANGHAI_OFFSET_MS
    const dayStartMs = Math.floor(shiftedMs / DAY_MS) * DAY_MS
    let targetMs = dayStartMs + CLEANUP_HOUR * 60 * 60 * 1000
    if (targetMs <= shiftedMs)
      targetMs += DAY_MS
    return targetMs - shiftedMs
  }
}
