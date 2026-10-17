/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: member 模块常量：凭证类型、会员/令牌状态、登录日志类型与防爆破锁定策略（统一认证设计 §2/§3.3）
 */

/** 会员状态 */
export const MEMBER_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const

/** 凭证类型（D5：四种登录方式，M2 密码先行，M4 全量开放——认证方式扩展设计 §3.3 矩阵） */
export const CREDENTIAL_TYPE = {
  PASSWORD: 'password',
  PHONE: 'phone',
  EMAIL: 'email',
  WECHAT: 'wechat',
  ALIPAY: 'alipay',
} as const

/** 凭证类型白名单：register / login / bind 三接口统一开放（非法类型 0042001） */
export const SUPPORTED_TYPES: readonly string[] = Object.values(CREDENTIAL_TYPE)

/** 验证码凭证类型（credential 为 6 位验证码，内存域校验） */
export const CODE_TYPES: readonly string[] = [CREDENTIAL_TYPE.PHONE, CREDENTIAL_TYPE.EMAIL]

/** 扫码凭证类型（credential 传占位不校验，应用侧 OAuth 换取标识，C4 信任签名层） */
export const OAUTH_TYPES: readonly string[] = [CREDENTIAL_TYPE.WECHAT, CREDENTIAL_TYPE.ALIPAY]

/** 扫码类型 credential 占位值（平台不校验不落库） */
export const OAUTH_PLACEHOLDER = 'oauth'

/** 凭证密文启用类型（仅 password 持 bcrypt 密文；phone/email 走验证码、扫码走第三方标识） */
export const SECRET_TYPES: readonly string[] = [CREDENTIAL_TYPE.PASSWORD]

/** 刷新令牌状态 */
export const REFRESH_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

/** 会员登录日志类型（对齐 system 域约定；30 为 M4 发码行为留痕，风控审计查询统一一张表） */
export const MEMBER_LOG_TYPE_LOGIN = 10
export const MEMBER_LOG_TYPE_LOGOUT = 20
export const MEMBER_LOG_TYPE_CODE_SEND = 30

/** 验证码域参数（认证方式扩展设计 §3.1） */
/** 验证码位数（纯数字） */
export const VERIFY_CODE_LENGTH = 6
/** 验证码有效期（毫秒），默认 5 分钟 */
export const VERIFY_CODE_TTL_MS = 5 * 60 * 1000
/** 重发间隔（毫秒），以最近一次成功发送计时——发送失败不占间隔（C9） */
export const VERIFY_CODE_RESEND_INTERVAL_MS = 60 * 1000
/** 单 identifier 自然日发送限额（全局维度，不含 appKey——C10） */
export const VERIFY_CODE_DAILY_LIMIT = 10
/** 过期条目清理周期（毫秒） */
export const VERIFY_CODE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/** 手机号格式：国内 11 位（认证方式扩展设计 §2 实现层主张） */
export const PHONE_PATTERN = /^1[3-9]\d{9}$/
/** 邮箱格式：宽松 RFC（非空白 + 单 @ + 顶域） */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 验证码格式：6 位纯数字 */
export const VERIFY_CODE_PATTERN = /^\d{6}$/

/** 防爆破锁定策略（统一认证设计 §3.3）：连续失败 5 次锁 15 分钟 */
export const LOGIN_LOCK_MAX_FAILURES = 5
export const LOGIN_LOCK_MINUTES = 15

/** 密码标识规则：字母数字下划线 4-32 位（统一认证设计 §2.2） */
export const PASSWORD_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]{4,32}$/
/** 密码强度：8-64 位且至少含字母与数字（首期不强制特殊字符，统一认证设计 §3.3；C11 迁至服务层校验） */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/

/** bcrypt cost：对齐 system 域现有实现（user.service.ts BCRYPT_COST = 10） */
export const BCRYPT_COST = 10

/** 管理端重置密码生成长度 */
export const RESET_PASSWORD_LENGTH = 12
