import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import type { Server } from 'node:http'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { dataSourceStub } from './support/data-source-stub'
import { AsyncTaskQueue } from '../src/common/async/async-task-queue'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import type { PageResult } from '../src/common/interfaces/page-result.interface'
import { AppChannelEntity } from '../src/modules/appcenter/entities/app-channel.entity'
import { AppPackageEntity } from '../src/modules/appcenter/entities/app-package.entity'
import { AppVersionEntity } from '../src/modules/appcenter/entities/app-version.entity'
import { AppEntity } from '../src/modules/appcenter/entities/app.entity'
import { STORAGE_SERVICE } from '../src/modules/appcenter/storage/storage.service'
import type { ObjectHead, StorageService, UploadCredentialVo } from '../src/modules/appcenter/storage/storage.service'
import { LoginLogEntity } from '../src/modules/system/entities/login-log.entity'
import { OperateLogEntity } from '../src/modules/system/entities/operate-log.entity'
import { RolePermissionEntity } from '../src/modules/system/entities/role-permission.entity'
import { RoleEntity } from '../src/modules/system/entities/role.entity'
import { UserRoleEntity } from '../src/modules/system/entities/user-role.entity'
import { UserEntity } from '../src/modules/system/entities/user.entity'

// 环境变量须在 TestingModule 构建前设置（Jest 按测试文件分进程运行，与其他套件互不影响）
process.env.SIGNATURE_ENABLED = 'false'
process.env.JWT_SECRET = 'e2e-jwt-secret'

/** admin123 的 BCrypt 散列（与种子迁移同源） */
const PASSWORD_HASH = '$2a$10$8yeFDSyUDUfl4SwuLGEah.XGaPS4uQLJb53EwXiCqXjUyxFKFAkLC'

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000002'
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000003'

// ===== 内存数据 =====

const users: Partial<UserEntity>[] = [
  { id: ADMIN_ID, username: 'admin', nickname: '系统管理员', password: PASSWORD_HASH, status: true },
  { id: PLAIN_USER_ID, username: 'nobody', nickname: '无权限用户', password: PASSWORD_HASH, status: true },
]
const roles: Partial<RoleEntity>[] = [
  { id: SUPER_ADMIN_ROLE_ID, code: 'super_admin', name: '超级管理员', status: true },
]
const userRoles: Partial<UserRoleEntity>[] = [{ userId: ADMIN_ID, roleId: SUPER_ADMIN_ROLE_ID }]
const operateLogs: Partial<OperateLogEntity>[] = []

const apps: Partial<AppEntity>[] = []
const channels: Partial<AppChannelEntity>[] = []
const versions: Partial<AppVersionEntity>[] = []
const packages: Partial<AppPackageEntity>[] = []
// 直传后已存在的 OSS 对象（登记 HeadObject 校验的数据面）
const uploadedHeads: Record<string, ObjectHead> = {}
const deletedObjectKeys: string[] = []

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

let idSeq = 0
/** 生成合法 v4 形态 uuid（桩内主键） */
function nextId(): string {
  idSeq += 1
  return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`
}

/** 内存仓储桩：save 自动补 id 并 upsert，softRemove 移出可见集合 */
function makeMemoryRepo<T extends { id?: string }>(rows: Partial<T>[]) {
  return {
    find: ({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(row => matches(row, where)) as T[]),
    findOne: (options: { where?: Record<string, unknown> }) =>
      Promise.resolve((rows.find(row => matches(row, options.where)) ?? null) as T | null),
    findAndCount: ({ where }: { where?: Record<string, unknown> }) => {
      const list = rows.filter(row => matches(row, where)) as T[]
      return Promise.resolve([list, list.length] as [T[], number])
    },
    count: ({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(row => matches(row, where)).length),
    save: (entity: Partial<T> & { id?: string }) => {
      entity.id ??= nextId()
      const index = rows.findIndex(row => row.id === entity.id)
      if (index >= 0)
        rows[index] = entity
      else
        rows.push(entity)
      return Promise.resolve(entity as T)
    },
    create: (data: Partial<T>) => ({ ...data }) as T,
    softRemove: (entity: Partial<T> & { id?: string }) => {
      const index = rows.findIndex(row => row.id === entity.id)
      if (index >= 0)
        rows.splice(index, 1)
      return Promise.resolve(entity as T)
    },
  }
}

const appRepo = makeMemoryRepo<AppEntity>(apps)
const channelRepo = makeMemoryRepo<AppChannelEntity>(channels)
const versionRepo = makeMemoryRepo<AppVersionEntity>(versions)
const packageRepo = makeMemoryRepo<AppPackageEntity>(packages)

// AppService.create 走 manager.transaction：事务桩按实体名分流到同一内存集合
const appRepoWithManager = {
  ...appRepo,
  manager: {
    transaction: <T>(run: (manager: unknown) => Promise<T>) =>
      run({
        getRepository: (entity: { name?: string }) => (entity.name === 'AppEntity' ? appRepo : channelRepo),
      }),
  },
}

const storageStub: StorageService = {
  isConfigured: () => true,
  issueUploadCredential: (input: { objectKey: string, blockmapObjectKey: string }) =>
    Promise.resolve({
      region: 'oss-cn-hangzhou',
      bucket: 'apphub-e2e',
      accessKeyId: 'sts-ak',
      accessKeySecret: 'sts-sk',
      securityToken: 'sts-token',
      expiration: '2026-10-16T13:00:00Z',
      ...input,
    } satisfies UploadCredentialVo),
  headObject: (objectKey: string) => Promise.resolve(uploadedHeads[objectKey] ?? null),
  deleteObject: (objectKey: string) => {
    deletedObjectKeys.push(objectKey)
    return Promise.resolve()
  },
  signGetUrl: (objectKey: string) => `https://apphub-e2e.oss-cn-hangzhou.aliyuncs.com/${objectKey}?Signature=e2e`,
}

