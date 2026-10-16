/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 开放 API DTO 集：自研更新检测协议的入参与出参契约（设计 §3.3，豁免签名与 JWT，D23 救生通道）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { PACKAGE_ARCH, PACKAGE_PLATFORM } from '../../appcenter.constants'

/** 自研协议更新检测入参 */
export class VersionCheckDto {
  @ApiPropertyOptional({ description: '通道 code，缺省 stable', default: 'stable' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  channel?: string

  @ApiProperty({ description: '客户端平台（windows / macos / linux / android / ios / web）', example: 'windows' })
  @IsIn(
    [
      PACKAGE_PLATFORM.WINDOWS,
      PACKAGE_PLATFORM.MACOS,
      PACKAGE_PLATFORM.LINUX,
      PACKAGE_PLATFORM.ANDROID,
      PACKAGE_PLATFORM.IOS,
      PACKAGE_PLATFORM.WEB,
    ],
    { message: '平台取值须为 windows / macos / linux / android / ios / web' },
  )
  platform: string

  @ApiPropertyOptional({ description: '架构（桌面端必填，其余可空）', example: 'x64' })
  @IsOptional()
  @IsIn([PACKAGE_ARCH.X64, PACKAGE_ARCH.ARM64, PACKAGE_ARCH.UNIVERSAL], { message: '架构取值须为 x64 / arm64 / universal' })
  arch?: string

  @ApiPropertyOptional({ description: '客户端当前版本（semver；非 semver 按必有更新处理，首次安装可空）', example: '1.2.0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  currentVersion?: string
}

/** 自研协议下载包信息（web / ios 提示型平台为 null） */
export interface CheckPackageVo {
  fileName: string
  fileSize: number
  sha256: string
  /** 2h 签名下载 URL（动态生成不落库） */
  downloadUrl: string
}

/** 自研协议响应：无更新 / 通道停用 / 应用停用时仅 hasUpdate: false（不暴露状态细节） */
export interface CheckVersionVo {
  hasUpdate: boolean
  latestVersion?: string
  title?: string
  notes?: string | null
  /** 强制更新标记：候选版本的 force_update（单一事实源渲染一，主张 A4） */
  forceUpdate?: boolean
  package?: CheckPackageVo | null
}

/** tauri-plugin-updater 响应 manifest（v2 endpoint 协议，设计 §3.4） */
export interface TauriManifestVo {
  version: string
  pub_date: string
  notes: string
  platforms: Record<string, { signature: string, url: string }>
}
