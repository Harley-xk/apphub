import { describe, expect, it } from '@jest/globals'
import * as bcrypt from 'bcryptjs'

import type { UserEntity } from '../entities/user.entity'
import { SystemErrorCode } from '../error-codes'
import { ADMIN_USER_ID } from '../system.constants'
import { UserService } from './user.service'

/** 造 service：configTableValue 为参数表取值（null 表示未命中），envValue 为 env 兜底（undefined 表示未配置） */
function makeService(options: {
  configTableValue?: string | null
  envValue?: string
  users?: (Partial<UserEntity> & { id: string })[]
  roles?: { id: string, code: string }[]
  userRoles?: { userId: string, roleId: string }[]
  posts?: { id: string }[]
  userPosts?: { userId: string, postId: string }[]
  /** 账户级应用授权存量（差集写入用例） */
  appScopes?: { userId: string, appId: string }[]
  /** 应用查找端口可见的应用 id（缺省视为全部可见；用于软删过滤与不存在拒绝） */
  existingAppIds?: string[]
} = {}) {
  // 逐行浅拷贝：service 会就地修改实体字段，防跨用例污染共享常量
  const users = (options.users ?? []).map(row => ({ ...row }))
  const roles = options.roles ?? []
  const userRoles = options.userRoles ?? []
  const posts = options.posts ?? []
  const userPosts = options.userPosts ?? []
  const saved: Partial<UserEntity>[] = []
  const userPostInserted: { userId: string, postId: string }[] = []
  const userPostDeleted: Record<string, unknown>[] = []
  const userRoleDeleted: Record<string, unknown>[] = []
  const appScopes = (options.appScopes ?? []).map(row => ({ ...row }))
  const userAppScopeDeleted: Record<string, unknown>[] = []
  const userAppScopeInserted: { userId: string, appId: string }[] = []

  const userRepository = {
    findOne: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        users.find(user =>
          Object.entries(where).every(([key, value]) => (user as Record<string, unknown>)[key] === value),
        ) ?? null,
      ),
    // 最后超管保护校验用：id 为 In 操作符（取 .value 数组），status 为布尔等值
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        users.filter((user) => {
          const ids = (where.id as { value?: string[] } | undefined)?.value
          if (ids !== undefined && !ids.includes(user.id))
            return false
          return Object.entries(where).every(([key, value]) =>
            key === 'id' ? true : (user as Record<string, unknown>)[key] === value,
          )
        }),
      ),
    findAndCount: () => Promise.resolve([users, users.length]),
    save: (entity: Partial<UserEntity>) => {
      saved.push(entity)
      // 模拟数据库生成主键（创建路径的关联插入依赖返回行携带 id）
      return Promise.resolve(Object.assign(entity, { id: entity.id ?? 'generated-id' }))
    },
    create: (data: Partial<UserEntity>) => Object.assign({ status: true, deptId: null }, data),
    softRemove: () => Promise.resolve(),
  }
  const userRoleRepository = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        userRoles.filter(relation =>
          Object.entries(where).every(([key, value]) => (relation as Record<string, unknown>)[key] === value),
        ),
      ),
    delete: (criteria: Record<string, unknown>) => {
      userRoleDeleted.push(criteria)
      return Promise.resolve({})
    },
    insert: () => Promise.resolve({}),
  }
  const roleRepository = {
    findOne: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        roles.find(role =>
          Object.entries(where).every(([key, value]) => (role as Record<string, unknown>)[key] === value),
        ) ?? null,
      ),
  }
  const userPostRepository = {
    // where.userId 为 In 操作符（批量补全），桩直接返回全集由 service 分组
    find: () => Promise.resolve(userPosts),
    delete: (criteria: Record<string, unknown>) => {
      userPostDeleted.push(criteria)
      return Promise.resolve({})
    },
    insert: (rows: { userId: string, postId: string }[]) => {
      userPostInserted.push(...rows)
      return Promise.resolve({})
    },
  }
  const deptRepository = {
    findOne: () => Promise.resolve(null),
    // 补全批量查询：直接返回可用部门全集（映射语义等价）
    find: () => Promise.resolve([{ id: 'd1', name: '研发部' }]),
  }
  const postRepository = {
    // In(...) 的 FindOperator 经 .value 取原始数组（存在性数量比对）
    find: ({ where }: { where: { id?: unknown } }) => {
      const wanted = (where.id as { value?: string[] } | undefined)?.value ?? []
      return Promise.resolve(posts.filter(post => wanted.includes(post.id)))
    },
  }
  const userAppScopeRepository = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        appScopes.filter(row =>
          Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value),
        ),
      ),
    delete: (criteria: Record<string, unknown>) => {
      userAppScopeDeleted.push(criteria)
      return Promise.resolve({})
    },
    insert: (rows: { userId: string, appId: string }[]) => {
      userAppScopeInserted.push(...rows)
      return Promise.resolve({})
    },
  }
  const visibleAppIds = options.existingAppIds
  const appLookup = {
    assertAppsExist: (appIds: string[]) => {
      const missing = appIds.filter(appId => visibleAppIds !== undefined && !visibleAppIds.includes(appId))
      if (missing.length > 0)
        return Promise.reject(Object.assign(new Error('应用不存在'), { code: 300100001 }))
      return Promise.resolve()
    },
    listAppsByIds: (appIds: string[]) =>
      Promise.resolve(
        appIds
          .filter(appId => visibleAppIds === undefined || visibleAppIds.includes(appId))
          .map(appId => ({ id: appId, appKey: `ah_${appId}`, name: `应用 ${appId}` })),
      ),
  }
  const service = new UserService(
    userRepository as never,
    userRoleRepository as never,
    userPostRepository as never,
    userAppScopeRepository as never,
    roleRepository as never,
    deptRepository as never,
    postRepository as never,
    { get: () => options.envValue } as never,
    { getValueByKey: () => Promise.resolve(options.configTableValue ?? null) } as never,
    { get: () => appLookup } as never,
  )
  return {
    service,
    saved,
    userPostInserted,
    userPostDeleted,
    userRoleDeleted,
    userAppScopeInserted,
    userAppScopeDeleted,
  }
}

