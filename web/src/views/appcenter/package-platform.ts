/*
 * 作者: Harley-xk
 * 创建: 2026-10-26
 *
 * 描述: 平台 / 架构展示映射与组合文案（应用列表、版本列表、安装包抽屉共用）
 */
import type { PackageTargetVO } from '@/api/appcenter/package'

/** 平台展示映射（后端取值域 windows / macos / linux / android / ios） */
export const PLATFORM_LABELS: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
}

/** 目标标签文案：有架构拼「平台 架构」，无架构平台（android / ios）只显示平台名 */
export function formatPackageTarget(target: PackageTargetVO): string {
  const label = PLATFORM_LABELS[target.platform] ?? target.platform
  return target.arch ? `${label} ${target.arch}` : label
}
