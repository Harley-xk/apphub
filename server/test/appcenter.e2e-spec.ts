import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm'
import fs from 'node:fs'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
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
import { UserAppScopeEntity } from '../src/modules/system/entities/user-app-scope.entity'
import { UserRoleEntity } from '../src/modules/system/entities/user-role.entity'
import { UserEntity } from '../src/modules/system/entities/user.entity'

// 环境变量须在 TestingModule 构建前设置（Jest 按测试文件分进程运行，与其他套件互不影响）
process.env.SIGNATURE_ENABLED = 'false'
process.env.JWT_SECRET = 'e2e-jwt-secret'

// 技能分发接口 fixture：构建产物在测试环境不生成，用临时目录模拟 server/dist/skill/apphub-release
const SKILL_VERSION = '1.4.0'
const skillDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-skill-e2e-'))
process.env.SKILL_DIST_DIR = skillDistDir
fs.mkdirSync(path.join(skillDistDir, SKILL_VERSION, 'scripts'), { recursive: true })
fs.writeFileSync(path.join(skillDistDir, 'INSTALL.md'), '# 安装说明')
fs.writeFileSync(path.join(skillDistDir, 'install.mjs'), 'console.log(1)')
fs.writeFileSync(path.join(skillDistDir, SKILL_VERSION, 'SKILL.md'), '# 技能指令')
fs.writeFileSync(path.join(skillDistDir, SKILL_VERSION, 'VERSION'), SKILL_VERSION)
fs.writeFileSync(path.join(skillDistDir, SKILL_VERSION, 'scripts', 'apphub.mjs'), 'console.log(2)')
fs.writeFileSync(path.join(skillDistDir, 'manifest.json'), JSON.stringify({
  name: 'apphub-release',
  version: SKILL_VERSION,
  generatedAt: '2026-10-24T08:00:00.000Z',
  files: [
    { path: 'SKILL.md', url: `/api/skill/apphub-release/files/${SKILL_VERSION}/SKILL.md`, sha256: 'a'.repeat(64), size: 7 },
    { path: 'VERSION', url: `/api/skill/apphub-release/files/${SKILL_VERSION}/VERSION`, sha256: 'b'.repeat(64), size: 5 },
    { path: 'scripts/apphub.mjs', url: `/api/skill/apphub-release/files/${SKILL_VERSION}/scripts/apphub.mjs`, sha256: 'c'.repeat(64), size: 14 },
  ],
  installer: { path: 'install.mjs', url: '/api/skill/apphub-release/install.mjs', sha256: 'd'.repeat(64), size: 14 },
  installDoc: { path: 'INSTALL.md', url: '/api/skill/apphub-release', sha256: 'e'.repeat(64), size: 9 },
}))

/** admin123 的 BCrypt 散列（与种子迁移同源） */
const PASSWORD_HASH = '$2a$10$8yeFDSyUDUfl4SwuLGEah.XGaPS4uQLJb53EwXiCqXjUyxFKFAkLC'

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000002'
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000003'
// 应用管理员（数据范围 = 按应用）：账户级授权在用例中绑定到台账应用
const APP_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000004'
const APP_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000005'

// ===== 内存数据 =====

const users: Partial<UserEntity>[] = [
  { id: ADMIN_ID, username: 'admin', nickname: '系统管理员', password: PASSWORD_HASH, status: true },
  { id: PLAIN_USER_ID, username: 'nobody', nickname: '无权限用户', password: PASSWORD_HASH, status: true },
  { id: APP_ADMIN_USER_ID, username: 'appadmin', nickname: '应用管理员', password: PASSWORD_HASH, status: true },
]
const roles: Partial<RoleEntity>[] = [
  { id: SUPER_ADMIN_ROLE_ID, code: 'super_admin', name: '超级管理员', status: true, dataScope: 'all' },
  { id: APP_ADMIN_ROLE_ID, code: 'app_admin', name: '应用管理员', status: true, dataScope: 'app' },
]
const userRoles: Partial<UserRoleEntity>[] = [
  { userId: ADMIN_ID, roleId: SUPER_ADMIN_ROLE_ID },
  { userId: APP_ADMIN_USER_ID, roleId: APP_ADMIN_ROLE_ID },
]
/** app_admin 角色的权限行（数据范围判定只看「授予该域权限的角色」——A4） */
const rolePermissions: Partial<RolePermissionEntity>[] = [
  { roleId: APP_ADMIN_ROLE_ID, permission: 'appcenter:app:query' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'appcenter:app:update' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'appcenter:channel:query' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'appcenter:version:query' },
  { roleId: APP_ADMIN_ROLE_ID, permission: 'appcenter:version:create' },
]
/** 账户级应用授权行（物理删除的纯关联值对象） */
const userAppScopes: Partial<UserAppScopeEntity>[] = []
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

