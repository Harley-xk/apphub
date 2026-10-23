import { describe, expect, it } from '@jest/globals'

import { PackageService } from './package.service'
import type { AppChannelEntity } from '../entities/app-channel.entity'
import type { AppPackageEntity } from '../entities/app-package.entity'
import type { AppVersionEntity } from '../entities/app-version.entity'
import type { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import type { ObjectHead, StorageService, UploadCredentialVo } from '../storage/storage.service'

type VersionRow = Partial<AppVersionEntity> & { id: string }
type PackageRow = Partial<AppPackageEntity>
type AppRow = Partial<AppEntity> & { id: string }
type ChannelRow = Partial<AppChannelEntity> & { id: string }

/** 行匹配 where 等值条件（含 IsNull 操作符：arch 为 null 的占用校验） */
function matches(row: unknown, where: Record<string, unknown> | undefined): boolean {
  if (!where)
    return true
  const record = row as Record<string, unknown>
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && 'type' in (value as Record<string, unknown>)) {
      const operator = value as { type: string, value?: unknown }
      if (operator.type === 'isNull')
        return record[key] === null
    }
    return record[key] === value
  })
}

const USER_ID = 'u-1'

const APP: AppRow = { id: 'a1', appKey: 'ah_demo', appType: ['desktop'], framework: 'electron', status: 'enabled' }
const CHANNEL: ChannelRow = { id: 'ch1', appId: 'a1', code: 'stable', name: '稳定版', status: 'enabled' }
const DRAFT: VersionRow = { id: 'v1', appId: 'a1', channelId: 'ch1', version: '1.3.0', title: '新版本', status: 'draft', forceUpdate: false }

function makeService(options: {
  apps?: AppRow[]
  channels?: ChannelRow[]
  versions?: VersionRow[]
  packages?: PackageRow[]
  heads?: Record<string, ObjectHead | null>
} = {}) {
  const apps: AppRow[] = (options.apps ?? []).map(row => ({ ...row }))
  const channels: ChannelRow[] = (options.channels ?? []).map(row => ({ ...row }))
  const versions: VersionRow[] = (options.versions ?? []).map(row => ({ ...row }))
  const packages: PackageRow[] = (options.packages ?? []).map(row => ({ ...row }))
  const heads: Record<string, ObjectHead | null> = options.heads ?? {}
  const issuedCredentials: { objectKey: string, blockmapObjectKey: string }[] = []
  const deletedObjectKeys: string[] = []
  const savedPackages: PackageRow[] = []

  const packageRepository = {
    find: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(packages.filter(pkg => matches(pkg, findOptions.where))),
    findOne: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(packages.find(pkg => matches(pkg, findOptions.where)) ?? null),
    save: (entity: PackageRow) => {
      savedPackages.push(entity)
      return Promise.resolve({ id: 'pkg-new', ...entity })
    },
    create: (data: Partial<AppPackageEntity>) => ({ ...data }),
    softRemove: (entity: PackageRow) => Promise.resolve(entity),
  }
  const versionRepository = {
    findOne: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(versions.find(version => matches(version, findOptions.where)) ?? null),
  }
  const appRepository = {
    findOne: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(apps.find(app => matches(app, findOptions.where)) ?? null),
  }
  const channelRepository = {
    findOne: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(channels.find(channel => matches(channel, findOptions.where)) ?? null),
  }
  const storageService = {
    issueUploadCredential: (input: { objectKey: string, blockmapObjectKey: string }) => {
      issuedCredentials.push(input)
      return Promise.resolve({
        region: 'oss-cn-hangzhou', bucket: 'bkt', accessKeyId: 'ak', accessKeySecret: 'sk',
        securityToken: 'token', expiration: '2026-10-16T13:00:00Z', ...input,
      } satisfies UploadCredentialVo)
    },
    headObject: (objectKey: string) => Promise.resolve(heads[objectKey] ?? null),
    deleteObject: (objectKey: string) => {
      deletedObjectKeys.push(objectKey)
      return Promise.resolve()
    },
  }
  // 应用可达性校验（存在性 + 数据范围）：包实体无 appId，经 versionId → appId 反查后委托
  const appService = { assertAccessible: () => Promise.resolve(APP) }
  const service = new PackageService(
    packageRepository as never,
    versionRepository as never,
    appRepository as never,
    channelRepository as never,
    storageService as StorageService,
    appService as never,
  )
  return { service, issuedCredentials, deletedObjectKeys, savedPackages }
}

describe('PackageService（直传凭证）', () => {
  it('对象键应按后端规范生成并随凭证下发（前端不自由拼键）', async () => {
    const { service, issuedCredentials } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT] })
    await service.issueUploadToken('v1', { platform: 'windows', arch: 'x64', fileName: 'app-setup-1.3.0.exe' }, USER_ID)
    expect(issuedCredentials[0]?.objectKey).toBe('packages/ah_demo/stable/1.3.0/windows-x64/app-setup-1.3.0.exe')
    expect(issuedCredentials[0]?.blockmapObjectKey).toBe('packages/ah_demo/stable/1.3.0/windows-x64/app-setup-1.3.0.exe.blockmap')
  })

  it('非草稿版本不允许申请凭证（状态机）', async () => {
    const { service } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'published' }],
    })
    await expect(
      service.issueUploadToken('v1', { platform: 'windows', arch: 'x64', fileName: 'a.exe' }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code })
  })

  it('平台 / 架构组合已占用应拒绝（含 arch 为 null 的组合）', async () => {
    const { service } = makeService({
      apps: [APP],
      channels: [CHANNEL],
      versions: [DRAFT],
      packages: [{ versionId: 'v1', platform: 'android', arch: null, fileName: 'a.apk', fileSize: 1, sha256: 'x', ossObjectKey: 'k' }],
    })
    await expect(
      service.issueUploadToken('v1', { platform: 'android', fileName: 'b.apk' }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.PACKAGE_PLATFORM_DUPLICATE.code })
  })
})