describe('UserService 初始口令三级兜底链', () => {
  it('参数表命中时应使用参数表口令（改参数即刻生效契约）', async () => {
    const { service, saved } = makeService({ configTableValue: 'table-pass' })
    await service.create({ username: 'alice', nickname: '爱丽丝' })
    expect(bcrypt.compareSync('table-pass', String(saved[0].password))).toBe(true)
  })

  it('参数表未命中应回退 env 配置', async () => {
    const { service, saved } = makeService({ configTableValue: null, envValue: 'env-pass' })
    await service.create({ username: 'alice', nickname: '爱丽丝' })
    expect(bcrypt.compareSync('env-pass', String(saved[0].password))).toBe(true)
  })

  it('参数表与 env 皆未配置应硬兜底 admin123', async () => {
    const { service, saved } = makeService({ configTableValue: null, envValue: undefined })
    await service.create({ username: 'alice', nickname: '爱丽丝' })
    expect(bcrypt.compareSync('admin123', String(saved[0].password))).toBe(true)
  })

  it('显式传入口令优先于三级链', async () => {
    const { service, saved } = makeService({ configTableValue: 'table-pass' })
    await service.create({ username: 'alice', nickname: '爱丽丝', password: 'custom-pass' })
    expect(bcrypt.compareSync('custom-pass', String(saved[0].password))).toBe(true)
  })
})

