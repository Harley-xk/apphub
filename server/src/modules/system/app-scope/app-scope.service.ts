/*
 * 作者: Harley-xk
 * 创建: 2026-10-23
 *
 * 描述: 应用级数据范围判定服务：逐请求现查库收敛 ALL / SCOPED，供 appcenter 与 subscription 收窄列表与校验单资源归属
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Like } from 'typeorm'
import type { Repository } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
// 错误码归 appcenter 模块段（设计 §7.5）：同码在 subscription 域复用；此处仅引用叶子常量，不构成对 appcenter 服务的静态依赖
import { AppcenterErrorCode } from '../../appcenter/error-codes'
import { RolePermissionEntity } from '../entities/role-permission.entity'
import { UserAppScopeEntity } from '../entities/user-app-scope.entity'
import { PermissionService } from '../permission.service'
import { DATA_SCOPE_ALL, SUPER_ADMIN_ROLE_CODE, type AppScopeDomain } from '../system.constants'

/** 数据范围判定结果：all 不加条件 / scoped 以应用集合为边界 */
export type AppScope
  = | { mode: 'all' }
    | { mode: 'scoped', appIds: string[] }

@Injectable()
export class AppScopeService {
  constructor(
    @InjectRepository(UserAppScopeEntity)
    private readonly userAppScopeRepository: Repository<UserAppScopeEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepository: Repository<RolePermissionEntity>,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * 范围判定（应用管理员与数据范围设计 §5.1）：
   * 启用角色 → super_admin 全集 → 授予该域权限的角色 → 其中任一 all 即全量 → 否则账户级授权集合。
   * 范围跟着「授予该域权限的角色」走：只有 system 权限的 all 角色不会解除应用限制（A4）。
   */
  async resolve(userId: string, domain: AppScopeDomain): Promise<AppScope> {
    const roles = await this.permissionService.getUserEnabledRoles(userId)
    if (roles.length === 0)
      throw this.forbidden()
    if (roles.some(role => role.code === SUPER_ADMIN_ROLE_CODE))
      return { mode: 'all' }
    // 该域权限授予情况：只认持有 domain 段权限的角色（A4）
    const relations = await this.rolePermissionRepository.find({
      where: { roleId: In(roles.map(role => role.id)), permission: Like(`${domain}:%`) },
    })
    const grantedRoleIds = new Set(relations.map(relation => relation.roleId))
    const grantedRoles = roles.filter(role => grantedRoleIds.has(role.id))
    // NOT_GRANTED 属防御分支：正常请求已被 PermissionsGuard 以 403 拦截
    if (grantedRoles.length === 0)
      throw this.forbidden()
    if (grantedRoles.some(role => role.dataScope === DATA_SCOPE_ALL))
      return { mode: 'all' }
    const bindings = await this.userAppScopeRepository.find({ where: { userId } })
    return { mode: 'scoped', appIds: bindings.map(binding => binding.appId) }
  }

  /**
   * 列表收口：返回 null 表示全量（不加条件）；数组表示注入 `appId IN (...)` 的集合（可能为空——空集合即空页，A5 fail-closed）。
   */
  async getListAppIds(userId: string, domain: AppScopeDomain): Promise<string[] | null> {
    const scope = await this.resolve(userId, domain)
    return scope.mode === 'all' ? null : scope.appIds
  }

  /**
   * 单资源收口：不在授权集合内抛 403 + 专用错误码（应用管理员与数据范围设计 A11 / §7.5）。
   * 调用方须先完成资源存在性校验（不存在 404 优先于越权 403）。
   */
  async assertAppAllowed(userId: string, appId: string, domain: AppScopeDomain): Promise<void> {
    const scope = await this.resolve(userId, domain)
    if (scope.mode === 'all')
      return
    if (!scope.appIds.includes(appId))
      throw this.forbidden()
  }

  /**
   * 列表显式筛选校验：请求显式传入 appId 而它不在授权集合内 → 403。
   * 复用已解析的列表集合，避免二次查库（供列表接口在注入条件前调用）。
   */
  assertListAppId(appId: string, scopeAppIds: string[] | null): void {
    if (scopeAppIds !== null && !scopeAppIds.includes(appId))
      throw this.forbidden()
  }

  /** 越权统一异常：403 + APP_SCOPE_FORBIDDEN（不泄漏未授权资源内容） */
  private forbidden(): Error {
    return businessError(AppcenterErrorCode.APP_SCOPE_FORBIDDEN.message, {
      code: AppcenterErrorCode.APP_SCOPE_FORBIDDEN,
      status: 403,
    })
  }
}
