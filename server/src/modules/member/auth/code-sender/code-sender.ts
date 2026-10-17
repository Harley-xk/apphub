/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 验证码发送通道抽象：短信 / 邮件各一装配位，实现按配置择一注入（认证方式扩展设计 §3.2）
 */

/** 短信通道注入令牌（phone 类型验证码） */
export const SMS_CODE_SENDER = 'SMS_CODE_SENDER'

/** 邮件通道注入令牌（email 类型验证码） */
export const MAIL_CODE_SENDER = 'MAIL_CODE_SENDER'

/** 验证码发送通道：实现自行包装异常语义（失败抛错由验证码域统一转 004002010） */
export interface CodeSender {
  /** identifier：手机号 / 邮箱地址；code：6 位数字验证码 */
  send(identifier: string, code: string): Promise<void>
}
