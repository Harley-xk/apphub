import { describe, expect, it } from '@jest/globals'

import { VersionService } from './version.service'
import type { AppChannelEntity } from '../entities/app-channel.entity'
import type { AppPackageEntity } from '../entities/app-package.entity'
import type { AppVersionEntity } from '../entities/app-version.entity'
import type { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import type { StorageService } from '../storage/storage.service'

type VersionRow = Partial<AppVersionEntity> & { id: string }
type PackageRow = Partial<AppPackageEntity>
type AppRow = Partial<AppEntity> & { id: string }
type ChannelRow = Partial<AppChannelEntity> & { id: string }

/** 行匹配 where 等值条件（含 Not / In / IsNull 操作符） */
function matches(row: unknown, where: Record<string, unknown> | undefined): boolean {
  if (!where)
    return true
  const record = row as Record<string, unknown>
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && 'type' in (value as Record<string, unknown>)) {
      const operator = value as { type: string, value?: unknown }
      if (operator.type === 'not')
        return record[key] !== operator.value
      if (operator.type === 'in')
        return Array.isArray(operator.value) && (operator.value as unknown[]).includes(record[key])
      if (operator.type === 'isNull')
        return record[key] === null
    }
    return record[key] === value
  })
}

function makeService(options: {
  apps?: AppRow[]
  channels?: ChannelRow[]
  versions?: VersionRow[]
  packages?: PackageRow[]
  /** 数据范围越权场景：assertAccessible 一律拒绝（APP_SCOPE_FORBIDDEN） */
  scoped?: boolean
} = {}) {
  const apps: AppRow[] = (options.apps ?? []).map(row => ({ ...row }))
  const channels: ChannelRow[] = (options.channels ?? []).map(row => ({ ...row }))
  const versions: VersionRow[] = (options.versions ?? []).map(row => ({ ...row }))
  const packages: PackageRow[] = (options.packages ?? []).map(row => ({ ...row }))
  const deletedObjectKeys: string[] = []
  // 观测 findOptions：通道内版本号查重必须携带 withDeleted（设计 §4.6——软删后不可复用）
  let usedWithDeleted = false

  const versionRepository = {
    findOne: (findOptions: { where?: Record<string, unknown>, withDeleted?: boolean }) => {
      if (findOptions.withDeleted)
        usedWithDeleted = true
      return Promise.resolve(versions.find(version => matches(version, findOptions.where)) ?? null)
    },
    find: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(versions.filter(version => matches(version, findOptions.where))),
    findAndCount: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve([
        versions.filter(version => matches(version, findOptions.where)),
        versions.length,
      ] as [VersionRow[], number]),
    save: (entity: VersionRow) => Promise.resolve(entity),
    create: (data: Partial<AppVersionEntity>) => ({ id: 'v-new', status: 'draft', ...data }),
    softRemove: (entity: VersionRow) => Promise.resolve(entity),
  }
  const packageRepository = {
    find: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(packages.filter(pkg => matches(pkg, findOptions.where))),
    softRemove: (entity: PackageRow) => Promise.resolve(entity),
  }
  // 应用可达性校验（存在性 + 数据范围）：默认放行命中应用，scoped 用例改为拒绝
  const appService = {
    assertAccessible: (_userId: string, appId: string) => {
      const app = apps.find(row => row.id === appId)
      if (options.scoped)
        return Promise.reject(Object.assign(new Error('无权操作该应用'), { code: AppcenterErrorCode.APP_SCOPE_FORBIDDEN.code }))
      if (!app)
        return Promise.reject(Object.assign(new Error('应用不存在'), { code: AppcenterErrorCode.APP_NOT_EXISTS.code }))
      return Promise.resolve(app)
    },
  }
  const channelRepository = {
    findOne: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(channels.find(channel => matches(channel, findOptions.where)) ?? null),
    find: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(channels.filter(channel => matches(channel, findOptions.where))),
  }
  const storageService: Pick<StorageService, 'deleteObject'> = {
    deleteObject: (objectKey: string) => {
      deletedObjectKeys.push(objectKey)
      return Promise.resolve()
    },
  }
  const service = new VersionService(
    versionRepository as never,
    packageRepository as never,
    channelRepository as never,
    storageService as never,
    appService as never,
  )
  return { service, deletedObjectKeys, wasWithDeletedUsed: () => usedWithDeleted }
}

