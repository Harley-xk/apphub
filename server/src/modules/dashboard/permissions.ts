/*
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: dashboard 模块权限点注册表（接入方式见 docs/指南/新模块接入指南.md 第 3 步）
 */
import type { PermissionPoint } from '../system/permissions'

/**
 * 权限点常量：注解与业务代码一律引用常量而非裸字符串（与错误码常量同一哲学）。
 * 三段冒号小写「模块:域:操作」，首段必须等于提供模块的注册名。
 */
export const DASHBOARD_PERMISSION_CODES = {
  OVERVIEW_QUERY: 'dashboard:overview:query',
} as const

/** dashboard 模块的注册名（权限串首段须与之相等，注册表启动期校验） */
export const DASHBOARD_MODULE_NAME = 'dashboard'

/** 权限点清单：登记处即唯一出处，新增权限点在此加行 */
export const DASHBOARD_PERMISSIONS: readonly PermissionPoint[] = [
  { code: DASHBOARD_PERMISSION_CODES.OVERVIEW_QUERY, label: '工作台概览查询' },
]
