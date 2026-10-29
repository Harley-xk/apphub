/*
 * 作者: Harley-xk
 * 创建: 2026-10-26
 *
 * 描述: 列表平台 / 架构聚合：把包记录归并为 (platform, arch) 成对去重的目标清单（设计 §3.7 主张 A6 / A7）
 */
import { PACKAGE_ARCH, PACKAGE_PLATFORM } from '../appcenter.constants'
import type { AppPackageEntity } from '../entities/app-package.entity'

/** 列表出参目标项：平台 + 架构（无架构平台如 android / ios 为 null） */
export interface PackageTargetVo {
  platform: string
  arch: string | null
}

/** 平台展示顺序（稳定输出，未识别取值排末尾） */
const PLATFORM_ORDER: readonly string[] = Object.values(PACKAGE_PLATFORM)

/** 架构展示顺序：无架构（android / ios）排在所有具名架构之后 */
const ARCH_ORDER: readonly (string | null)[] = [
  PACKAGE_ARCH.X64,
  PACKAGE_ARCH.ARM64,
  PACKAGE_ARCH.UNIVERSAL,
  null,
]

/** 取值在展示顺序中的位置；未识别取值统一落到末尾 */
function orderIndex(order: readonly (string | null)[], value: string | null): number {
  const index = order.indexOf(value)
  return index === -1 ? order.length : index
}

/** 目标排序：平台优先、架构其次；未识别取值按字典序兜底保证稳定 */
function compareTarget(a: PackageTargetVo, b: PackageTargetVo): number {
  const platformRank = orderIndex(PLATFORM_ORDER, a.platform) - orderIndex(PLATFORM_ORDER, b.platform)
  if (platformRank !== 0)
    return platformRank
  if (a.platform !== b.platform)
    return a.platform < b.platform ? -1 : 1
  const archRank = orderIndex(ARCH_ORDER, a.arch) - orderIndex(ARCH_ORDER, b.arch)
  if (archRank !== 0)
    return archRank
  if (a.arch === b.arch)
    return 0
  return (a.arch ?? '') < (b.arch ?? '') ? -1 : 1
}

/**
 * 包记录 → 去重排序后的 (platform, arch) 目标清单。
 * 同一目标在多个版本 / 多个包中重复出现只保留一项（应用级跨版本聚合依赖此去重）。
 */
export function collectPackageTargets(
  packages: Pick<AppPackageEntity, 'platform' | 'arch'>[],
): PackageTargetVo[] {
  const seen = new Set<string>()
  const targets: PackageTargetVo[] = []
  for (const pkg of packages) {
    const arch = pkg.arch ?? null
    const key = `${pkg.platform}\u0000${arch ?? ''}`
    if (seen.has(key))
      continue
    seen.add(key)
    targets.push({ platform: pkg.platform, arch })
  }
  return targets.sort(compareTarget)
}
