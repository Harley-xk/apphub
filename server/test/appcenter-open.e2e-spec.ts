import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import { load as yamlLoad } from 'js-yaml'
import type { Server } from 'node:http'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { dataSourceStub } from './support/data-source-stub'
import { E2E_SIGN_SECRET } from './support/signature.helper'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import { AppChannelEntity } from '../src/modules/appcenter/entities/app-channel.entity'
import { AppPackageEntity } from '../src/modules/appcenter/entities/app-package.entity'
import { AppVersionEntity } from '../src/modules/appcenter/entities/app-version.entity'
import { AppEntity } from '../src/modules/appcenter/entities/app.entity'
import { STORAGE_SERVICE } from '../src/modules/appcenter/storage/storage.service'
import type { StorageService } from '../src/modules/appcenter/storage/storage.service'

// 开启签名验证跑开放链路：验证 @SkipSignature 豁免（D23）真实生效——无 HMAC 头的请求照常放行。
// 环境变量须在 TestingModule 构建前设置（Jest 按测试文件分进程运行，与其他套件互不影响）
process.env.SIGNATURE_ENABLED = 'true'
process.env.SIGNATURE_SECRET = E2E_SIGN_SECRET
process.env.JWT_SECRET = 'e2e-jwt-secret'

// ===== 固定测试数据（直接装配内存集合，不经管理端接口） =====

const APP_E_KEY = 'ah_electron000000001'
const APP_T_KEY = 'ah_tauri000000000001'
const APP_W_KEY = 'ah_webapp0000000001'
const APP_D_KEY = 'ah_disabled00000001'
const APP_RATE_KEY = 'ah_public0000000001'
const APP_M_KEY = 'ah_macx640000000001'