const USER_ID = 'u-1'

const APP: AppRow = { id: 'a1', appKey: 'ah_demo', appType: ['desktop'], framework: 'electron', status: 'enabled' }
const CHANNEL: ChannelRow = { id: 'ch1', appId: 'a1', code: 'stable', name: '稳定版', status: 'enabled' }
const DRAFT: VersionRow = { id: 'v1', appId: 'a1', channelId: 'ch1', version: '1.0.0', title: '首发', status: 'draft', forceUpdate: false }
const PKG: PackageRow = { versionId: 'v1', platform: 'windows', arch: 'x64', fileName: 'app-1.0.0.exe', fileSize: 100, sha256: 'x'.repeat(64), ossObjectKey: 'packages/ah_demo/stable/1.0.0/windows-x64/app.exe', sha512: 'base64-sha512' }

describe('VersionService（创建与编辑）', () => {
  it('版本号非 semver 应抛 VERSION_NOT_SEMVER', async () => {
    const { service } = makeService({ apps: [APP], channels: [CHANNEL] })
    await expect(
      service.create('a1', { channelId: 'ch1', version: '1.0', title: '非法版本' }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.VERSION_NOT_SEMVER.code })
  })

  it('预发布后缀 semver 应合法（1.0.0-beta.1 < 1.0.0 语义）', async () => {
    const { service } = makeService({ apps: [APP], channels: [CHANNEL] })
    await expect(
      service.create('a1', { channelId: 'ch1', version: '1.0.0-beta.1', title: '公测' }, USER_ID),
    ).resolves.toBeDefined()
  })

  it('通道内版本号撞软删历史应拒绝（查重必须含已删行）', async () => {
    const { service, wasWithDeletedUsed } = makeService({
      apps: [APP],
      channels: [CHANNEL],
      versions: [{ ...DRAFT, deletedAt: new Date() }],
    })
    await expect(
      service.create('a1', { channelId: 'ch1', version: '1.0.0', title: '复用软删版本号' }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.VERSION_DUPLICATE.code })
    expect(wasWithDeletedUsed()).toBe(true)
  })

  it('通道不存在（含跨应用访问）应抛 CHANNEL_NOT_EXISTS', async () => {
    const { service } = makeService({ apps: [APP], channels: [{ ...CHANNEL, appId: 'a2' }] })
    await expect(
      service.create('a1', { channelId: 'ch1', version: '1.0.0', title: '首发' }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.CHANNEL_NOT_EXISTS.code })
  })

  it('published 版本仅允许改说明与强制标记：改版本号应抛状态机错误', async () => {
    const { service } = makeService({ apps: [APP], versions: [{ ...DRAFT, status: 'published' }] })
    await expect(
      service.update({ id: 'v1', version: '1.0.1' }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code })
  })

  it('published 版本可以修改说明与强制标记（发版后补救）', async () => {
    const { service } = makeService({ apps: [APP], versions: [{ ...DRAFT, status: 'published' }] })
    await expect(
      service.update({ id: 'v1', notes: '补发的更新说明', forceUpdate: true }, USER_ID),
    ).resolves.toBeUndefined()
  })

  it('offline 终态一律拒绝编辑', async () => {
    const { service } = makeService({ apps: [APP], versions: [{ ...DRAFT, status: 'offline' }] })
    await expect(
      service.update({ id: 'v1', notes: '试图改下线版本' }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code })
  })

  it('删除仅限草稿：published 应先下线', async () => {
    const { service } = makeService({ apps: [APP], versions: [{ ...DRAFT, status: 'published' }] })
    await expect(service.remove('v1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code,
    })
  })

  it('删除草稿版本应连带软删包记录并清理 OSS 对象（含 blockmap）', async () => {
    const { service, deletedObjectKeys } = makeService({
      apps: [APP],
      versions: [DRAFT],
      packages: [{ ...PKG, blockmapObjectKey: 'packages/ah_demo/stable/1.0.0/windows-x64/app.exe.blockmap' }],
    })
    await expect(service.remove('v1', USER_ID)).resolves.toBeUndefined()
    expect(deletedObjectKeys).toContain(PKG.ossObjectKey)
    expect(deletedObjectKeys).toContain('packages/ah_demo/stable/1.0.0/windows-x64/app.exe.blockmap')
  })

  it('数据范围外的版本操作应抛 APP_SCOPE_FORBIDDEN（403 专用码）', async () => {
    const { service } = makeService({ apps: [APP], versions: [DRAFT], packages: [PKG], scoped: true })
    await expect(service.publish('v1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.APP_SCOPE_FORBIDDEN.code,
    })
  })
})

