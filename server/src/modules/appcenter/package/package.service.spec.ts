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
  const removedPackages: PackageRow[] = []
  const signedUrls: { objectKey: string, expiresSeconds?: number, fileName?: string }[] = []

  const packageRepositoryDouble = {
    find: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(packages.filter(pkg => matches(pkg, findOptions.where))),
    findOne: (findOptions: { where?: Record<string, unknown> }) =>
      Promise.resolve(packages.find(pkg => matches(pkg, findOptions.where)) ?? null),
    save: (entity: PackageRow) => {
      savedPackages.push(entity)
      return Promise.resolve({ id: 'pkg-new', ...entity })
    },
    create: (data: Partial<AppPackageEntity>) => ({ ...data }),
    softRemove: (entity: PackageRow) => {
      removedPackages.push(entity)
      return Promise.resolve(entity)
    },
  }
  // 替换在事务内软删旧包 + 插入新包：测试用同一内存仓库模拟 manager
  const packageRepository = {
    ...packageRepositoryDouble,
    manager: {
      transaction: (callback: (manager: { getRepository: () => typeof packageRepositoryDouble }) => Promise<string>) =>
        callback({ getRepository: () => packageRepositoryDouble }),
    },
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
    signGetUrl: (objectKey: string, expiresSeconds?: number, fileName?: string) => {
      signedUrls.push({ objectKey, expiresSeconds, fileName })
      return `https://oss.example.com/${objectKey}?Signature=signed`
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
  return { service, issuedCredentials, deletedObjectKeys, savedPackages, removedPackages, signedUrls }
}

describe('PackageService（直传凭证）', () => {
  it('对象键应按后端规范生成并随凭证下发（前端不自由拼键）', async () => {
    const { service, issuedCredentials } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT] })
    await service.issueUploadToken('v1', { platform: 'windows', arch: 'x64', fileName: 'app-setup-1.3.0.exe' }, USER_ID)
    expect(issuedCredentials[0]?.objectKey).toBe('packages/ah_demo/stable/1.3.0/windows-x64/app-setup-1.3.0.exe')
    expect(issuedCredentials[0]?.blockmapObjectKey).toBe('packages/ah_demo/stable/1.3.0/windows-x64/app-setup-1.3.0.exe.blockmap')
  })

  it('已发布版本允许申请凭证（发布后补包 / 换包）', async () => {
    const { service, issuedCredentials } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'published' }],
    })
    await service.issueUploadToken('v1', { platform: 'macos', arch: 'universal', fileName: 'a.dmg' }, USER_ID)
    expect(issuedCredentials[0]?.objectKey).toBe('packages/ah_demo/stable/1.3.0/macos-universal/a.dmg')
  })

  it('已下线版本不允许申请凭证（终态冻结）', async () => {
    const { service } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'offline' }],
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

  it('替换模式应要求槽位已占用（空槽位替换报 PACKAGE_REPLACE_TARGET_NOT_EXISTS）', async () => {
    const { service } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT] })
    await expect(
      service.issueUploadToken('v1', { platform: 'windows', arch: 'x64', fileName: 'a.exe', replaceExisting: true }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.PACKAGE_REPLACE_TARGET_NOT_EXISTS.code })
  })

  it('替换模式的对象键应插入随机批次段（避免同名覆盖旧对象）', async () => {
    const { service, issuedCredentials } = makeService({
      apps: [APP],
      channels: [CHANNEL],
      versions: [{ ...DRAFT, status: 'published' }],
      packages: [{ versionId: 'v1', platform: 'windows', arch: 'x64', fileName: 'a.exe', fileSize: 1, sha256: 'x', ossObjectKey: 'k' }],
    })
    await service.issueUploadToken('v1', { platform: 'windows', arch: 'x64', fileName: 'a.exe', replaceExisting: true }, USER_ID)
    expect(issuedCredentials[0]?.objectKey).toMatch(
      /^packages\/ah_demo\/stable\/1\.3\.0\/windows-x64\/[0-9a-f]{8}\/a\.exe$/,
    )
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

  it('已发布版本登记须校验框架产物（electron 缺 sha512 拒绝，避免适配端点失联）', async () => {
    const { service } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'published' }], heads: HEADS,
    })
    await expect(
      service.register('v1', {
        platform: 'macos', arch: 'universal', fileName: 'a.dmg',
        objectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe',
        sha256: 'a'.repeat(64),
      }, USER_ID),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING.code })
  })

  it('替换登记应在事务内软删旧包、插入新包并清理旧 OSS 对象', async () => {
    const OLD: PackageRow = {
      id: 'p1', versionId: 'v1', platform: 'windows', arch: 'x64', fileName: 'a.exe', fileSize: 1,
      sha256: 'x', ossObjectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe',
      blockmapObjectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/a.exe.blockmap',
    }
    const newKey = 'packages/ah_demo/stable/1.3.0/windows-x64/abcd1234/a.exe'
    const { service, savedPackages, removedPackages, deletedObjectKeys } = makeService({
      apps: [APP],
      channels: [CHANNEL],
      versions: [{ ...DRAFT, status: 'published' }],
      packages: [OLD],
      heads: { [newKey]: { contentLength: 2048 } },
    })
    const newId = await service.register('v1', {
      platform: 'windows', arch: 'x64', fileName: 'a.exe',
      objectKey: newKey, sha256: 'a'.repeat(64), sha512: 'c2hhNTEy', replaceExisting: true,
    }, USER_ID)
    expect(newId).toBe('pkg-new')
    expect(removedPackages).toEqual([OLD])
    expect(savedPackages[0]?.ossObjectKey).toBe(newKey)
    expect(savedPackages[0]?.fileSize).toBe(2048)
    // 旧对象与 blockmap 均在替换成功后清理
    expect(deletedObjectKeys).toContain(OLD.ossObjectKey)
    expect(deletedObjectKeys).toContain(OLD.blockmapObjectKey)
  })
})

