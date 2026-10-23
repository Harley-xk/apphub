/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: appcenter 模块错误码常量表（模块段 003，段位登记表见 docs/指南/统一响应与异常处理设计.md）
 */
import { ErrorCode } from '../../common/errors/error-code'

/**
 * appcenter 模块（模块段 003）分域错误码。
 *
 * 子域划分：001 应用 / 002 通道 / 003 版本 / 004 安装包与存储；
 * 数值 = 模块段 3 × 10^8 + 子域号 × 10^5 + 序号（如 300100001）。
 */
export const AppcenterErrorCode = {
  // ===== 子域 001：应用 =====
  /** 应用不存在 */
  APP_NOT_EXISTS: new ErrorCode(300100001, '应用不存在'),
  /** AppKey 无效（开放 API 校验时查无应用） */
  APP_KEY_INVALID: new ErrorCode(300100002, 'AppKey 无效'),
  /** 应用已停用 */
  APP_DISABLED: new ErrorCode(300100003, '应用已停用'),
  /** 应用存在已发布版本，不允许删除 */
  APP_HAS_PUBLISHED_VERSION: new ErrorCode(300100004, '应用存在已发布版本，不允许删除，请先下线版本'),
  /**
   * 无权操作该应用（应用级数据范围）：单资源越权与列表显式查询未授权应用统一使用该码。
   * 码值归 appcenter 模块段（应用管理员与数据范围设计 §7.5），subscription 域复用同码。
   */
  APP_SCOPE_FORBIDDEN: new ErrorCode(300100005, '无权操作该应用'),
  // ===== 子域 002：通道 =====
  /** 通道不存在 */
  CHANNEL_NOT_EXISTS: new ErrorCode(300200001, '通道不存在'),
  /** 通道 code 重复 */
  CHANNEL_CODE_DUPLICATE: new ErrorCode(300200002, '通道代码已存在'),
  /** stable 通道不允许删除 */
  STABLE_CHANNEL_UNREMOVABLE: new ErrorCode(300200003, '默认通道 stable 不允许删除'),
  // ===== 子域 003：版本 =====
  /** 版本不存在 */
  VERSION_NOT_EXISTS: new ErrorCode(300300001, '版本不存在'),
  /** 版本号不符合 semver */
  VERSION_NOT_SEMVER: new ErrorCode(300300002, '版本号不符合 semver 格式（MAJOR.MINOR.PATCH，可选预发布后缀）'),
  /** 通道内版本号重复 */
  VERSION_DUPLICATE: new ErrorCode(300300003, '该通道内版本号已存在'),
  /** 版本状态不允许该操作（状态机校验） */
  VERSION_STATUS_FORBIDDEN: new ErrorCode(300300004, '版本当前状态不允许该操作'),
  /** 发布校验失败（无可用平台包） */
  PUBLISH_NO_PACKAGE: new ErrorCode(300300005, '发布校验失败：至少需要一个已上传完成的非 web 平台包'),
  // ===== 子域 004：安装包与存储 =====
  /** STS 凭证签发失败（RAM / STS 配置异常或服务不可用） */
  STS_ISSUE_FAILED: new ErrorCode(300400001, '上传凭证签发失败（存储服务未配置或不可用）'),
  /** 平台 / 架构组合重复 */
  PACKAGE_PLATFORM_DUPLICATE: new ErrorCode(300400002, '该平台 / 架构组合已有包记录'),
  /** 框架产物缺失（electron 包无 sha512 / tauri 包无 minisign 签名，发布前置校验，D24） */
  FRAMEWORK_ARTIFACT_MISSING: new ErrorCode(300400003, '框架产物缺失：electron 包须登记 sha512，tauri 包须登记 minisign 签名'),
  /** 包对象不存在（登记时 HeadObject 校验失败——未上传或对象键不符） */
  PACKAGE_OBJECT_NOT_EXISTS: new ErrorCode(300400004, '安装包对象不存在（尚未上传完成或对象键不符）'),
  /** 包记录不存在 */
  PACKAGE_NOT_EXISTS: new ErrorCode(300400005, '包记录不存在'),
} as const
