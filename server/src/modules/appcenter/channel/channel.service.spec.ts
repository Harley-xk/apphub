import { describe, expect, it } from '@jest/globals'

import type { AppChannelEntity } from '../entities/app-channel.entity'
import { AppcenterErrorCode } from '../error-codes'
import { ChannelService } from './channel.service'

type ChannelRow = Partial<AppChannelEntity> & { id: string, appId: string }

/** 行匹配 where 等值条件（含 Not 操作符：查重排除自身用） */
function matches(row: unknown, where: Record<string, unknown> | undefined): boolean {
  if (!where)
    return true
  const record = row as Record<string, unknown>
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && 'type' in (value as Record<string, unknown>)) {
      const operator = value as { type: string, value: unknown }
      if (operator.type === 'not')
        return record[key] !== operator.value
    }
    return record[key] === value
  })
}

function makeService(options: { channels?: ChannelRow[] } = {}) {
  const channels: ChannelRow[] = (options.channels ?? []).map(row => ({ ...row }))
  // 观测 findOptions：查重必须携带 withDeleted（设计 §4.6 唯一性含软删——删后不可复用）
  const findOneOptions: { withDeleted?: boolean }[] = []
  let softRemovedCount = 0
  const channelRepository = {
    findOne: (options: { where?: Record<string, unknown>, withDeleted?: boolean }) => {
      findOneOptions.push(options)
      return Promise.resolve(channels.find(channel => matches(channel, options.where)) ?? null)
    },
    find: () => Promise.resolve(channels),
    save: (entity: Partial<AppChannelEntity>) => Promise.resolve({ id: 'c-new', ...entity }),
    create: (data: Partial<AppChannelEntity>) => ({ ...data }),
    softRemove: (entity: ChannelRow) => {
      softRemovedCount++
      return Promise.resolve(entity)
    },
  }
  const service = new ChannelService(channelRepository as never)
  return { service, findOneOptions, getSoftRemovedCount: () => softRemovedCount }
}

const STABLE: ChannelRow = { id: 'c1', appId: 'a1', code: 'stable', name: '稳定版', status: 'enabled', sort: 0 }
const BETA: ChannelRow = { id: 'c2', appId: 'a1', code: 'beta', name: '公测版', status: 'enabled', sort: 1 }

describe('ChannelService', () => {
  it('创建通道 code 撞软删历史应拒绝（查重必须含已删行）', async () => {
    const { service, findOneOptions } = makeService({ channels: [{ ...BETA, deletedAt: new Date() }] })
    await expect(
      service.create('a1', { code: 'beta', name: '新版公测' }),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.CHANNEL_CODE_DUPLICATE.code })
    // 契约守护：查重 findOne 收到 withDeleted: true
    expect(findOneOptions.some(option => option.withDeleted === true)).toBe(true)
  })

  it('应用内 code 不冲突时创建成功（跨应用同 code 不受影响）', async () => {
    const { service } = makeService({ channels: [{ ...BETA, appId: 'a2' }] })
    await expect(
      service.create('a1', { code: 'beta', name: '公测版' }),
    ).resolves.toBe('c-new')
  })

  it('stable 通道不允许删除（主张 A1：客户端默认通道保障）', async () => {
    const { service } = makeService({ channels: [STABLE] })
    await expect(service.remove('a1', 'c1')).rejects.toMatchObject({
      code: AppcenterErrorCode.STABLE_CHANNEL_UNREMOVABLE.code,
    })
  })

  it('非 stable 通道删除走软删', async () => {
    const { service, getSoftRemovedCount } = makeService({ channels: [STABLE, BETA] })
    await expect(service.remove('a1', 'c2')).resolves.toBeUndefined()
    expect(getSoftRemovedCount()).toBe(1)
  })

  it('通道不存在（含跨应用访问）应抛 CHANNEL_NOT_EXISTS', async () => {
    const { service } = makeService({ channels: [BETA] })
    await expect(service.update('a1', 'ghost', { name: '改名' })).rejects.toMatchObject({
      code: AppcenterErrorCode.CHANNEL_NOT_EXISTS.code,
    })
  })
})
