import { describe, expect, it, jest } from '@jest/globals'

import { AppService } from './app.service'
import type { AppChannelEntity } from '../entities/app-channel.entity'
import type { AppPackageEntity } from '../entities/app-package.entity'
import type { AppVersionEntity } from '../entities/app-version.entity'
import type { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'

type AppRow = Partial<AppEntity> & { id: string }
type ChannelRow = Partial<AppChannelEntity>
type VersionRow = Partial<AppVersionEntity> & { id: string }
type PackageRow = Partial<AppPackageEntity>

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
      if (operator.type === 'in')
        return Array.isArray(operator.value) && (operator.value as unknown[]).includes(record[key])
      if (operator.type === 'like')
        return typeof record[key] === 'string' && typeof operator.value === 'string'
          && record[key].includes(operator.value.replaceAll('%', ''))
    }
    return record[key] === value
  })
}

/** 行匹配 where（数组形态为 OR 语义，供 listOptions 的名称 / AppKey 双条件使用） */
function matchWhere(row: unknown, where: Record<string, unknown> | Record<string, unknown>[] | undefined): boolean {
  if (!where)
    return true
  const conditions = Array.isArray(where) ? where : [where]
  return conditions.some(condition => matches(row, condition))
}

function makeService(options: {
  apps?: AppRow[]
  versions?: VersionRow[]
  packages?: PackageRow[]
  publishedCount?: number
  scopeAppIds?: string[] | null
  /** 图标对象键 → 体积（HeadObject 校验的数据面） */
  iconHeads?: Record<string, number>
} = {}) {
  const apps: AppRow[] = (options.apps ?? []).map(row => ({ ...row }))
  const versions: VersionRow[] = (options.versions ?? []).map(row => ({ ...row }))
  const packages: PackageRow[] = (options.packages ?? []).map(row => ({ ...row }))
  const savedChannels: ChannelRow[] = []
  const deletedObjectKeys: string[] = []
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
    find: ({ where }: { where?: Record<string, unknown> | Record<string, unknown>[] }) =>
      Promise.resolve(apps.filter(app => matchWhere(app, where))),
    findAndCount: ({ where }: { where?: Record<string, unknown> | Record<string, unknown>[] }) => {
      const list = apps.filter(app => matchWhere(app, where))
      return Promise.resolve([list, list.length] as [AppRow[], number])
    },
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
    find: ({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(versions.filter(version => matches(version, where))),
  }
  const packageRepository = {
    find: ({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(packages.filter(pkg => matches(pkg, where))),
  }
  // 数据范围桩：默认 ALL（null），按用例覆盖为 SCOPED 集合
  const assertAppAllowed = jest.fn(() => Promise.resolve())
  const appScopeService = {
    getListAppIds: () => Promise.resolve(options.scopeAppIds === undefined ? null : options.scopeAppIds),
    assertAppAllowed,
  }
  // 存储桩：图标凭证签发 / HeadObject 校验 / 旧对象清理与签名预览的观测点
  const iconHeads = options.iconHeads ?? {}
  const storageService = {
    isConfigured: () => true,
    issueIconUploadCredential: (objectKey: string) =>
      Promise.resolve({
        region: 'oss-cn-hangzhou',
        bucket: 'apphub-test',
        objectKey,
        accessKeyId: 'sts-ak',
        accessKeySecret: 'sts-sk',
        securityToken: 'sts-token',
        expiration: '2026-10-23T11:00:00Z',
      }),
    headObject: (objectKey: string) =>
      Promise.resolve(objectKey in iconHeads ? { contentLength: iconHeads[objectKey] } : null),
    deleteObject: (objectKey: string) => {
      deletedObjectKeys.push(objectKey)
      return Promise.resolve()
    },
    signGetUrl: (objectKey: string) => `https://oss.example.com/${objectKey}?Signature=test`,
  }
  const service = new AppService(
    appRepository as never,
    versionRepository as never,
    packageRepository as never,
    appScopeService as never,
    storageService as never,
  )
  return { service, savedChannels, assertAppAllowed, deletedObjectKeys, getSoftRemovedCount: () => softRemovedCount }
}

/** 用例通用调用者 id */
const USER_ID = 'u-1'

describe('AppService', () => {
  it('注册应用应在事务内预置 stable 通道（主张 A1：客户端默认有通道可用）', async () => {
    const { service, savedChannels } = makeService()
    await service.create(CREATE_DTO)
    expect(savedChannels).toHaveLength(1)
    expect(savedChannels[0]).toMatchObject({ code: 'stable', name: '稳定版', status: 'enabled' })
  })

  it('按 AppKey 查应用时空值应短路返回 null 且不触达仓储（缺 X-App-Key 不得退化为任意行）', async () => {
    const findOne = jest.fn()
    const service = new AppService({ findOne } as never, {} as never, {} as never, {} as never, {} as never)
    // 运行时缺 X-App-Key 头时 @Headers 装饰器注入 undefined（类型断言模拟该运行时形态）
    await expect(service.findByAppKey(undefined as unknown as string)).resolves.toBeNull()
    await expect(service.findByAppKey('')).resolves.toBeNull()
    expect(findOne).not.toHaveBeenCalled()
  })

  it('注册应用应响应完整凭证', async () => {
    const { service } = makeService()
    const credential = await service.create(CREATE_DTO)
    expect(credential.appKey).toMatch(/^ah_[a-z0-9]{16}$/)
    expect(credential.appSecret).toMatch(/^[a-z0-9]{32}$/)
  })

  it('查看凭证应按需返回明文且经数据范围校验（越权查看须被拒）', async () => {
    const { service, assertAppAllowed } = makeService({
      apps: [{ id: 'a1', appKey: 'ah_demo', appSecret: 'plain-secret-000000000000000000', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
    })
    const credential = await service.getSecret('a1', USER_ID)
    expect(credential).toEqual({ id: 'a1', appKey: 'ah_demo', appSecret: 'plain-secret-000000000000000000' })
    expect(assertAppAllowed).toHaveBeenCalledWith(USER_ID, 'a1', 'appcenter')
  })

  it('数据范围外查看凭证应在校验处失败且不出参 Secret（先拒后取）', async () => {
    const { service, assertAppAllowed } = makeService({
      apps: [{ id: 'a1', appKey: 'ah_demo', appSecret: 'should-not-leak-0000000000000000', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
    })
    assertAppAllowed.mockRejectedValueOnce(new Error('forbidden'))
    await expect(service.getSecret('a1', USER_ID)).rejects.toThrow('forbidden')
  })

  it('应用详情出参不得携带 Secret（敏感信息不得泄漏）', async () => {
    const { service } = makeService({
      apps: [{ id: 'a1', appKey: 'ah_demo', appSecret: 'secret-should-not-leak', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
    })
    const vo = await service.get('a1', USER_ID)
    expect(Object.keys(vo)).not.toContain('appSecret')
  })

  it('重置 Secret 应返回新凭证且与旧值不同（旧凭证立即失效，D22）', async () => {
    const apps: AppRow[] = [{ id: 'a1', appKey: 'ah_demo', appSecret: 'old-secret-0000000000000000', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }]
    const { service } = makeService({ apps })
    const credential = await service.resetSecret('a1', USER_ID)
    expect(credential.appSecret).toMatch(/^[a-z0-9]{32}$/)
    expect(credential.appSecret).not.toBe(apps[0]?.appSecret)
  })

  it('应用不存在应抛 APP_NOT_EXISTS', async () => {
    const { service } = makeService()
    await expect(service.get('ghost', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.APP_NOT_EXISTS.code,
    })
  })

  it('存在已发布版本时不允许删除应用（先下线版本）', async () => {
    const { service } = makeService({
      apps: [{ id: 'a1', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
      publishedCount: 2,
    })
    await expect(service.remove('a1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.APP_HAS_PUBLISHED_VERSION.code,
    })
  })

  it('无已发布版本时删除应走软删（通道 / 版本历史保留可追溯）', async () => {
    const { service, getSoftRemovedCount } = makeService({
      apps: [{ id: 'a1', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
    })
    await expect(service.remove('a1', USER_ID)).resolves.toBeUndefined()
    expect(getSoftRemovedCount()).toBe(1)
  })

  it('应用列表应按数据范围收窄（SCOPED 仅返回授权应用）', async () => {
    const { service } = makeService({
      scopeAppIds: ['a1'],
      apps: [
        { id: 'a1', name: '授权应用', appType: [], clientType: 'public', status: 'enabled', sort: 0 },
        { id: 'a2', name: '未授权应用', appType: [], clientType: 'public', status: 'enabled', sort: 0 },
      ],
    })
    const page = await service.getPage({ pageNo: 1, pageSize: 10 }, USER_ID)
    expect(page.list.map(app => app.id)).toEqual(['a1'])
    expect(page.total).toBe(1)
  })

  it('授权集合为空时应用列表应返回空页（fail-closed，A5）', async () => {
    const { service } = makeService({ scopeAppIds: [], apps: [{ id: 'a1', name: '任意应用', appType: [], clientType: 'public', status: 'enabled', sort: 0 }] })
    const page = await service.getPage({ pageNo: 1, pageSize: 10 }, USER_ID)
    expect(page).toEqual({ list: [], total: 0 })
  })

  it('应用列表支持平台应只聚合已发布版本的包（草稿 / 已下线不计入，主张 A6）', async () => {
    const { service } = makeService({
      apps: [{ id: 'a1', name: '演示', appType: ['desktop'], clientType: 'public', status: 'enabled', sort: 0 }],
      versions: [
        { id: 'v1', appId: 'a1', status: 'published' },
        { id: 'v2', appId: 'a1', status: 'published' },
        { id: 'v3', appId: 'a1', status: 'draft' },
        { id: 'v4', appId: 'a1', status: 'offline' },
      ],
      packages: [
        { versionId: 'v1', platform: 'windows', arch: 'x64' },
        { versionId: 'v2', platform: 'windows', arch: 'x64' },
        { versionId: 'v2', platform: 'macos', arch: 'arm64' },
        { versionId: 'v3', platform: 'linux', arch: 'x64' },
        { versionId: 'v4', platform: 'android', arch: null },
      ],
    })
    const page = await service.getPage({ pageNo: 1, pageSize: 10 }, USER_ID)
    // 跨已在发布版本重复的 (windows, x64) 只保留一项；草稿 / 已下线的包不参与应用级聚合
    expect(page.list[0]?.packageTargets).toEqual([
      { platform: 'windows', arch: 'x64' },
      { platform: 'macos', arch: 'arm64' },
    ])
  })

  it('应用详情应携带与列表同口径的支持平台（复用聚合路径）', async () => {
    const { service } = makeService({
      apps: [{ id: 'a1', name: '演示', appType: ['desktop'], clientType: 'public', status: 'enabled', sort: 0 }],
      versions: [{ id: 'v1', appId: 'a1', status: 'published' }],
      packages: [{ versionId: 'v1', platform: 'linux', arch: 'x64' }],
    })
    const vo = await service.get('a1', USER_ID)
    expect(vo.packageTargets).toEqual([{ platform: 'linux', arch: 'x64' }])
  })

  it('应用下拉应同时支持名称与 AppKey 匹配且受数据范围收窄', async () => {
    const { service } = makeService({
      scopeAppIds: ['a1', 'a2'],
      apps: [
        { id: 'a1', appKey: 'ah_alpha', name: '阿尔法', appType: [], clientType: 'public', status: 'enabled', sort: 0 },
        { id: 'a2', appKey: 'ah_beta', name: '贝塔', appType: [], clientType: 'public', status: 'enabled', sort: 0 },
      ],
    })
    const byKey = await service.listOptions({ keyword: 'beta' }, USER_ID)
    expect(byKey.map(app => app.id)).toEqual(['a2'])
    const byName = await service.listOptions({ keyword: '阿尔法' }, USER_ID)
    expect(byName.map(app => app.id)).toEqual(['a1'])
  })

  it('单资源操作应委托数据范围校验（越权由 AppScopeService 抛 403 专用码）', async () => {
    const { service, assertAppAllowed } = makeService({
      apps: [{ id: 'a1', name: '演示', appType: [], clientType: 'public', status: 'enabled', sort: 0 }],
    })
    await service.get('a1', USER_ID)
    expect(assertAppAllowed).toHaveBeenCalledWith(USER_ID, 'a1', 'appcenter')
  })
})

describe('AppService 应用图标（应用图标上传设计）', () => {
  const APP_ROW = (iconUrl: string | null): AppRow => ({
    id: 'a1',
    appKey: 'ah_demo',
    name: '演示',
    appType: [],
    clientType: 'public',
    iconUrl,
    status: 'enabled',
    sort: 0,
  })

  it('签发图标凭证应生成 icons/ 前缀对象键并归一扩展名（前端不自由拼键）', async () => {
    const { service } = makeService()
    const token = await service.issueIconUploadToken({ fileName: 'Logo.PNG' })
    expect(token.objectKey).toMatch(/^icons\/\d{8}\/[0-9a-f-]{36}\.png$/)
  })

  it('未上传完成的对象键保存应抛 003001006（HeadObject 兜底）', async () => {
    const { service } = makeService()
    await expect(
      service.create({ ...CREATE_DTO, iconUrl: 'icons/20261023/missing.png' }),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.ICON_OBJECT_NOT_EXISTS.code })
  })

  it('超过 2MB 的图标对象应抛 003001007', async () => {
    const key = 'icons/20261023/big.png'
    const { service } = makeService({ iconHeads: { [key]: 2 * 1024 * 1024 + 1 } })
    await expect(
      service.create({ ...CREATE_DTO, iconUrl: key }),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.ICON_TOO_LARGE.code })
  })

  it('已上传对象键应原样落库，出参另签发 2h 预览地址（iconUrl 仍可用于回填）', async () => {
    const key = 'icons/20261023/ok.png'
    const { service } = makeService({ apps: [APP_ROW(key)] })
    const vo = await service.get('a1', USER_ID)
    expect(vo.iconUrl).toBe(key)
    expect(vo.iconPreviewUrl).toBe(`https://oss.example.com/${key}?Signature=test`)
  })

  it('历史 http(s) 地址应原样作为预览且不参与对象校验 / 清理（无归属对象）', async () => {
    const { service, deletedObjectKeys } = makeService({
      apps: [APP_ROW('https://cdn.example.com/logo.png')],
    })
    const vo = await service.get('a1', USER_ID)
    expect(vo.iconPreviewUrl).toBe('https://cdn.example.com/logo.png')
    await service.update(
      { id: 'a1', name: '演示', appType: ['desktop'], iconUrl: 'https://cdn.example.com/logo.png' },
      USER_ID,
    )
    expect(deletedObjectKeys).toHaveLength(0)
  })

  it('编辑替换图标应清理旧对象，删除应用应清理当前对象（IC7）', async () => {
    const oldKey = 'icons/20261023/old.png'
    const newKey = 'icons/20261023/new.png'
    const { service, deletedObjectKeys } = makeService({
      iconHeads: { [newKey]: 1024 },
      apps: [APP_ROW(oldKey)],
    })
    await service.update({ id: 'a1', name: '演示', appType: ['desktop'], iconUrl: newKey }, USER_ID)
    expect(deletedObjectKeys).toEqual([oldKey])
    await service.remove('a1', USER_ID)
    expect(deletedObjectKeys).toEqual([oldKey, newKey])
  })

  it('非对象键且非 http(s) 的图标地址应被拒绝（防止脏值入库）', async () => {
    const { service } = makeService()
    await expect(
      service.create({ ...CREATE_DTO, iconUrl: 'logo.png' }),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.ICON_INVALID_ADDRESS.code })
  })
})