const apps: Partial<AppEntity>[] = [
  { id: '00000000-0000-4000-8000-0000000000a1', appKey: APP_E_KEY, appSecret: 's1', name: '示例 Electron 应用', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000a2', appKey: APP_T_KEY, appSecret: 's2', name: '示例 Tauri 应用', appType: ['desktop'], clientType: 'confidential', framework: 'tauri', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000a3', appKey: APP_W_KEY, appSecret: 's3', name: '纯 Web 应用', appType: ['web'], clientType: 'confidential', framework: 'custom', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000a4', appKey: APP_D_KEY, appSecret: 's4', name: '已停用应用', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'disabled' },
  { id: '00000000-0000-4000-8000-0000000000a5', appKey: APP_RATE_KEY, appSecret: 's5', name: '限流验证应用', appType: ['desktop'], clientType: 'public', framework: 'custom', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000a6', appKey: APP_M_KEY, appSecret: 's6', name: 'mac x64 专用应用', appType: ['desktop'], clientType: 'confidential', framework: 'electron', status: 'enabled' },
]
const channels: Partial<AppChannelEntity>[] = [
  { id: '00000000-0000-4000-8000-0000000000c1', appId: '00000000-0000-4000-8000-0000000000a1', code: 'stable', name: '稳定', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000c2', appId: '00000000-0000-4000-8000-0000000000a2', code: 'stable', name: '稳定', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000c3', appId: '00000000-0000-4000-8000-0000000000a3', code: 'stable', name: '稳定', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000c4', appId: '00000000-0000-4000-8000-0000000000a4', code: 'stable', name: '稳定', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000c5', appId: '00000000-0000-4000-8000-0000000000a5', code: 'stable', name: '稳定', status: 'enabled' },
  { id: '00000000-0000-4000-8000-0000000000c6', appId: '00000000-0000-4000-8000-0000000000a6', code: 'stable', name: '稳定', status: 'enabled' },
]
const versions: Partial<AppVersionEntity>[] = [
  { id: '00000000-0000-4000-8000-0000000000v1', appId: '00000000-0000-4000-8000-0000000000a1', channelId: '00000000-0000-4000-8000-0000000000c1', version: '1.0.0', title: '首个版本', notes: '初始发布', forceUpdate: false, status: 'published', publishedAt: new Date('2026-09-01T08:00:00Z') },
  { id: '00000000-0000-4000-8000-0000000000v2', appId: '00000000-0000-4000-8000-0000000000a1', channelId: '00000000-0000-4000-8000-0000000000c1', version: '1.1.0', title: '例行更新', notes: '修复若干问题\n优化性能', forceUpdate: true, status: 'published', publishedAt: new Date('2026-10-01T08:00:00Z') },
  { id: '00000000-0000-4000-8000-0000000000v3', appId: '00000000-0000-4000-8000-0000000000a1', channelId: '00000000-0000-4000-8000-0000000000c1', version: '2.0.0', title: '草稿', notes: null, forceUpdate: false, status: 'draft', publishedAt: null },
  { id: '00000000-0000-4000-8000-0000000000v4', appId: '00000000-0000-4000-8000-0000000000a2', channelId: '00000000-0000-4000-8000-0000000000c2', version: '2.0.0', title: '内核升级', notes: '内核升级', forceUpdate: true, status: 'published', publishedAt: new Date('2026-10-02T08:00:00Z') },
  { id: '00000000-0000-4000-8000-0000000000v5', appId: '00000000-0000-4000-8000-0000000000a3', channelId: '00000000-0000-4000-8000-0000000000c3', version: '1.0.0', title: '网页版', notes: null, forceUpdate: false, status: 'published', publishedAt: new Date('2026-09-15T08:00:00Z') },
  { id: '00000000-0000-4000-8000-0000000000v6', appId: '00000000-0000-4000-8000-0000000000a4', channelId: '00000000-0000-4000-8000-0000000000c4', version: '1.0.0', title: '停用前版本', notes: null, forceUpdate: false, status: 'published', publishedAt: new Date('2026-08-01T08:00:00Z') },
  { id: '00000000-0000-4000-8000-0000000000v7', appId: '00000000-0000-4000-8000-0000000000a6', channelId: '00000000-0000-4000-8000-0000000000c6', version: '1.0.0', title: 'x64 专用', notes: null, forceUpdate: false, status: 'published', publishedAt: new Date('2026-09-20T08:00:00Z') },
]
const packages: Partial<AppPackageEntity>[] = [
  { id: '00000000-0000-4000-8000-0000000000p1', versionId: '00000000-0000-4000-8000-0000000000v1', platform: 'windows', arch: 'x64', fileName: 'app-1.0.0.exe', fileSize: 1000, sha256: 'a'.repeat(64), sha512: 'c2hhYjY0LWUx', minisignSignature: null, blockmapObjectKey: null, blockmapSha512: null, blockmapFileSize: null, ossObjectKey: `packages/${APP_E_KEY}/stable/1.0.0/windows-x64/app-1.0.0.exe` },
  { id: '00000000-0000-4000-8000-0000000000p2', versionId: '00000000-0000-4000-8000-0000000000v2', platform: 'windows', arch: 'x64', fileName: 'app-1.1.0.exe', fileSize: 2000, sha256: 'b'.repeat(64), sha512: 'c2hhYjY0LWUy', minisignSignature: null, blockmapObjectKey: null, blockmapSha512: null, blockmapFileSize: null, ossObjectKey: `packages/${APP_E_KEY}/stable/1.1.0/windows-x64/app-1.1.0.exe` },
  { id: '00000000-0000-4000-8000-0000000000p3', versionId: '00000000-0000-4000-8000-0000000000v2', platform: 'macos', arch: 'universal', fileName: 'app-1.1.0.dmg', fileSize: 3000, sha256: 'c'.repeat(64), sha512: 'c2hhYjY0LWUy', minisignSignature: null, blockmapObjectKey: `packages/${APP_E_KEY}/stable/1.1.0/macos-universal/app-1.1.0.dmg.blockmap`, blockmapSha512: 'YmxrLWUybQ==', blockmapFileSize: 100, ossObjectKey: `packages/${APP_E_KEY}/stable/1.1.0/macos-universal/app-1.1.0.dmg` },
  { id: '00000000-0000-4000-8000-0000000000p4', versionId: '00000000-0000-4000-8000-0000000000v4', platform: 'windows', arch: 'x64', fileName: 'tauri-app_2.0.0_x64-setup.exe', fileSize: 4000, sha256: 'd'.repeat(64), sha512: null, minisignSignature: 'dW5pbnNpZy1zaWc=', blockmapObjectKey: null, blockmapSha512: null, blockmapFileSize: null, ossObjectKey: `packages/${APP_T_KEY}/stable/2.0.0/windows-x64/tauri-app_2.0.0_x64-setup.exe` },
  { id: '00000000-0000-4000-8000-0000000000p5', versionId: '00000000-0000-4000-8000-0000000000v6', platform: 'windows', arch: 'x64', fileName: 'app-1.0.0.exe', fileSize: 1000, sha256: 'e'.repeat(64), sha512: 'c2hhYjY0LWQx', minisignSignature: null, blockmapObjectKey: null, blockmapSha512: null, blockmapFileSize: null, ossObjectKey: `packages/${APP_D_KEY}/stable/1.0.0/windows-x64/app-1.0.0.exe` },
  { id: '00000000-0000-4000-8000-0000000000p6', versionId: '00000000-0000-4000-8000-0000000000v7', platform: 'macos', arch: 'x64', fileName: 'app-1.0.0-mac-x64.dmg', fileSize: 3500, sha256: 'f'.repeat(64), sha512: 'c2hhYjY0LW02', minisignSignature: null, blockmapObjectKey: null, blockmapSha512: null, blockmapFileSize: null, ossObjectKey: `packages/${APP_M_KEY}/stable/1.0.0/macos-x64/app-1.0.0-mac-x64.dmg` },
]

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

/** 内存仓储桩：开放链路只读（find / findOne） */
function makeMemoryRepo<T>(rows: Partial<T>[]) {
  return {
    find: ({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(row => matches(row, where)) as T[]),
    findOne: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve((rows.find(row => matches(row, options.where)) ?? null) as T | null),
  }
}

const storageStub: StorageService = {
  isConfigured: () => true,
  issueUploadCredential: () => Promise.reject(new Error('开放链路不签发上传凭证')),
  headObject: () => Promise.reject(new Error('开放链路不读取对象头')),
  deleteObject: () => Promise.reject(new Error('开放链路不删除对象')),
  signGetUrl: (objectKey: string) => `https://apphub-e2e.oss-cn-hangzhou.aliyuncs.com/${objectKey}?Expires=1&Signature=e2e`,
}

interface CheckBody {
  hasUpdate: boolean
  latestVersion?: string
  title?: string
  notes?: string | null
  forceUpdate?: boolean
  package?: { fileName: string, fileSize: number, sha256: string, downloadUrl: string } | null
}

describe('AppcenterModule 开放 API (e2e)', () => {
  let app: INestApplication
  let server: Server

  /** 自研协议请求快捷方式（AppKey 经头携带，无任何签名头） */
  const check = (appKey: string, body: Record<string, unknown>) =>
    request(server).post('/api/open/app/version/check').set('x-app-key', appKey).send(body)

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(dataSourceStub)
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue(makeMemoryRepo<AppEntity>(apps))
      .overrideProvider(getRepositoryToken(AppChannelEntity))
      .useValue(makeMemoryRepo<AppChannelEntity>(channels))
      .overrideProvider(getRepositoryToken(AppVersionEntity))
      .useValue(makeMemoryRepo<AppVersionEntity>(versions))
      .overrideProvider(getRepositoryToken(AppPackageEntity))
      .useValue(makeMemoryRepo<AppPackageEntity>(packages))
      .overrideProvider(STORAGE_SERVICE)
      .useValue(storageStub)
      .compile()

    app = moduleFixture.createNestApplication()
    // 复刻 main.ts 装配（e2e 不经 bootstrap，全局管道须手动补齐）
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.init()
    server = app.getHttpServer() as Server
  })

  afterAll(async () => {
    await app.close()
  })

  it('签名开启时无 HMAC 头可访问开放端点（D23 豁免）', async () => {
    const res = await check(APP_E_KEY, { platform: 'windows', arch: 'x64', currentVersion: '1.0.0' }).expect(200)
    const data = (res.body as ApiResponse<CheckBody>).data!
    expect(data.hasUpdate).toBe(true)
  })

  it('无效 AppKey 拒绝（300100002）', async () => {
    const res = await check('ah_missing000000001', { platform: 'windows' }).expect(400)
    expect((res.body as ApiResponse<unknown>).code).toBe(300100002)
  })

  it('有更新：返回最新版本与包信息（draft 版本不暴露）', async () => {
    const res = await check(APP_E_KEY, { platform: 'windows', arch: 'x64', currentVersion: '1.0.0' }).expect(200)
    const data = (res.body as ApiResponse<CheckBody>).data!
    expect(data.hasUpdate).toBe(true)
    expect(data.latestVersion).toBe('1.1.0')
    expect(data.title).toBe('例行更新')
    expect(data.notes).toBe('修复若干问题\n优化性能')
    expect(data.forceUpdate).toBe(true)
    expect(data.package?.fileName).toBe('app-1.1.0.exe')
    expect(data.package?.fileSize).toBe(2000)
    expect(data.package?.sha256).toBe('b'.repeat(64))
    expect(data.package?.downloadUrl).toContain(`packages/${APP_E_KEY}/stable/1.1.0/windows-x64/app-1.1.0.exe`)
    expect(data.package?.downloadUrl).toContain('Signature=')
  })

  it('无更新：currentVersion 大于等于最新版本', async () => {
    const equal = await check(APP_E_KEY, { platform: 'windows', arch: 'x64', currentVersion: '1.1.0' }).expect(200)
    expect((equal.body as ApiResponse<CheckBody>).data!.hasUpdate).toBe(false)
    const newer = await check(APP_E_KEY, { platform: 'windows', arch: 'x64', currentVersion: '2.0.0' }).expect(200)
    expect((newer.body as ApiResponse<CheckBody>).data!.hasUpdate).toBe(false)
  })

  it('非 semver 的 currentVersion 按必有更新处理', async () => {
    const res = await check(APP_E_KEY, { platform: 'windows', arch: 'x64', currentVersion: 'dev-build' }).expect(200)
    expect((res.body as ApiResponse<CheckBody>).data!.hasUpdate).toBe(true)
  })

  it('web 平台：版本提示语义（package 为 null）', async () => {
    const res = await check(APP_W_KEY, { platform: 'web' }).expect(200)
    const data = (res.body as ApiResponse<CheckBody>).data!
    expect(data.hasUpdate).toBe(true)
    expect(data.latestVersion).toBe('1.0.0')
    expect(data.package).toBeNull()
  })

  it('停用应用返回无更新（不暴露状态细节）', async () => {
    const res = await check(APP_D_KEY, { platform: 'windows', arch: 'x64' }).expect(200)
    const data = (res.body as ApiResponse<CheckBody>).data!
    expect(data.hasUpdate).toBe(false)
    expect(data.latestVersion).toBeUndefined()
  })

  it('electron latest.yml：sha512 / files / [force] 首行（blockmap 未上传时省略）', async () => {
    const res = await request(server)
      .get(`/api/update/${APP_E_KEY}/stable/electron/latest.yml`)
      .expect(200)
      .expect('Content-Type', /yaml/)
    const manifest = yamlLoad(res.text) as Record<string, unknown>
    expect(manifest.version).toBe('1.1.0')
    expect(manifest.path).toBe('app-1.1.0.exe')
    expect(manifest.sha512).toBe('c2hhYjY0LWUy')
    expect(manifest.releaseDate).toBe('2026-10-01T08:00:00.000Z')
    expect(manifest.releaseNotes).toMatch(/^\[force\]\n/)
    const files = manifest.files as { url: string, sha512: string, size: number }[]
    expect(files).toHaveLength(1)
    expect(files[0].url).toContain(`packages/${APP_E_KEY}/stable/1.1.0/windows-x64/app-1.1.0.exe`)
    expect(files[0].url).toContain('Signature=')
    expect(files[0].sha512).toBe('c2hhYjY0LWUy')
    expect(files[0].size).toBe(2000)
  })

  it('electron latest-mac.yml：blockmap 已上传时 files 含差分条目', async () => {
    const res = await request(server)
      .get(`/api/update/${APP_E_KEY}/stable/electron/latest-mac.yml`)
      .expect(200)
    const manifest = yamlLoad(res.text) as Record<string, unknown>
    const files = manifest.files as { url: string, sha512: string, size: number }[]
    expect(files).toHaveLength(2)
    expect(files[0].url).toContain('app-1.1.0.dmg')
    expect(files[1].url).toContain('app-1.1.0.dmg.blockmap')
    expect(files[1].sha512).toBe('YmxrLWUybQ==')
    expect(files[1].size).toBe(100)
  })

  it('electron latest-linux.yml：无该平台包返回 404', async () => {
    await request(server).get(`/api/update/${APP_E_KEY}/stable/electron/latest-linux.yml`).expect(404)
  })

  it('electron arch 固定映射：mac 端点只取 universal 槽位（x64 包不命中 404）', async () => {
    // 契约守护（设计 §3.4）：latest-mac.yml 固定映射 (macos, universal)，不得回退其他 arch
    await request(server).get(`/api/update/${APP_M_KEY}/stable/electron/latest-mac.yml`).expect(404)
  })

  it('tauri manifest：version / signature / 签名下载 URL / [force] 首行', async () => {
    const res = await request(server)
      .get(`/api/update/${APP_T_KEY}/stable/tauri/windows-x86_64/1.9.0`)
      .expect(200)
      .expect('Content-Type', /json/)
    const manifest = res.body as {
      version: string
      pub_date: string
      notes: string
      platforms: Record<string, { signature: string, url: string }>
    }
    expect(manifest.version).toBe('2.0.0')
    expect(manifest.pub_date).toBe('2026-10-02T08:00:00.000Z')
    expect(manifest.notes).toMatch(/^\[force\]\n/)
    expect(manifest.platforms['windows-x86_64']?.signature).toBe('dW5pbnNpZy1zaWc=')
    expect(manifest.platforms['windows-x86_64']?.url).toContain('Signature=')
  })

  it('tauri 无更新语义：已最新 / 未识别 target / 停用应用均返回 204', async () => {
    await request(server).get(`/api/update/${APP_T_KEY}/stable/tauri/windows-x86_64/2.0.0`).expect(204)
    await request(server).get(`/api/update/${APP_T_KEY}/stable/tauri/unknown-target/1.9.0`).expect(204)
    await request(server).get(`/api/update/${APP_D_KEY}/stable/tauri/windows-x86_64/1.0.0`).expect(204)
  })

  it('限流：公开客户端阈值减半（60 → 30，超出 429）', async () => {
    // 独占 appKey（前序用例未触达），第 31 次请求被滑动窗口拒绝
    for (let index = 0; index < 30; index++)
      await check(APP_RATE_KEY, { platform: 'windows' }).expect(200)
    await check(APP_RATE_KEY, { platform: 'windows' }).expect(429)
  })
})