describe('AppcenterModule (e2e)', () => {
  let app: INestApplication
  let server: Server
  let adminToken: string
  let plainToken: string
  let appId: string
  let appKey: string
  let versionId: string

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(dataSourceStub)
      .overrideProvider(getRepositoryToken(UserEntity))
      .useValue({
        findOne: ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(users.find(user => matches(user, where)) ?? null),
        find: () => Promise.resolve(users),
        findAndCount: () => Promise.resolve([users, users.length]),
        save: (entity: Partial<UserEntity>) => Promise.resolve(entity),
        create: (data: Partial<UserEntity>) => Object.assign({ status: true }, data),
        softRemove: () => Promise.resolve(),
      })
      .overrideProvider(getRepositoryToken(RoleEntity))
      .useValue({
        find: (criteria: { where?: { status?: boolean } }) =>
          Promise.resolve(roles.filter(role => role.status === criteria.where?.status)),
      })
      .overrideProvider(getRepositoryToken(UserRoleEntity))
      .useValue({
        find: (criteria: { where: { userId: string } }) =>
          Promise.resolve(userRoles.filter(relation => relation.userId === criteria.where.userId)),
      })
      .overrideProvider(getRepositoryToken(RolePermissionEntity))
      .useValue({ find: () => Promise.resolve([]) })
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue(appRepoWithManager)
      .overrideProvider(getRepositoryToken(AppChannelEntity))
      .useValue(channelRepo)
      .overrideProvider(getRepositoryToken(AppVersionEntity))
      .useValue(versionRepo)
      .overrideProvider(getRepositoryToken(AppPackageEntity))
      .useValue(packageRepo)
      .overrideProvider(STORAGE_SERVICE)
      .useValue(storageStub)
      .overrideProvider(getRepositoryToken(OperateLogEntity))
      .useValue({
        insert: (entity: Partial<OperateLogEntity>) => {
          operateLogs.push(entity)
          return Promise.resolve()
        },
      })
      .overrideProvider(getRepositoryToken(LoginLogEntity))
      .useValue({ insert: () => Promise.resolve() })
      .compile()

    app = moduleFixture.createNestApplication({ rawBody: true })
    // 复刻 main.ts 装配（e2e 不经 bootstrap，全局管道须手动补齐）
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.init()
    server = app.getHttpServer() as Server

    const login = async (username: string) => {
      const res = await request(server).post('/api/system/auth/login').send({ username, password: 'admin123' })
      return (res.body as ApiResponse<{ token: string }>).data!.token
    }
    adminToken = await login('admin')
    plainToken = await login('nobody')
  })

  afterAll(async () => {
    await app.close()
  })

  it('注册应用应响应完整凭证并预置 stable 通道（凭证仅此一次，主张 A1）', async () => {
    const res = await request(server)
      .post('/api/appcenter/app')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '示例桌面应用', appType: ['desktop'], clientType: 'public', framework: 'electron' })
      .expect(200)
    const credential = (res.body as ApiResponse<{ id: string, appKey: string, appSecret: string }>).data!
    expect(credential.appKey).toMatch(/^ah_[a-z0-9]{16}$/)
    expect(credential.appSecret).toMatch(/^[a-z0-9]{32}$/)
    appId = credential.id
    appKey = credential.appKey

    // 列表出参不含 Secret（敏感信息不得泄漏）
    const page = await request(server)
      .get('/api/appcenter/app')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const body = page.body as ApiResponse<PageResult<Record<string, unknown>>>
    expect(body.data?.list[0]?.appSecret).toBeUndefined()

    // 创建即预置 stable 通道
    const channelList = await request(server)
      .get(`/api/appcenter/app/${appId}/channel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const channelsOfApp = (channelList.body as ApiResponse<{ code: string }[]>).data!
    expect(channelsOfApp.map(channel => channel.code)).toContain('stable')
  })

  it('通道闭环：创建 beta、code 查重拒绝、stable 不可删', async () => {
    await request(server)
      .post(`/api/appcenter/app/${appId}/channel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'beta', name: '公测版', sort: 1 })
      .expect(200)

    // code 重复拒绝（300200002）
    await request(server)
      .post(`/api/appcenter/app/${appId}/channel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'beta', name: '重复通道' })
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300200002)
      })

    // stable 不可删（300200003）
    const channelList = await request(server)
      .get(`/api/appcenter/app/${appId}/channel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const stableId = ((channelList.body as ApiResponse<{ id: string, code: string }[]>).data!)
      .find(channel => channel.code === 'stable')!.id
    await request(server)
      .delete(`/api/appcenter/app/${appId}/channel/${stableId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300200003)
      })
  })

  it('super_admin 全集应自动扩容含 appcenter 权限（注册表多模块聚合零维护）', async () => {
    const res = await request(server)
      .get('/api/system/auth/get-permission-info')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const permissions = (res.body as ApiResponse<{ permissions: string[] }>).data!.permissions
    expect(permissions).toContain('appcenter:app:query')
    expect(permissions).toContain('appcenter:version:publish')
  })

  it('无 appcenter 权限用户访问应用接口应返回 403', async () => {
    await request(server)
      .get('/api/appcenter/app')
      .set('Authorization', `Bearer ${plainToken}`)
      .expect(403)
  })

  it('版本闭环：semver 校验 → 直传凭证（对象键后端生成）→ 登记（HeadObject 为准）→ 发布 → 状态机约束', async () => {
    const channelList = await request(server)
      .get(`/api/appcenter/app/${appId}/channel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const stableId = ((channelList.body as ApiResponse<{ id: string, code: string }[]>).data!)
      .find(channel => channel.code === 'stable')!.id

    // 非 semver 拒绝（300300002）
    await request(server)
      .post(`/api/appcenter/app/${appId}/version`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channelId: stableId, version: '1.3', title: '非法版本号' })
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300300002)
      })

    const created = await request(server)
      .post(`/api/appcenter/app/${appId}/version`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channelId: stableId, version: '1.3.0', title: '1.3.0 性能优化版', notes: '修复若干问题' })
      .expect(200)
    versionId = (created.body as ApiResponse<string>).data!

    // 直传凭证：对象键由后端按规范生成（前端不自由拼键）
    const tokenRes = await request(server)
      .post(`/api/appcenter/version/${versionId}/package/upload-token`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ platform: 'windows', arch: 'x64', fileName: 'app-setup-1.3.0.exe' })
      .expect(200)
    const uploadToken = (tokenRes.body as ApiResponse<{ objectKey: string, securityToken: string }>).data!
    const expectedKey = `packages/${appKey}/stable/1.3.0/windows-x64/app-setup-1.3.0.exe`
    expect(uploadToken.objectKey).toBe(expectedKey)

    // 未直传先登记：HeadObject 404 → 300400004
    await request(server)
      .post(`/api/appcenter/version/${versionId}/package`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        platform: 'windows', arch: 'x64', fileName: 'app-setup-1.3.0.exe',
        objectKey: expectedKey, sha256: 'a'.repeat(64), sha512: 'c2hhNTEyLWJhc2U2NC1wbGFjZWhvbGRlcg==',
      })
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300400004)
      })

    // 模拟直传完成（对象存在），登记成功（file_size 以 HeadObject 为准）
    uploadedHeads[expectedKey] = { contentLength: 1048576 }
    await request(server)
      .post(`/api/appcenter/version/${versionId}/package`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        platform: 'windows', arch: 'x64', fileName: 'app-setup-1.3.0.exe',
        objectKey: expectedKey, sha256: 'a'.repeat(64), sha512: 'c2hhNTEyLWJhc2U2NC1wbGFjZWhvbGRlcg==',
      })
      .expect(200)

    // 包列表可见（fileSize 数值化出口）
    const packageList = await request(server)
      .get(`/api/appcenter/version/${versionId}/package`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const pkgs = (packageList.body as ApiResponse<{ fileSize: number }[]>).data!
    expect(pkgs).toHaveLength(1)
    expect(pkgs[0]?.fileSize).toBe(1048576)

    // 发布成功（electron 包已带 sha512）
    await request(server)
      .post(`/api/appcenter/version/${versionId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    // published 仅允许改说明与强制标记（300300004）
    await request(server)
      .put(`/api/appcenter/version/${versionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: versionId, version: '1.3.1' })
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300300004)
      })

    // published 状态可以补改说明（发版后补救）
    await request(server)
      .put(`/api/appcenter/version/${versionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: versionId, notes: '补发的更新说明' })
      .expect(200)
  })

  it('有已发布版本的应用不允许删除（300100004）；下线后（终态）可删', async () => {
    await request(server)
      .delete(`/api/appcenter/app/${appId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300100004)
      })

    // 下线（终态）后应用删除走通（版本历史保留可追溯：软删）
    await request(server)
      .post(`/api/appcenter/version/${versionId}/offline`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    await request(server)
      .delete(`/api/appcenter/app/${appId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
  })

  it('写操作应各落一条「应用管理」操作日志（拦截器对 appcenter 生效）', async () => {
    await app.get(AsyncTaskQueue).drain()
    const appcenterLogs = operateLogs.filter(log => log.module === '应用管理')
    expect(appcenterLogs.length).toBeGreaterThanOrEqual(4)
  })
})
