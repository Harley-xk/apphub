/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: member 模块权限点注册表（接入方式见 docs/指南/新模块接入指南.md 第 3 步）
 */
import type { PermissionPoint } from '../system/permissions'

/**
 * 权限点常量：注解与业务代码一律引用常量而非裸字符串（与错误码常量同一哲学）。
 * 三段冒号小写「模块:域:操作」，首段必须等于提供模块的注册名。
 */
export const MEMBER_PERMISSION_CODES = {
  MEMBER_QUERY: 'member:member:query',
  MEMBER_DISABLE: 'member:member:disable',
  MEMBER_ENABLE: 'member:member:enable',
  MEMBER_REMOVE: 'member:member:remove',
  CREDENTIAL_UNBIND: 'member:credential:unbind',
  CREDENTIAL_RESET_PASSWORD: 'member:credential:reset-password',
} as const

/** member 模块的注册名（权限串首段须与之相等，注册表启动期校验） */
export const MEMBER_MODULE_NAME = 'member'

/** 权限点清单：登记处即唯一出处，新增权限点在此加行（全集 6 项 = member 4 + credential 2） */
export const MEMBER_PERMISSIONS: readonly PermissionPoint[] = [
  { code: MEMBER_PERMISSION_CODES.MEMBER_QUERY, label: '会员查询' },
  { code: MEMBER_PERMISSION_CODES.MEMBER_DISABLE, label: '会员禁用' },
  { code: MEMBER_PERMISSION_CODES.MEMBER_ENABLE, label: '会员启用' },
  { code: MEMBER_PERMISSION_CODES.MEMBER_REMOVE, label: '会员删除' },
  { code: MEMBER_PERMISSION_CODES.CREDENTIAL_UNBIND, label: '凭证解绑' },
  { code: MEMBER_PERMISSION_CODES.CREDENTIAL_RESET_PASSWORD, label: '凭证重置密码' },
]