describe('VersionService（发布前置校验）', () => {
  it('桌面应用无任何包记录应抛 PUBLISH_NO_PACKAGE', async () => {
    const { service } = makeService({ apps: [APP], versions: [DRAFT], packages: [] })
    await expect(service.publish('v1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.PUBLISH_NO_PACKAGE.code,
    })
  })

  it('纯 web 应用豁免包记录校验可直接发布', async () => {
    const { service } = makeService({
      apps: [{ ...APP, appType: ['web'], framework: null }],
      versions: [DRAFT],
      packages: [],
    })
    await expect(service.publish('v1', USER_ID)).resolves.toBeUndefined()
  })

  it('electron 应用缺 sha512 应抛 FRAMEWORK_ARTIFACT_MISSING（主张 A5）', async () => {
    const { service } = makeService({ apps: [APP], versions: [DRAFT], packages: [{ ...PKG, sha512: null }] })
    await expect(service.publish('v1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING.code,
    })
  })

  it('tauri 应用缺 minisign 签名应抛 FRAMEWORK_ARTIFACT_MISSING（主张 A5）', async () => {
    const { service } = makeService({
      apps: [{ ...APP, framework: 'tauri' }],
      versions: [DRAFT],
      packages: [{ ...PKG, sha512: null, minisignSignature: null }],
    })
    await expect(service.publish('v1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING.code,
    })
  })

  it('校验通过应置 published 并落发布时间', async () => {
    let saved: VersionRow | undefined
    const versions: VersionRow[] = [{ ...DRAFT }]
    const { service } = makeService({ apps: [APP], versions, packages: [PKG] })
    // 观测 save 收到的实体（桩 save 原样返回，不回写数组——直接拦截）
    ;(service as unknown as { versionRepository: { save: (e: VersionRow) => Promise<VersionRow> } }).versionRepository.save = (entity) => {
      saved = entity
      return Promise.resolve(entity)
    }
    await expect(service.publish('v1', USER_ID)).resolves.toBeUndefined()
    expect(saved?.status).toBe('published')
    expect(saved?.publishedAt).toBeInstanceOf(Date)
  })

  it('非 draft 状态不允许发布', async () => {
    const { service } = makeService({ apps: [APP], versions: [{ ...DRAFT, status: 'offline' }], packages: [PKG] })
    await expect(service.publish('v1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code,
    })
  })

  it('下线仅限已发布版本', async () => {
    const { service } = makeService({ apps: [APP], versions: [DRAFT] })
    await expect(service.offline('v1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code,
    })
  })
})