describe('UserService 部门与岗位', () => {
  it('创建时 postIds 含不存在的岗位应抛 POST_NOT_EXISTS', async () => {
    const { service } = makeService({ posts: [{ id: 'p1' }] })
    await expect(
      service.create({ username: 'alice', nickname: '爱丽丝', postIds: ['p1', 'ghost'] }),
    ).rejects.toMatchObject({ code: SystemErrorCode.POST_NOT_EXISTS.code })
  })

  it('创建时岗位齐全应插入全部岗位关联', async () => {
    const { service, userPostInserted } = makeService({ posts: [{ id: 'p1' }, { id: 'p2' }] })
    await service.create({ username: 'alice', nickname: '爱丽丝', postIds: ['p1', 'p2'] })
    expect(userPostInserted).toEqual([
      { userId: 'generated-id', postId: 'p1' },
      { userId: 'generated-id', postId: 'p2' },
    ])
  })

  it('更新岗位应为差集增量绑定（删旧缺增新缺）', async () => {
    const { service, userPostInserted, userPostDeleted } = makeService({
      users: [{ id: 'u1', username: 'alice', nickname: '爱丽丝', status: true }],
      posts: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      userPosts: [
        { userId: 'u1', postId: 'p1' },
        { userId: 'u1', postId: 'p2' },
      ],
    })
    await service.update({ id: 'u1', nickname: '爱丽丝', status: true, postIds: ['p2', 'p3'] })
    // 现有 [p1, p2] → 目标 [p2, p3]：删 p1、增 p3
    expect(userPostDeleted).toHaveLength(1)
    expect((userPostDeleted[0].postId as { value: string[] }).value).toEqual(['p1'])
    expect(userPostInserted).toEqual([{ userId: 'u1', postId: 'p3' }])
  })

  it('删除用户应物理清理角色与岗位两类关联', async () => {
    const { service, userPostDeleted, userRoleDeleted } = makeService({
      users: [{ id: 'u1', username: 'alice', nickname: '爱丽丝', status: true }],
    })
    await service.remove('u1')
    expect(userRoleDeleted).toEqual([{ userId: 'u1' }])
    expect(userPostDeleted).toEqual([{ userId: 'u1' }])
  })

  it('分页列表应批量补全部门名与岗位 id 集合', async () => {
    const { service } = makeService({
      users: [
        { id: 'u1', username: 'alice', nickname: '爱丽丝', status: true, deptId: 'd1' },
        { id: 'u2', username: 'bob', nickname: '鲍勃', status: true, deptId: null },
      ],
      userPosts: [
        { userId: 'u1', postId: 'p1' },
        { userId: 'u1', postId: 'p2' },
      ],
    })
    const page = await service.getPage({ pageNo: 1, pageSize: 10 })
    expect(page.total).toBe(2)
    expect(page.list[0]).toMatchObject({ username: 'alice', deptId: 'd1', deptName: '研发部', postIds: ['p1', 'p2'] })
    expect(page.list[1]).toMatchObject({ username: 'bob', deptId: null, deptName: null, postIds: [] })
  })
})

describe('UserService 最后超管保护', () => {
  // 通用场景：r-super 为 super_admin 角色，u-admin 为其唯一启用持有者
  const lastSuperAdmin = {
    roles: [{ id: 'r-super', code: 'super_admin' }],
    userRoles: [{ userId: 'u-admin', roleId: 'r-super' }],
    users: [{ id: 'u-admin', username: 'admin', nickname: '系统管理员', status: true }],
  }

  it('禁用最后一名启用超管应抛 USER_LAST_SUPER_ADMIN_FORBIDDEN', async () => {
    const { service } = makeService(lastSuperAdmin)
    await expect(
      service.update({ id: 'u-admin', nickname: '系统管理员', status: false }),
    ).rejects.toMatchObject({ code: SystemErrorCode.USER_LAST_SUPER_ADMIN_FORBIDDEN.code })
  })

  it('存在另一名启用超管时禁用应放行', async () => {
    const { service, saved } = makeService({
      ...lastSuperAdmin,
      users: [
        { id: 'u-admin', username: 'admin', nickname: '系统管理员', status: true },
        { id: 'u-admin2', username: 'admin2', nickname: '备用管理员', status: true },
      ],
      userRoles: [
        { userId: 'u-admin', roleId: 'r-super' },
        { userId: 'u-admin2', roleId: 'r-super' },
      ],
    })
    await service.update({ id: 'u-admin', nickname: '系统管理员', status: false })
    expect(saved[0]).toMatchObject({ id: 'u-admin', status: false })
  })

  it('删除最后一名启用超管应拒绝', async () => {
    const { service } = makeService(lastSuperAdmin)
    await expect(service.remove('u-admin')).rejects.toMatchObject({
      code: SystemErrorCode.USER_LAST_SUPER_ADMIN_FORBIDDEN.code,
    })
  })

  it('解绑最后一名启用超管的 super_admin 角色应拒绝（且不执行删除）', async () => {
    const { service, userRoleDeleted } = makeService(lastSuperAdmin)
    await expect(service.assignRoles({ id: 'u-admin', roleIds: [] })).rejects.toMatchObject({
      code: SystemErrorCode.USER_LAST_SUPER_ADMIN_FORBIDDEN.code,
    })
    expect(userRoleDeleted).toHaveLength(0)
  })

  it('重置密码对内置管理员应放行（恢复初始口令三级兜底）', async () => {
    const { service, saved } = makeService({
      ...lastSuperAdmin,
      users: [{ id: ADMIN_USER_ID, username: 'admin', nickname: '系统管理员', status: true }],
      userRoles: [{ userId: ADMIN_USER_ID, roleId: 'r-super' }],
    })
    await service.resetPassword(ADMIN_USER_ID)
    expect(bcrypt.compareSync('admin123', String(saved[0].password))).toBe(true)
  })

  it('编辑超管基本信息（保持启用）应放行', async () => {
    const { service, saved } = makeService(lastSuperAdmin)
    await service.update({ id: 'u-admin', nickname: '新昵称', status: true })
    expect(saved[0]).toMatchObject({ id: 'u-admin', nickname: '新昵称', status: true })
  })
})

