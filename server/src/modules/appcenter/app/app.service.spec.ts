import { describe, expect, it } from '@jest/globals'

import type { AppChannelEntity } from '../entities/app-channel.entity'
import type { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import { AppService } from './app.service'

type AppRow = Partial<AppEntity> & { id: string }
type ChannelRow = Partial<AppChannelEntity>

const CREATE_DTO = {
  name: '示例桌面应用',
  appType: ['desktop'],
  clientType: 'public',
}

/** 行匹配 where 等值条件 */
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

function makeService(options: { apps?: AppRow[], publishedCount?: number } = {}) {
  const apps: AppRow[] = (options.apps ?? []).map(row => ({ ...row }))
  const savedChannels: ChannelRow[] = []
  let softRemovedCount = 0
  // 事务桩：getRepository 按实体名分流，save 记录写入行（预置 stable 通道契约的观测点）
  const manager = {
    getRepository: (entity: { name?: string }) => {
      const isAppEntity = entity.name === 'AppEntity'
      return {
        save: (entityRow: Partial<AppEntity> | Partial<AppChannelEntity>) => {
          if (!isAppEntity)
            savedChannels.push(entityRow)
          return Promise.resolve(entityRow)
        },
        create: (data: Partial<AppEntity> | Partial<AppChannelEntity>) => ({ ...data }),
      }
    },
  }
  const appRepository = {
    findOne: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(apps.find(app => matches(app, where)) ?? null),
    save: (entity: AppRow) => Promise.resolve(entity),
    softRemove: (entity: AppRow) => {
      softRemovedCount++
      return Promise.resolve(entity)
    },
    // 事务桩：直接回调传入同一 manager（无真实回滚语义，仅驱动被测路径）
    manager: {
      transaction: <T>(run: (m: unknown) => Promise<T>) => run(manager),
    },
  }
  const versionRepository = {
    count: () => Promise.resolve(options.publishedCount ?? 0),
  }
  const service = new AppService(appRepository as never, versionRepository as never)
  return { service, savedChannels, getSoftRemovedCount: () => softRemovedCount }
}

describe('AppService', () => {
  it('注册应用应在事务内预置 stable 通道（主张 A1：客户端默认有通道可用）', async () => {
    const { service, savedChannels } = makeService()
    await service.create(CREATE_DTO)
    expect(savedChannels).toHaveLength(1)
    expect(savedChannels[0]).toMatchObject({ code: 'stable', name: '稳定版', status: 'enabled' })
  })

  it('注册应用应响应完整凭证（创建后仅此一次可见，D22）', async () => {
    const { service } = makeService()
    const credential = await service.create(CREATE_DTO)
    expect(credential.appKey).toMatch(/^ah_[a-z0-9]{16}$/)
    expect(credential.appSecret).toMatch(/^[a-z0-9]{32}$/)
  })

  it('应用详情出参不得携带 Secret（敏感信息不得泄漏）', async () => {
    const { service } = makeService({
      apps: [{ id: 'a1', appKey: 'ah_demo', appSecret: 'secret-should-not-leak', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
    })
    const vo = await service.get('a1')
    expect(Object.keys(vo)).not.toContain('appSecret')
  })

  it('重置 Secret 应返回新凭证且与旧值不同（旧凭证立即失效，D22）', async () => {
    const apps: AppRow[] = [{ id: 'a1', appKey: 'ah_demo', appSecret: 'old-secret-0000000000000000', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }]
    const { service } = makeService({ apps })
    const credential = await service.resetSecret('a1')
    expect(credential.appSecret).toMatch(/^[a-z0-9]{32}$/)
    expect(credential.appSecret).not.toBe(apps[0]?.appSecret)
  })

  it('应用不存在应抛 APP_NOT_EXISTS', async () => {
    const { service } = makeService()
    await expect(service.get('ghost')).rejects.toMatchObject({
      code: AppcenterErrorCode.APP_NOT_EXISTS.code,
    })
  })

  it('存在已发布版本时不允许删除应用（先下线版本）', async () => {
    const { service } = makeService({
      apps: [{ id: 'a1', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
      publishedCount: 2,
    })
    await expect(service.remove('a1')).rejects.toMatchObject({
      code: AppcenterErrorCode.APP_HAS_PUBLISHED_VERSION.code,
    })
  })

  it('无已发布版本时删除应走软删（通道 / 版本历史保留可追溯）', async () => {
    const { service, getSoftRemovedCount } = makeService({
      apps: [{ id: 'a1', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
    })
    await expect(service.remove('a1')).resolves.toBeUndefined()
    expect(getSoftRemovedCount()).toBe(1)
  })
})
