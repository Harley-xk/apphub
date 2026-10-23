/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: appcenter 模块权限点注册表（接入方式见 docs/指南/新模块接入指南.md 第 3 步）
 */
import type { PermissionPoint } from '../system/permissions'

/**
 * 权限点常量：注解与业务代码一律引用常量而非裸字符串（与错误码常量同一哲学）。
 * 三段冒号小写「模块:域:操作」，首段必须等于提供模块的注册名。
 */
export const APPCENTER_PERMISSION_CODES = {
  APP_QUERY: 'appcenter:app:query',
  APP_CREATE: 'appcenter:app:create',
  APP_UPDATE: 'appcenter:app:update',
  /** 应用启用 / 停用：自 app:update 拆分，应用管理员不持有（A8 / A9） */
  APP_TOGGLE_STATUS: 'appcenter:app:toggle-status',
  APP_REMOVE: 'appcenter:app:remove',
  APP_RESET_SECRET: 'appcenter:app:reset-secret',
  CHANNEL_QUERY: 'appcenter:channel:query',
  CHANNEL_CREATE: 'appcenter:channel:create',
  CHANNEL_UPDATE: 'appcenter:channel:update',
  CHANNEL_REMOVE: 'appcenter:channel:remove',
  VERSION_QUERY: 'appcenter:version:query',
  VERSION_CREATE: 'appcenter:version:create',
  VERSION_UPDATE: 'appcenter:version:update',
  VERSION_REMOVE: 'appcenter:version:remove',
  VERSION_PUBLISH: 'appcenter:version:publish',
  VERSION_OFFLINE: 'appcenter:version:offline',
} as const

/** appcenter 模块的注册名（权限串首段须与之相等，注册表启动期校验） */
export const APPCENTER_MODULE_NAME = 'appcenter'

/** 权限点清单：登记处即唯一出处，新增权限点在此加行（全集 16 项 = app 6 + channel 4 + version 6） */
export const APPCENTER_PERMISSIONS: readonly PermissionPoint[] = [
  { code: APPCENTER_PERMISSION_CODES.APP_QUERY, label: '应用查询' },
  { code: APPCENTER_PERMISSION_CODES.APP_CREATE, label: '应用新增' },
  { code: APPCENTER_PERMISSION_CODES.APP_UPDATE, label: '应用修改' },
  { code: APPCENTER_PERMISSION_CODES.APP_TOGGLE_STATUS, label: '应用启停' },
  { code: APPCENTER_PERMISSION_CODES.APP_REMOVE, label: '应用删除' },
  { code: APPCENTER_PERMISSION_CODES.APP_RESET_SECRET, label: '应用重置凭证' },
  { code: APPCENTER_PERMISSION_CODES.CHANNEL_QUERY, label: '通道查询' },
  { code: APPCENTER_PERMISSION_CODES.CHANNEL_CREATE, label: '通道新增' },
  { code: APPCENTER_PERMISSION_CODES.CHANNEL_UPDATE, label: '通道修改' },
  { code: APPCENTER_PERMISSION_CODES.CHANNEL_REMOVE, label: '通道删除' },
  { code: APPCENTER_PERMISSION_CODES.VERSION_QUERY, label: '版本查询' },
  { code: APPCENTER_PERMISSION_CODES.VERSION_CREATE, label: '版本新增' },
  { code: APPCENTER_PERMISSION_CODES.VERSION_UPDATE, label: '版本修改' },
  { code: APPCENTER_PERMISSION_CODES.VERSION_REMOVE, label: '版本删除' },
  { code: APPCENTER_PERMISSION_CODES.VERSION_PUBLISH, label: '版本发布' },
  { code: APPCENTER_PERMISSION_CODES.VERSION_OFFLINE, label: '版本下线' },
]
