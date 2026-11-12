/*
 * 作者: Harley-xk
 * 创建: 2026-10-24
 *
 * 描述: 框架产物完整性校验（electron 须 sha512 / tauri 须 minisign，主张 A5）：发布前置与已发布版本补包登记共用同一规则
 */
import { businessError } from '../../../common/exceptions/business-error'
import { APP_FRAMEWORK, PACKAGE_ARCH, PACKAGE_PLATFORM } from '../appcenter.constants'
import { AppcenterErrorCode } from '../error-codes'

/** 校验对象最小字段集：发布时传版本下全部包，登记时传待落库的单包 */
export interface FrameworkArtifactPackage {
  platform: string
  arch?: string | null
  fileName?: string
  sha512?: string | null
  minisignSignature?: string | null
}

/** 框架产物缺失即抛出 FRAMEWORK_ARTIFACT_MISSING（framework 为空或 custom 不强制） */
export function assertFrameworkArtifacts(framework: string | null, packages: FrameworkArtifactPackage[]): void {
  for (const pkg of packages) {
    if (framework === APP_FRAMEWORK.ELECTRON && !pkg.sha512) {
      throw businessError(`框架产物缺失：electron 应用的 ${pkg.platform} 包缺少 sha512（D24，electron-updater 校验必需）`, {
        code: AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING,
      })
    }
    if (framework === APP_FRAMEWORK.TAURI && !pkg.minisignSignature) {
      throw businessError(`框架产物缺失：tauri 应用的 ${pkg.platform} 包缺少 minisign 签名（D24，tauri updater 验签必需）`, {
        code: AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING,
      })
    }
    if (framework === APP_FRAMEWORK.ELECTRON && pkg.platform === PACKAGE_PLATFORM.MACOS)
      assertElectronMacArtifact(pkg)
  }
}

/**
 * electron macOS 包的两条硬性约束（主张 B8，发布前置与已发布补包登记共用）：
 * 1. 更新链路只认 zip（electron-updater 用 findFile(files, "zip", ["pkg", "dmg"])），dmg 仅用于首次手动安装
 * 2. 文件名架构标记须与登记架构一致——客户端只用「文件名含 arm64」判断架构，
 *    arm64 包漏标会被分给 Intel 机器，x64 / universal 包误标会被 Apple Silicon 优先选中且 x64 机器直接排除
 */
function assertElectronMacArtifact(pkg: FrameworkArtifactPackage): void {
  const fileName = pkg.fileName ?? ''
  if (!fileName.toLowerCase().endsWith('.zip')) {
    throw businessError(
      `框架产物缺失：electron 应用的 macos 包须为 zip（electron-updater 更新只识别 zip，dmg 仅用于首次安装；主张 B8）`,
      { code: AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING },
    )
  }
  const hasArm64Mark = fileName.toLowerCase().includes('arm64')
  const expectArm64 = pkg.arch === PACKAGE_ARCH.ARM64
  if (hasArm64Mark !== expectArm64) {
    throw businessError(
      `框架产物缺失：electron 应用的 macos 包文件名架构标记须与登记架构一致（arch=${pkg.arch ?? 'null'}，fileName=${fileName}）——arm64 包须含 arm64，x64 / universal 包不得含 arm64（主张 B8）`,
      { code: AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING },
    )
  }
}