// 替换包走 manager.transaction：事务桩直连同一内存集合（软删旧包 + 插入新包）
const packageRepoWithManager = {
  ...packageRepo,
  manager: {
    transaction: <T>(run: (manager: unknown) => Promise<T>) =>
      run({ getRepository: () => packageRepo }),
  },
}

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
  let appAdminToken: string
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
        find: (criteria: { where?: { status?: boolean, id?: { value?: string[] } } }) => {
          const where = criteria.where ?? {}
          const roleIds = where.id?.value
          return Promise.resolve(
            roles.filter(role =>
              (where.status === undefined || role.status === where.status)
              && (roleIds === undefined || roleIds.includes(role.id!)),
            ),
          )
        },
      })
      .overrideProvider(getRepositoryToken(UserRoleEntity))
      .useValue({
        find: (criteria: { where: { userId: string } }) =>
          Promise.resolve(userRoles.filter(relation => relation.userId === criteria.where.userId)),
      })
      .overrideProvider(getRepositoryToken(RolePermissionEntity))
      .useValue({
        // AppScopeService 的域授予查询：roleId 为 In、permission 为 Like('domain:%')
        find: (criteria: { where?: { roleId?: { value?: string[] }, permission?: { value?: string } } }) => {
          const where = criteria.where ?? {}
          const roleIds = where.roleId?.value
          const prefix = (where.permission?.value ?? '').replace('%', '')
          return Promise.resolve(
            rolePermissions.filter(relation =>
              (roleIds === undefined || roleIds.includes(relation.roleId!))
              && (prefix === '' || (relation.permission ?? '').startsWith(prefix)),
            ),
          )
        },
      })
      .overrideProvider(getRepositoryToken(UserAppScopeEntity))
      .useValue({
        find: (criteria: { where: { userId: string } }) =>
          Promise.resolve(userAppScopes.filter(row => row.userId === criteria.where.userId)),
        delete: (criteria: { userId: string, appId?: { value?: string[] } }) => {
          const appIds = criteria.appId?.value
          for (let index = userAppScopes.length - 1; index >= 0; index--) {
            const row = userAppScopes[index]
            if (row.userId === criteria.userId && (appIds === undefined || appIds.includes(row.appId!)))
              userAppScopes.splice(index, 1)
          }
          return Promise.resolve({})
        },
        insert: (rows: Partial<UserAppScopeEntity>[]) => {
          userAppScopes.push(...rows)
          return Promise.resolve({})
        },
      })
      .overrideProvider(getRepositoryToken(AppEntity))
      .useValue(appRepoWithManager)
      .overrideProvider(getRepositoryToken(AppChannelEntity))
      .useValue(channelRepo)
      .overrideProvider(getRepositoryToken(AppVersionEntity))
      .useValue(versionRepo)
      .overrideProvider(getRepositoryToken(AppPackageEntity))
      .useValue(packageRepoWithManager)
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
    appAdminToken = await login('appadmin')
  })

  afterAll(async () => {
    await app.close()
    fs.rmSync(skillDistDir, { recursive: true, force: true })
  })

  it('注册应用应响应完整凭证并预置 stable 通道（主张 A1）', async () => {
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

    // 完整凭证经独立端点按需查看（列表 **** 掩码的数据源，与注册响应一致）
    const secretRes = await request(server)
      .get(`/api/appcenter/app/${appId}/secret`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect((secretRes.body as ApiResponse<{ appSecret: string }>).data?.appSecret).toBe(credential.appSecret)

    // 创建即预置 stable 通道
    const channelList = await request(server)
      .get(`/api/appcenter/app/${appId}/channel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const channelsOfApp = (channelList.body as ApiResponse<{ code: string }[]>).data!
    expect(channelsOfApp.map(channel => channel.code)).toContain('stable')
  })

  it('应用授权接口：差集写入并回显，未登记应用拒绝（003001001）', async () => {
    await request(server)
      .put(`/api/system/user/${APP_ADMIN_USER_ID}/app-scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appIds: [appId] })
      .expect(200)

    const res = await request(server)
      .get(`/api/system/user/${APP_ADMIN_USER_ID}/app-scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const scope = (res.body as ApiResponse<{ appIds: string[], apps: { id: string }[] }>).data!
    expect(scope.appIds).toEqual([appId])
    expect(scope.apps[0]).toMatchObject({ id: appId })

    // 无效 appId 拒绝（应用不存在，APP_NOT_EXISTS）
    await request(server)
      .put(`/api/system/user/${APP_ADMIN_USER_ID}/app-scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appIds: ['00000000-0000-4000-8000-0000000000ff'] })
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300100001)
      })
  })

  it('app_admin 应用列表只含授权应用，直连未授权应用 / 通道 / 版本应 403 专用码', async () => {
    // 另建一个应用（仅 admin 可见），app_admin 未被授权
    const created = await request(server)
      .post('/api/appcenter/app')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '未授权应用', appType: ['desktop'], clientType: 'public' })
      .expect(200)
    const otherAppId = (created.body as ApiResponse<{ id: string }>).data!.id

    // 列表收窄：只剩授权应用
    const page = await request(server)
      .get('/api/appcenter/app')
      .set('Authorization', `Bearer ${appAdminToken}`)
      .expect(200)
    const body = page.body as ApiResponse<PageResult<{ id: string }>>
    expect(body.data?.list.map(app => app.id)).toEqual([appId])
    expect(body.data?.total).toBe(1)

    // 应用下拉同源收窄（授权弹窗 / 订阅页筛选数据源）
    const options = await request(server)
      .get('/api/appcenter/app/options')
      .set('Authorization', `Bearer ${appAdminToken}`)
      .expect(200)
    expect((options.body as ApiResponse<{ id: string }[]>).data?.map(app => app.id)).toEqual([appId])

    // 单资源越权：详情 / 通道 / 版本一律 403 + 专用码
    const forbidden = (res: { body: unknown }) => {
      expect((res.body as ApiResponse<unknown>).code).toBe(300100005)
    }
    await request(server)
      .get(`/api/appcenter/app/${otherAppId}`)
      .set('Authorization', `Bearer ${appAdminToken}`)
      .expect(403)
      .expect(forbidden)
    await request(server)
      .get(`/api/appcenter/app/${otherAppId}/channel`)
      .set('Authorization', `Bearer ${appAdminToken}`)
      .expect(403)
      .expect(forbidden)
    // 查看凭证同样受数据范围收口（不得借查看端点越权取 Secret）
    await request(server)
      .get(`/api/appcenter/app/${otherAppId}/secret`)
      .set('Authorization', `Bearer ${appAdminToken}`)
      .expect(403)
      .expect(forbidden)
    await request(server)
      .post(`/api/appcenter/app/${otherAppId}/version`)
      .set('Authorization', `Bearer ${appAdminToken}`)
      .send({ channelId: '00000000-0000-4000-8000-0000000000aa', version: '9.9.9', title: '越权建版本' })
      .expect(403)
      .expect(forbidden)

    // 授权应用可正常读取
    await request(server)
      .get(`/api/appcenter/app/${appId}`)
      .set('Authorization', `Bearer ${appAdminToken}`)
      .expect(200)
  })

  it('停用角色后权限与数据范围即时失效（逐请求现查库，A12）', async () => {
    const appAdminRole = roles.find(role => role.id === APP_ADMIN_ROLE_ID)!
    appAdminRole.status = false
    try {
      // 同一 token 无需重登：Guard 与范围判定均逐请求查库
      await request(server)
        .get('/api/appcenter/app')
        .set('Authorization', `Bearer ${appAdminToken}`)
        .expect(403)
    }
    finally {
      appAdminRole.status = true
    }
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
    const pkgs = (packageList.body as ApiResponse<{ id: string, fileSize: number }[]>).data!
    expect(pkgs).toHaveLength(1)
    expect(pkgs[0]?.fileSize).toBe(1048576)

    // 发布成功（electron 包已带 sha512）
    await request(server)
      .post(`/api/appcenter/version/${versionId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    // 管理端下载：已发布版本的包也可签发签名 URL（下载不限版本状态）
    const downloadRes = await request(server)
      .get(`/api/appcenter/version/${versionId}/package/${pkgs[0].id}/download-url`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const download = (downloadRes.body as ApiResponse<{ url: string, fileName: string, expiresIn: number }>).data!
    expect(download.url).toContain(expectedKey)
    expect(download.fileName).toBe('app-setup-1.3.0.exe')
    expect(download.expiresIn).toBe(7200)

    // 包记录不存在（300400005）
    await request(server)
      .get(`/api/appcenter/version/${versionId}/package/ghost/download-url`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300400005)
      })

    // ===== 发布后平台包维护（设计 §3.2.1）=====

    // 补包：已发布版本新增 macOS 平台（不影响既有 Windows 候选）
    const macFileName = 'app-1.3.0.dmg'
    const macKey = `packages/${appKey}/stable/1.3.0/macos-universal/${macFileName}`
    const macTokenRes = await request(server)
      .post(`/api/appcenter/version/${versionId}/package/upload-token`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ platform: 'macos', arch: 'universal', fileName: macFileName })
      .expect(200)
    expect((macTokenRes.body as ApiResponse<{ objectKey: string }>).data!.objectKey).toBe(macKey)
    uploadedHeads[macKey] = { contentLength: 2048 }
    await request(server)
      .post(`/api/appcenter/version/${versionId}/package`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        platform: 'macos', arch: 'universal', fileName: macFileName,
        objectKey: macKey, sha256: 'b'.repeat(64), sha512: 'bWFjLXNoYTUxMg==',
      })
      .expect(200)

    // 换包：replaceExisting 生成带随机批次段的新对象键，旧记录软删、旧对象清理
    const replaceTokenRes = await request(server)
      .post(`/api/appcenter/version/${versionId}/package/upload-token`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ platform: 'windows', arch: 'x64', fileName: 'app-setup-1.3.0.exe', replaceExisting: true })
      .expect(200)
    const replacedKey = (replaceTokenRes.body as ApiResponse<{ objectKey: string }>).data!.objectKey
    expect(replacedKey).toMatch(
      new RegExp(`^packages/${appKey}/stable/1\\.3\\.0/windows-x64/[0-9a-f]{8}/app-setup-1\\.3\\.0\\.exe$`),
    )
    uploadedHeads[replacedKey] = { contentLength: 2097152 }
    await request(server)
      .post(`/api/appcenter/version/${versionId}/package`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        platform: 'windows', arch: 'x64', fileName: 'app-setup-1.3.0.exe',
        objectKey: replacedKey, sha256: 'c'.repeat(64), sha512: 'cmVwbGFjZWQtc2hhNTEy', replaceExisting: true,
      })
      .expect(200)
    expect(deletedObjectKeys).toContain(expectedKey)

    // 包列表：Windows 指向新对象键（fileSize 以新 HeadObject 为准），macOS 已补齐
    const afterMaintain = await request(server)
      .get(`/api/appcenter/version/${versionId}/package`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const maintained = (afterMaintain.body as ApiResponse<{ id: string, platform: string, fileSize: number, ossObjectKey: string }[]>).data!
    expect(maintained).toHaveLength(2)
    const windowsPkg = maintained.find(pkg => pkg.platform === 'windows')!
    expect(windowsPkg.ossObjectKey).toBe(replacedKey)
    expect(windowsPkg.fileSize).toBe(2097152)

    // 删包：published 下删除 macOS 包（撤回该平台分发）
    const macPkg = maintained.find(pkg => pkg.platform === 'macos')!
    await request(server)
      .delete(`/api/appcenter/version/${versionId}/package/${macPkg.id}`)
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

    // 下线后包层冻结：签发直传凭证返回 300300004（重新分发须新建版本）
    await request(server)
      .post(`/api/appcenter/version/${versionId}/package/upload-token`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ platform: 'linux', arch: 'x64', fileName: 'app-1.3.0.AppImage' })
      .expect(400)
      .expect((res) => {
        expect((res.body as ApiResponse<unknown>).code).toBe(300300004)
      })
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

  it('技能分发接口公开可达（免 JWT / 免签名），版本与路径按清单校验', async () => {
    // 冷启动说明：直接返回 Markdown（StreamableFile 绕开统一响应包装）
    const doc = await request(server).get('/api/skill/apphub-release').expect(200)
    expect(doc.headers['content-type']).toContain('text/markdown')
    expect(doc.text).toBe('# 安装说明')

    const manifest = await request(server).get('/api/skill/apphub-release/manifest').expect(200)
    expect((manifest.body as { version: string }).version).toBe(SKILL_VERSION)

    const installer = await request(server).get('/api/skill/apphub-release/install.mjs').expect(200)
    expect(installer.headers['content-type']).toContain('javascript')
    expect(installer.text).toBe('console.log(1)')

    // 版本化文件：SKILL.md / VERSION / scripts/*
    await request(server).get(`/api/skill/apphub-release/files/${SKILL_VERSION}/SKILL.md`).expect(200).expect('# 技能指令')
    await request(server).get(`/api/skill/apphub-release/files/${SKILL_VERSION}/VERSION`).expect(200).expect(SKILL_VERSION)
    await request(server).get(`/api/skill/apphub-release/files/${SKILL_VERSION}/scripts/apphub.mjs`).expect(200).expect('console.log(2)')

    // 版本不匹配 / 清单外文件均 404
    await request(server).get('/api/skill/apphub-release/files/9.9.9/SKILL.md').expect(404)
    await request(server).get(`/api/skill/apphub-release/files/${SKILL_VERSION}/scripts/evil.mjs`).expect(404)
  })
})
