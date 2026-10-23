import { describe, expect, it, jest } from '@jest/globals'

import { AppScopeService } from './app-scope.service'
import type { RoleEntity } from '../entities/role.entity'

type RoleRow = Partial<RoleEntity> & { id: string }
interface RelationRow { roleId: string, permission: string }
interface BindingRow { userId: string, appId: string }

/** 行匹配：where.roleId 为 In 操作符、where.permission 为 Like 操作符（与 AppScopeService 查询形态一致） */
function matchesRelation(row: RelationRow, where: Record<string, unknown>): boolean {
  const roleIdOp = where.roleId as { type?: string, value?: string[] } | undefined
  if (roleIdOp?.type === 'in' && !(roleIdOp.value ?? []).includes(row.roleId))
    return false
  const permissionOp = where.permission as { type?: string, value?: string } | undefined
  if (permissionOp?.type === 'like') {
    const prefix = (permissionOp.value ?? '').replace('%', '')
    if (!row.permission.startsWith(prefix))
      return false
  }
  return true
}

function makeService(options: {
  roles?: RoleRow[]
  relations?: RelationRow[]
  bindings?: BindingRow[]
} = {}) {
  const roles = options.roles ?? []
  const relations = options.relations ?? []
  const bindings = options.bindings ?? []
  const bindingQueries: Record<string, unknown>[] = []

  const userAppScopeRepository = {
    find: ({ where }: { where: Record<string, unknown> }) => {
      bindingQueries.push(where)
      return Promise.resolve(bindings.filter(binding => binding.userId === where.userId))
    },
  }
  const rolePermissionRepository = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(relations.filter(relation => matchesRelation(relation, where))),
  }
  // 启用角色查询已由 PermissionService 收敛（停用角色不参与），桩只返回「启用角色」
  const permissionService = {
    getUserEnabledRoles: jest.fn(() => Promise.resolve(roles as RoleEntity[])),
  }
  const service = new AppScopeService(
    userAppScopeRepository as never,
    rolePermissionRepository as never,
    permissionService as never,
  )
  return { service, permissionService, bindingQueries }
}

const ROLE_ALL: RoleRow = { id: 'r-all', code: 'ops', status: true, dataScope: 'all' }
const ROLE_APP: RoleRow = { id: 'r-app', code: 'app_admin', status: true, dataScope: 'app' }
const SUPER_ADMIN: RoleRow = { id: 'r-super', code: 'super_admin', status: true, dataScope: 'all' }

const APPCENTER_GRANT: RelationRow = { roleId: 'r-app', permission: 'appcenter:app:query' }
const APPCENTER_GRANT_ALL_ROLE: RelationRow = { roleId: 'r-all', permission: 'appcenter:app:query' }
const SYSTEM_ONLY_GRANT: RelationRow = { roleId: 'r-all', permission: 'system:user:query' }

