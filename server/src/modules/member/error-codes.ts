/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: member 模块错误码常量表（模块段 004，段位登记表见 docs/指南/统一响应与异常处理设计.md）
 */
import { ErrorCode } from '../../common/errors/error-code'

/**
 * member 模块（模块段 004）分域错误码。
 *
 * 子域划分：001 会员 / 002 凭证 / 003 认证与令牌；
 * 数值 = 模块段 3 × 10^8 + 子域号 × 10^5 + 序号（如 400100001）。
 */
export const MemberErrorCode = {
  // ===== 子域 001：会员 =====
  /** 会员不存在 */
  MEMBER_NOT_EXISTS: new ErrorCode(400100001, '会员不存在'),
  /** 会员已禁用 */
  MEMBER_DISABLED: new ErrorCode(400100002, '会员已禁用'),
  // ===== 子域 002：凭证 =====
  /** 凭证类型不支持 */
  CREDENTIAL_TYPE_UNSUPPORTED: new ErrorCode(400200001, '凭证类型不支持'),
  /** 凭证标识已存在（注册冲突 / 绑定冲突） */
  CREDENTIAL_IDENTIFIER_DUPLICATE: new ErrorCode(400200002, '凭证标识已存在'),
  /** 凭证不存在 */
  CREDENTIAL_NOT_EXISTS: new ErrorCode(400200003, '凭证不存在'),
  /** 凭证已归属其他会员（绑定合并拒绝） */
  CREDENTIAL_OWNED_BY_OTHER: new ErrorCode(400200004, '凭证已归属其他会员，请先解绑'),
  /** 最后一条密码凭证不允许解绑 */
  LAST_PASSWORD_CREDENTIAL: new ErrorCode(400200005, '最后一条密码凭证不允许解绑'),
  /** 验证码错误或过期（单次作废：失败一次即须重发，认证方式扩展设计 C6） */
  VERIFY_CODE_INVALID: new ErrorCode(400200006, '验证码错误或已过期'),
  /** 凭证格式非法（标识 / 密文不符合类型规则，DTO 宽松化后由服务层分流校验，主张 C11） */
  CREDENTIAL_FORMAT_INVALID: new ErrorCode(400200007, '凭证格式非法'),
  /** 验证码发送过于频繁（60 秒重发间隔内） */
  VERIFY_CODE_TOO_FREQUENT: new ErrorCode(400200008, '验证码发送过于频繁，请稍后再试'),
  /** 验证码超出当日发送限额 */
  VERIFY_CODE_DAILY_LIMIT: new ErrorCode(400200009, '验证码发送次数已达当日上限'),
  /** 验证码通道发送失败（通道异常 / 通道未装配） */
  VERIFY_CODE_SEND_FAILED: new ErrorCode(400200010, '验证码发送失败，请稍后重试'),
  // ===== 子域 003：认证与令牌 =====
  /** 登录失败（账号或密码错误，统一文案防枚举） */
  LOGIN_FAILED: new ErrorCode(400300001, '账号或密码错误'),
  /** 登录尝试已锁定 */
  LOGIN_LOCKED: new ErrorCode(400300002, '登录尝试次数过多，请稍后再试'),
  /** refresh token 无效或已过期 */
  REFRESH_TOKEN_INVALID: new ErrorCode(400300003, '登录状态已失效，请重新登录'),
  /** 令牌与应用不匹配（appKey 校验失败，D19） */
  TOKEN_APP_MISMATCH: new ErrorCode(400300004, '令牌与应用不匹配'),
  /** access token 无效或已过期 */
  ACCESS_TOKEN_INVALID: new ErrorCode(400300005, '访问令牌无效或已过期，请重新登录'),
} as const