describe('VersionService（更新候选查询）', () => {
  const APP2: AppRow = { id: 'a1', appKey: 'ah_demo', appType: ['desktop'], framework: null, status: 'enabled' }

  it('候选应为 semver 最大者而非字符串最大者（1.10.0 > 1.9.0 > 1.2.0）', async () => {
    const { service } = makeService({
      apps: [APP2],
      channels: [CHANNEL],
      versions: [
        { ...DRAFT, id: 'v100', version: '1.0.0', status: 'published' },
        { ...DRAFT, id: 'v110', version: '1.10.0', status: 'published' },
        { ...DRAFT, id: 'v190', version: '1.9.0', status: 'published' },
      ],
      packages: [
        { ...PKG, versionId: 'v100' },
        { ...PKG, versionId: 'v110' },
        { ...PKG, versionId: 'v190' },
      ],
    })
    const candidate = await service.findUpdateCandidate({
      app: APP2 as AppEntity,
      channelCode: 'stable',
      platform: 'windows',
      arch: 'x64',
    })
    expect(candidate?.version.version).toBe('1.10.0')
    expect(candidate?.packages).toHaveLength(1)
  })

  it('未挂目标平台包的版本不应成为候选（版本平台过滤）', async () => {
    const { service } = makeService({
      apps: [APP2],
      channels: [CHANNEL],
      versions: [{ ...DRAFT, status: 'published' }],
      packages: [{ ...PKG, platform: 'linux' }],
    })
    const candidate = await service.findUpdateCandidate({
      app: APP2 as AppEntity,
      channelCode: 'stable',
      platform: 'windows',
      arch: 'x64',
    })
    expect(candidate).toBeNull()
  })

  it('arch 为 null 的平台（android）应按 IS NULL 匹配', async () => {
    const { service } = makeService({
      apps: [APP2],
      channels: [CHANNEL],
      versions: [{ ...DRAFT, status: 'published' }],
      packages: [{ ...PKG, platform: 'android', arch: null }],
    })
    const candidate = await service.findUpdateCandidate({
      app: APP2 as AppEntity,
      channelCode: 'stable',
      platform: 'android',
      arch: null,
    })
    expect(candidate?.version.id).toBe('v1')
  })

  it('通道停用应返回无候选（更新检测返回无更新）', async () => {
    const { service } = makeService({
      apps: [APP2],
      channels: [{ ...CHANNEL, status: 'disabled' }],
      versions: [{ ...DRAFT, status: 'published' }],
      packages: [PKG],
    })
    const candidate = await service.findUpdateCandidate({
      app: APP2 as AppEntity,
      channelCode: 'stable',
      platform: 'windows',
      arch: 'x64',
    })
    expect(candidate).toBeNull()
  })

  it('draft 版本不参与候选（仅 published 可见）', async () => {
    const { service } = makeService({
      apps: [APP2],
      channels: [CHANNEL],
      versions: [{ ...DRAFT, status: 'draft' }],
      packages: [PKG],
    })
    const candidate = await service.findUpdateCandidate({
      app: APP2 as AppEntity,
      channelCode: 'stable',
      platform: 'windows',
      arch: 'x64',
    })
    expect(candidate).toBeNull()
  })
})

describe('VersionService（列表支持平台）', () => {
  const PUBLISHED: VersionRow = { ...DRAFT, id: 'v2', version: '1.0.0', status: 'published', createTime: new Date('2026-10-01') }
  const NEXT_DRAFT: VersionRow = { ...DRAFT, id: 'v3', version: '1.1.0', status: 'draft', createTime: new Date('2026-10-02') }

  it('版本行按自身包记录展示支持平台（成对去重 + 稳定排序，与版本状态无关）', async () => {
    const { service } = makeService({
      apps: [APP],
      channels: [CHANNEL],
      versions: [PUBLISHED, NEXT_DRAFT],
      packages: [
        { versionId: 'v2', platform: 'linux', arch: 'x64' },
        { versionId: 'v2', platform: 'windows', arch: 'x64' },
        { versionId: 'v2', platform: 'windows', arch: 'x64' },
        { versionId: 'v2', platform: 'windows', arch: 'arm64' },
        { versionId: 'v3', platform: 'android', arch: null },
      ],
    })
    const page = await service.getPage('a1', { pageNo: 1, pageSize: 10 }, USER_ID)
    const targetsByVersion = new Map(page.list.map(vo => [vo.version, vo.packageTargets]))
    expect(targetsByVersion.get('1.0.0')).toEqual([
      { platform: 'windows', arch: 'x64' },
      { platform: 'windows', arch: 'arm64' },
      { platform: 'linux', arch: 'x64' },
    ])
    expect(targetsByVersion.get('1.1.0')).toEqual([{ platform: 'android', arch: null }])
  })

  it('无包记录的版本支持平台为空数组（前端显示 -）', async () => {
    const { service } = makeService({
      apps: [APP],
      channels: [CHANNEL],
      versions: [NEXT_DRAFT],
    })
    const page = await service.getPage('a1', { pageNo: 1, pageSize: 10 }, USER_ID)
    expect(page.list[0]?.packageTargets).toEqual([])
  })
})