describe('UserService 应用授权（数据范围）', () => {
  const USERS = [{ id: 'u1', username: 'bob', nickname: '鲍勃', status: true }]

  it('差集写入：新增目标应用、删除多余授权（物理删除）', async () => {
    const { service, userAppScopeInserted, userAppScopeDeleted } = makeService({
      users: USERS,
      appScopes: [
        { userId: 'u1', appId: 'a1' },
        { userId: 'u1', appId: 'a2' },
      ],
      existingAppIds: ['a1', 'a2', 'a3'],
    })
    await service.assignAppScope('u1', ['a1', 'a3'])
    // a2 移除（In 操作符的 value 为待删集合）
    const removed = userAppScopeDeleted[0]?.appId as { value?: string[] } | undefined
    expect(removed?.value).toEqual(['a2'])
    expect(userAppScopeInserted).toEqual([{ userId: 'u1', appId: 'a3' }])
  })

  it('重复 appId 应去重（唯一索引语义，不产生重复插入）', async () => {
    const { service, userAppScopeInserted } = makeService({ users: USERS, existingAppIds: ['a1'] })
    await service.assignAppScope('u1', ['a1', 'a1', 'a1'])
    expect(userAppScopeInserted).toEqual([{ userId: 'u1', appId: 'a1' }])
  })

  it('目标与现有完全一致时应零写入（无变化不产生 SQL）', async () => {
    const { service, userAppScopeInserted, userAppScopeDeleted } = makeService({
      users: USERS,
      appScopes: [{ userId: 'u1', appId: 'a1' }],
      existingAppIds: ['a1'],
    })
    await service.assignAppScope('u1', ['a1'])
    expect(userAppScopeInserted).toHaveLength(0)
    expect(userAppScopeDeleted).toHaveLength(0)
  })

  it('授权不存在的应用应拒绝（APP_NOT_EXISTS，不落任何写入）', async () => {
    const { service, userAppScopeInserted, userAppScopeDeleted } = makeService({
      users: USERS,
      existingAppIds: ['a1'],
    })
    await expect(service.assignAppScope('u1', ['a1', 'ghost'])).rejects.toMatchObject({ code: 300100001 })
    expect(userAppScopeInserted).toHaveLength(0)
    expect(userAppScopeDeleted).toHaveLength(0)
  })

  it('授权回显应过滤已软删应用（授权行残留不产生权限）', async () => {
    const { service } = makeService({
      users: USERS,
      appScopes: [
        { userId: 'u1', appId: 'a1' },
        { userId: 'u1', appId: 'a2' },
      ],
      existingAppIds: ['a1'],
    })
    const scope = await service.getAppScope('u1')
    expect(scope.appIds).toEqual(['a1'])
    expect(scope.apps).toEqual([{ id: 'a1', appKey: 'ah_a1', name: '应用 a1' }])
  })

  it('用户授权行不得跨用户混入（按 userId 过滤）', async () => {
    const { service } = makeService({
      users: USERS,
      appScopes: [
        { userId: 'u1', appId: 'a1' },
        { userId: 'u2', appId: 'a2' },
      ],
      existingAppIds: ['a1', 'a2'],
    })
    const scope = await service.getAppScope('u1')
    expect(scope.appIds).toEqual(['a1'])
  })
})