describe('AppScopeService.resolve', () => {
  it('持有启用 super_admin 应为全量（A6：平台超管不受数据范围限制）', async () => {
    const { service } = makeService({ roles: [SUPER_ADMIN] })
    await expect(service.resolve('u1', 'appcenter')).resolves.toEqual({ mode: 'all' })
  })

  it('授予该域权限且 data_scope=all 的角色应解除应用限制', async () => {
    const { service } = makeService({ roles: [ROLE_ALL], relations: [APPCENTER_GRANT_ALL_ROLE] })
    await expect(service.resolve('u1', 'appcenter')).resolves.toEqual({ mode: 'all' })
  })

  it('data_scope=app 的角色应按账户级授权集合收窄（SCOPED）', async () => {
    const { service } = makeService({
      roles: [ROLE_APP],
      relations: [APPCENTER_GRANT],
      bindings: [
        { userId: 'u1', appId: 'a1' },
        { userId: 'u1', appId: 'a2' },
        { userId: 'u2', appId: 'a3' },
      ],
    })
    await expect(service.resolve('u1', 'appcenter')).resolves.toEqual({
      mode: 'scoped',
      appIds: ['a1', 'a2'],
    })
  })

  it('与业务无关的 all 角色不得解除应用限制（A4：只看授予该域权限的角色）', async () => {
    const { service } = makeService({
      roles: [ROLE_ALL, ROLE_APP],
      relations: [SYSTEM_ONLY_GRANT, APPCENTER_GRANT],
      bindings: [{ userId: 'u1', appId: 'a1' }],
    })
    await expect(service.resolve('u1', 'appcenter')).resolves.toEqual({
      mode: 'scoped',
      appIds: ['a1'],
    })
  })

  it('授权集合为空应返回 SCOPED 空集（A5 fail-closed，由调用方落 403 / 空页）', async () => {
    const { service } = makeService({ roles: [ROLE_APP], relations: [APPCENTER_GRANT] })
    await expect(service.resolve('u1', 'appcenter')).resolves.toEqual({ mode: 'scoped', appIds: [] })
  })

  it('无启用角色 / 无授予该域权限的角色应 403 专用码（NOT_GRANTED 防御分支）', async () => {
    const noRole = makeService({ roles: [] })
    await expect(noRole.service.resolve('u1', 'appcenter')).rejects.toMatchObject({
      code: 300100005,
      status: 403,
    })
    const systemOnly = makeService({ roles: [ROLE_ALL], relations: [SYSTEM_ONLY_GRANT] })
    await expect(systemOnly.service.resolve('u1', 'appcenter')).rejects.toMatchObject({
      code: 300100005,
    })
  })

  it('域判定相互独立：appcenter 的 all 角色不解除 subscription 限制', async () => {
    const { service } = makeService({
      roles: [ROLE_ALL, ROLE_APP],
      relations: [
        { roleId: 'r-all', permission: 'appcenter:app:query' },
        { roleId: 'r-app', permission: 'subscription:plan:query' },
      ],
      bindings: [{ userId: 'u1', appId: 'a1' }],
    })
    await expect(service.resolve('u1', 'appcenter')).resolves.toEqual({ mode: 'all' })
    await expect(service.resolve('u1', 'subscription')).resolves.toEqual({
      mode: 'scoped',
      appIds: ['a1'],
    })
  })
})

describe('AppScopeService 收口助手', () => {
  it('ALL 模式：列表不加条件，单资源校验不查授权表', async () => {
    const { service, bindingQueries } = makeService({ roles: [SUPER_ADMIN] })
    await expect(service.getListAppIds('u1', 'appcenter')).resolves.toBeNull()
    await expect(service.assertAppAllowed('u1', 'any-app', 'appcenter')).resolves.toBeUndefined()
    expect(bindingQueries).toHaveLength(0)
  })

  it('SCOPED 模式：范围内放行、范围外抛 403 专用码', async () => {
    const { service } = makeService({
      roles: [ROLE_APP],
      relations: [APPCENTER_GRANT],
      bindings: [{ userId: 'u1', appId: 'a1' }],
    })
    await expect(service.assertAppAllowed('u1', 'a1', 'appcenter')).resolves.toBeUndefined()
    await expect(service.assertAppAllowed('u1', 'a2', 'appcenter')).rejects.toMatchObject({
      code: 300100005,
      status: 403,
    })
  })

  it('列表显式筛选：未授权 appId 抛 403，全量模式一律放行', () => {
    const { service } = makeService({
      roles: [ROLE_APP],
      relations: [APPCENTER_GRANT],
      bindings: [{ userId: 'u1', appId: 'a1' }],
    })
    expect(() => service.assertListAppId('a2', ['a1'])).toThrow(/无权操作该应用/)
    expect(() => service.assertListAppId('ghost', null)).not.toThrow()
  })

  it('SCOPED 空集：任意单资源操作均 403（漏配授权不退化为全量）', async () => {
    const { service } = makeService({ roles: [ROLE_APP], relations: [APPCENTER_GRANT] })
    await expect(service.getListAppIds('u1', 'appcenter')).resolves.toEqual([])
    await expect(service.assertAppAllowed('u1', 'a1', 'appcenter')).rejects.toMatchObject({
      code: 300100005,
    })
  })
})
