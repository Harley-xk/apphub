/*
 * 作者: Harley-xk
 * 创建: 2026-11-12
 *
 * 描述: macOS 多架构更新清单选包（主张 B2 / B4）：决定 latest-mac.yml files 的架构条目与顺序
 */
import { PACKAGE_ARCH } from '../appcenter.constants'

/** 选包最小字段集：包实体与测试桩共用 */
export interface MacAggregatePackage {
  arch: string | null
}

/**
 * 选包规则（设计 B2 / B4）：
 * - x64 与 arm64 都在：双架构条目（universal 不参与）
 * - 仅单架构 + universal：universal 前置——electron-updater 在「无 arm64 条目」时返回全部非 arm64 条目，
 *   若 x64 排在前面，arm64 机器会取到 x64 包（只能经 Rosetta 运行）
 * - 仅 universal：单条；无可用包：空数组
 */
export function pickMacAggregatePackages<T extends MacAggregatePackage>(packages: T[]): T[] {
  const byArch = new Map<string | null, T>(packages.map(pkg => [pkg.arch, pkg]))
  const x64 = byArch.get(PACKAGE_ARCH.X64)
  const arm64 = byArch.get(PACKAGE_ARCH.ARM64)
  const universal = byArch.get(PACKAGE_ARCH.UNIVERSAL)
  if (x64 && arm64)
    return [x64, arm64]

  const specific = x64 ?? arm64
  const ordered: T[] = []
  if (universal)
    ordered.push(universal)
  if (specific)
    ordered.push(specific)
  return ordered
}