describe('PackageService（登记）', () => {
  const HEADS: Record<string, ObjectHead> = {
    'packages/ah_demo/stable/1.3.0/windows-x64/a.exe': { contentLength: 1048576 },
    'packages/ah_demo/stable/1.3.0/windows-x64/a.exe.blockmap': { contentLength: 4096 },
  }

  it('file_size 应以服务端 HeadObject 的 content-length 为准（前端不声明）', async () => {
    const { service, savedPackages } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [DRAFT], heads: HEADS,
    })
    await service.register('v1', {
      platform: 'windows', arch: 'x64', fileName: 'a.exe',
      objectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe',
      sha256: 'a'.repeat(64),
    }, USER_ID)
    expect(savedPackages[0]?.fileSize).toBe(1048576)
  })

  it('对象未上传（HeadObject 404）应抛 PACKAGE_OBJECT_NOT_EXISTS', async () => {
    const { service } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT] })
    await expect(
      service.register('v1', {
        platform: 'windows', arch: 'x64', fileName: 'a.exe',
        objectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe',
        sha256: 'a'.repeat(64),
      }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.PACKAGE_OBJECT_NOT_EXISTS.code })
  })

  it('ios 元信息登记豁免对象键与 HeadObject（占位哈希与零字节）', async () => {
    const { service, savedPackages } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT] })
    await service.register('v1', {
      platform: 'ios', fileName: 'App Store', sha256: '0'.repeat(64),
    }, USER_ID)
    expect(savedPackages[0]?.ossObjectKey).toBe('')
    expect(savedPackages[0]?.fileSize).toBe(0)
  })

  it('声明了 blockmap 产物应校验同目录对象存在且推导对象键', async () => {
    const { service, savedPackages } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [DRAFT], heads: HEADS,
    })
    await service.register('v1', {
      platform: 'windows', arch: 'x64', fileName: 'a.exe',
      objectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe',
      sha256: 'a'.repeat(64),
      blockmapSha512: 'YmxvY2ttYXAtc2hhNTEy',
    }, USER_ID)
    expect(savedPackages[0]?.blockmapObjectKey).toBe('packages/ah_demo/stable/1.3.0/windows-x64/a.exe.blockmap')
    // 前端未声明大小时以 HeadObject 为准
    expect(savedPackages[0]?.blockmapFileSize).toBe(4096)
  })

  it('声明了 blockmap 但对象未上传应拒绝', async () => {
    const { service } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [DRAFT],
      heads: { 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe': { contentLength: 1 } },
    })
    await expect(
      service.register('v1', {
        platform: 'windows', arch: 'x64', fileName: 'a.exe',
        objectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe',
        sha256: 'a'.repeat(64),
        blockmapSha512: 'YmxvY2ttYXAtc2hhNTEy',
      }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.PACKAGE_OBJECT_NOT_EXISTS.code })
  })

  it('非 ios 平台缺对象键应拒绝', async () => {
    const { service } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT] })
    await expect(
      service.register('v1', { platform: 'windows', arch: 'x64', fileName: 'a.exe', sha256: 'a'.repeat(64) }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.PACKAGE_OBJECT_NOT_EXISTS.code })
  })
})

describe('PackageService（删除）', () => {
  const PKG: PackageRow = {
    versionId: 'v1', platform: 'windows', arch: 'x64', fileName: 'a.exe', fileSize: 100, sha256: 'x',
    ossObjectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe',
    blockmapObjectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe.blockmap',
  }

  it('包不属于该版本（或不存在）应抛 PACKAGE_NOT_EXISTS', async () => {
    const { service } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT], packages: [PKG] })
    await expect(service.remove('v1', 'ghost', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.PACKAGE_NOT_EXISTS.code,
    })
  })

  it('非草稿版本的包不允许删除', async () => {
    const { service } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'published' }], packages: [{ ...PKG, id: 'p1' }],
    })
    await expect(service.remove('v1', 'p1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code,
    })
  })

  it('删除包应连带清理安装包与 blockmap 的 OSS 对象', async () => {
    const { service, deletedObjectKeys } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [DRAFT], packages: [{ ...PKG, id: 'p1' }],
    })
    await expect(service.remove('v1', 'p1', USER_ID)).resolves.toBeUndefined()
    expect(deletedObjectKeys).toContain('packages/ah_demo/stable/1.3.0/windows-x64/a.exe')
    expect(deletedObjectKeys).toContain('packages/ah_demo/stable/1.3.0/windows-x64/a.exe.blockmap')
  })
})