describe('PackageService（下载）', () => {
  const PKG: PackageRow = {
    id: 'p1', versionId: 'v1', platform: 'windows', arch: 'x64', fileName: '应用安装包-1.3.0.exe', fileSize: 100,
    sha256: 'x', sha512: 'y', ossObjectKey: 'packages/ah_demo/stable/1.3.0/windows-x64/应用安装包-1.3.0.exe',
  }

  it('已发布版本也应签发签名 URL（携带原始文件名，2h 时效）', async () => {
    const { service, signedUrls } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'published' }], packages: [PKG],
    })
    await expect(service.getDownloadUrl('v1', 'p1', USER_ID)).resolves.toEqual({
      url: `https://oss.example.com/${PKG.ossObjectKey}?Signature=signed`,
      fileName: PKG.fileName,
      expiresIn: 7200,
    })
    expect(signedUrls[0]).toEqual({
      objectKey: PKG.ossObjectKey,
      expiresSeconds: 7200,
      fileName: PKG.fileName,
    })
  })

  it('包不属于该版本（或不存在）应抛 PACKAGE_NOT_EXISTS', async () => {
    const { service } = makeService({ apps: [APP], channels: [CHANNEL], versions: [DRAFT], packages: [PKG] })
    await expect(service.getDownloadUrl('v1', 'ghost', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.PACKAGE_NOT_EXISTS.code,
    })
  })

  it('ios 元信息包无对象键应抛 PACKAGE_OBJECT_MISSING（不签发空对象 URL）', async () => {
    const { service, signedUrls } = makeService({
      apps: [APP],
      channels: [CHANNEL],
      versions: [DRAFT],
      packages: [{ ...PKG, platform: 'ios', arch: null, ossObjectKey: '' }],
    })
    await expect(service.getDownloadUrl('v1', 'p1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.PACKAGE_OBJECT_MISSING.code,
    })
    expect(signedUrls).toHaveLength(0)
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

  it('已下线版本的包不允许删除（终态冻结）', async () => {
    const { service } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'offline' }], packages: [{ ...PKG, id: 'p1' }],
    })
    await expect(service.remove('v1', 'p1', USER_ID)).rejects.toMatchObject({
      code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN.code,
    })
  })

  it('已发布版本的包允许删除（撤回该平台分发）', async () => {
    const { service, deletedObjectKeys } = makeService({
      apps: [APP], channels: [CHANNEL], versions: [{ ...DRAFT, status: 'published' }], packages: [{ ...PKG, id: 'p1' }],
    })
    await expect(service.remove('v1', 'p1', USER_ID)).resolves.toBeUndefined()
    expect(deletedObjectKeys).toContain(PKG.ossObjectKey)
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
