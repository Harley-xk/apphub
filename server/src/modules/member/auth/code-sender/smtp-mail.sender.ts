/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: SMTP 邮件通道（nodemailer）：验证码 HTML 模板自写（C8 邮箱侧不受报备限制），失败抛错由验证码域统一转 004002010
 */
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

import type { CodeSender } from './code-sender'
import { VERIFY_CODE_TTL_MS } from '../../member.constants'

/** 邮件通道配置（configuration.ts mail 段） */
export interface MailChannelConfig {
  host: string
  port: number
  user: string
  password: string
  from: string
}

/** 五项齐备视为邮件通道已配置（认证方式扩展设计 §3.2 装配条件） */
export function isMailConfigured(config: MailChannelConfig): boolean {
  return Boolean(config.host && config.user && config.password && config.from)
}

/** SMTP 邮件通道：连接各阶段 10s 超时（认证方式扩展设计 §4.5），465 端口隐式 TLS */
export class SmtpMailSender implements CodeSender {
  private readonly transporter: Transporter
  private readonly from: string

  constructor(config: MailChannelConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    })
    this.from = config.from
  }

  async send(identifier: string, code: string): Promise<void> {
    const minutes = Math.floor(VERIFY_CODE_TTL_MS / 60_000)
    await this.transporter.sendMail({
      from: this.from,
      to: identifier,
      subject: 'apphub 登录验证码',
      text: `您的验证码是 ${code}，${minutes} 分钟内有效。若非本人操作，请忽略本邮件。`,
      html: `<p>您的验证码：<b style="font-size:20px;letter-spacing:4px">${code}</b></p><p>${minutes} 分钟内有效，若非本人操作请忽略本邮件。</p>`,
    })
  }
}
