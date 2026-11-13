import { describe, expect, it } from '@jest/globals'
import type { ConfigService } from '@nestjs/config'
import type { Repository } from 'typeorm'

import { AnalyticsCleanupService } from './analytics-cleanup.service'
import { AnalyticsDeviceDayEntity } from '../entities/analytics-device-day.entity'

describe('AnalyticsCleanupService', () => {
  it('应按保留月数计算上海自然日截断并删除更早的行', async () => {
    let cutoff: unknown
    const repository = {
      createQueryBuilder: () => {
        const builder: Record<string, unknown> = {}
        for (const method of ['delete', 'from', 'where'])
          builder[method] = () => builder
        builder.execute = () => Promise.resolve({ affected: 3 })
        builder.where = (_condition: string, params: { cutoff: string }) => {
          cutoff = params.cutoff
          return builder
        }
        return builder
      },
    } as unknown as Repository<AnalyticsDeviceDayEntity>
    const configService = { get: () => 24 } as unknown as ConfigService
    const service = new AnalyticsCleanupService(repository, configService)
    const affected = await service.cleanup(new Date('2026-11-13T04:00:00Z'))
    expect(affected).toBe(3)
    // 上海 2026-11-13 减 24 个月
    expect(cutoff).toBe('2024-11-13')
  })
})
