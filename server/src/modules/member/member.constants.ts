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

/** 凭证类型（D5：四种登录方式，M2 首期仅 password 生效，其余按 M4 资质就绪接入） */
export const CREDENTIAL_TYPE = {
  PASSWORD: 'password',
  PHONE: 'phone',
  EMAIL: 'email',
  WECHAT: 'wechat',
  ALIPAY: 'alipay',
} as const

/** 首期开放自助注册 / 登录的凭证类型（其余类型返回「凭证类型不支持」） */
export const SELF_SERVICE_TYPES: readonly string[] = [CREDENTIAL_TYPE.PASSWORD]

/** 凭证密文启用类型（仅 password 持 bcrypt 密文；phone/email 走验证码、扫码走第三方标识） */
export const SECRET_TYPES: readonly string[] = [CREDENTIAL_TYPE.PASSWORD]

/** 刷新令牌状态 */
export const REFRESH_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

/** 会员登录日志类型（对齐 system 域约定） */
export const MEMBER_LOG_TYPE_LOGIN = 10
export const MEMBER_LOG_TYPE_LOGOUT = 20

/** 防爆破锁定策略（统一认证设计 §3.3）：连续失败 5 次锁 15 分钟 */
export const LOGIN_LOCK_MAX_FAILURES = 5
export const LOGIN_LOCK_MINUTES = 15

/** 密码标识规则：字母数字下划线 4-32 位（统一认证设计 §2.2） */
export const PASSWORD_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]{4,32}$/

/** bcrypt cost：对齐 system 域现有实现（user.service.ts BCRYPT_COST = 10） */
export const BCRYPT_COST = 10

/** 管理端重置密码生成长度 */
export const RESET_PASSWORD_LENGTH = 12
