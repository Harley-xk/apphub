/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: subscription 模块权限点注册表（接入方式见 docs/指南/新模块接入指南.md 第 3 步）
 */
import type { PermissionPoint } from '../system/permissions'

/**
 * 权限点常量：注解与业务代码一律引用常量而非裸字符串（与错误码常量同一哲学）。
 * 三段冒号小写「模块:域:操作」，首段必须等于提供模块的注册名。
 */
export const SUBSCRIPTION_PERMISSION_CODES = {
  PLAN_QUERY: 'subscription:plan:query',
  PLAN_CREATE: 'subscription:plan:create',
  PLAN_UPDATE: 'subscription:plan:update',
  PLAN_REMOVE: 'subscription:plan:remove',
  ORDER_QUERY: 'subscription:order:query',
  ORDER_OFFLINE_CREATE: 'subscription:order:offline-create',
  ORDER_CLOSE: 'subscription:order:close',
  SUB_QUERY: 'subscription:sub:query',
} as const

/** subscription 模块的注册名（权限串首段须与之相等，注册表启动期校验） */
export const SUBSCRIPTION_MODULE_NAME = 'subscription'

/** 权限点清单：登记处即唯一出处，新增权限点在此加行（全集 8 项 = plan 4 + order 3 + sub 1） */
export const SUBSCRIPTION_PERMISSIONS: readonly PermissionPoint[] = [
  { code: SUBSCRIPTION_PERMISSION_CODES.PLAN_QUERY, label: '订阅计划查询' },
  { code: SUBSCRIPTION_PERMISSION_CODES.PLAN_CREATE, label: '订阅计划新增' },
  { code: SUBSCRIPTION_PERMISSION_CODES.PLAN_UPDATE, label: '订阅计划修改' },
  { code: SUBSCRIPTION_PERMISSION_CODES.PLAN_REMOVE, label: '订阅计划删除' },
  { code: SUBSCRIPTION_PERMISSION_CODES.ORDER_QUERY, label: '订阅订单查询' },
  { code: SUBSCRIPTION_PERMISSION_CODES.ORDER_OFFLINE_CREATE, label: '线下收款备案' },
  { code: SUBSCRIPTION_PERMISSION_CODES.ORDER_CLOSE, label: '订单手动关闭' },
  { code: SUBSCRIPTION_PERMISSION_CODES.SUB_QUERY, label: '订阅实例查询' },
]
