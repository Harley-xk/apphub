/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: appcenter 模块公共常量：状态 / 平台 / 架构枚举、tauri target 映射、OSS 对象键规范（设计 §2）
 */

/** 应用状态：停用后其开放 API 调用全部拒绝 */
export const APP_STATUS = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const

/** 调用方类型（风控差异化依据，不影响鉴权分支，D17；公开客户端限流阈值减半） */
export const CLIENT_TYPE = {
  CONFIDENTIAL: 'confidential',
  PUBLIC: 'public',
} as const

/** 技术框架归类（适配端点产物登记的校验依据，D24 主张 A5） */
export const APP_FRAMEWORK = {
  ELECTRON: 'electron',
  TAURI: 'tauri',
  CUSTOM: 'custom',
} as const

/** 包平台（web 平台无包记录——版本仅登记，更新检测只做提示；ios 仅登记元信息不分发安装包，D1） */
export const PACKAGE_PLATFORM = {
  WINDOWS: 'windows',
  MACOS: 'macos',
  LINUX: 'linux',
  ANDROID: 'android',
  IOS: 'ios',
  WEB: 'web',
} as const

/** 桌面端架构（web / android / ios 填 null） */
export const PACKAGE_ARCH = {
  X64: 'x64',
  ARM64: 'arm64',
  UNIVERSAL: 'universal',
} as const

/** 版本状态机（draft → published → offline，offline 为终态，设计 §3.2） */
export const VERSION_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  OFFLINE: 'offline',
} as const

/** 创建应用时自动预置的默认通道 code（不可删除，主张 A1） */
export const STABLE_CHANNEL_CODE = 'stable'

/** 安装包签名下载 URL 时效：2h（与开放更新协议 / D24 适配端点同口径，设计 §2.5） */
export const PACKAGE_DOWNLOAD_EXPIRES_SECONDS = 2 * 60 * 60

/** 通道与应用状态共用值 */
export const CHANNEL_STATUS = APP_STATUS

/**
 * electron-updater 清单的平台 → arch 固定映射（D24）：latest*.yml 为平台级 feed（URL 不含 arch），
 * 按 electron-updater 默认拉取方取包——latest.yml→(windows,x64)、latest-mac.yml→(macos,universal)、
 * latest-linux.yml→(linux,x64)，槽位无包即 404（设计 §3.4）
 */
export const ELECTRON_MANIFEST_ARCH: Readonly<Record<string, string>> = {
  [PACKAGE_PLATFORM.WINDOWS]: PACKAGE_ARCH.X64,
  [PACKAGE_PLATFORM.MACOS]: PACKAGE_ARCH.UNIVERSAL,
  [PACKAGE_PLATFORM.LINUX]: PACKAGE_ARCH.X64,
}

/**
 * tauri-plugin-updater 的 target → (platform, arch) 映射（D24）：
 * 未识别的 target 由调用方按「无更新」处理（204）
 */
export const TAURI_TARGET_MAP: Readonly<Record<string, { platform: string, arch: string }>> = {
  'windows-x86_64': { platform: PACKAGE_PLATFORM.WINDOWS, arch: PACKAGE_ARCH.X64 },
  'windows-aarch64': { platform: PACKAGE_PLATFORM.WINDOWS, arch: PACKAGE_ARCH.ARM64 },
  'darwin-x86_64': { platform: PACKAGE_PLATFORM.MACOS, arch: PACKAGE_ARCH.X64 },
  'darwin-aarch64': { platform: PACKAGE_PLATFORM.MACOS, arch: PACKAGE_ARCH.ARM64 },
  'linux-x86_64': { platform: PACKAGE_PLATFORM.LINUX, arch: PACKAGE_ARCH.X64 },
}

/**
 * 安装包 OSS 对象键规范（设计 §2.5）：
 * `packages/{appKey}/{channelCode}/{version}/{platform}[-{arch}]/{fileName}`——由后端生成下发（前端不自由拼键）
 */
export function buildPackageObjectKey(input: {
  appKey: string
  channelCode: string
  version: string
  platform: string
  arch?: string | null
  fileName: string
}): string {
  const platformArch = input.arch ? `${input.platform}-${input.arch}` : input.platform
  return `packages/${input.appKey}/${input.channelCode}/${input.version}/${platformArch}/${input.fileName}`
}

/** blockmap 差分文件放包同目录：`{fileName}.blockmap` */
export function buildBlockmapFileName(fileName: string): string {
  return `${fileName}.blockmap`
}
