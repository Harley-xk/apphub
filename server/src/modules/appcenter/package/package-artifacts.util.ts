/*
 * 作者: Harley-xk
 * 创建: 2026-10-24
 *
 * 描述: 框架产物完整性校验（electron 须 sha512 / tauri 须 minisign，主张 A5）：发布前置与已发布版本补包登记共用同一规则
 */
import { businessError } from '../../../common/exceptions/business-error'
import { APP_FRAMEWORK } from '../appcenter.constants'
import { AppcenterErrorCode } from '../error-codes'

/** 校验对象最小字段集：发布时传版本下全部包，登记时传待落库的单包 */
export interface FrameworkArtifactPackage {
  platform: string
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
  }
}
