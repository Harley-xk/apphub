/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 验证码 log 降级通道：非生产环境且真实通道未配置时兜底（C7），验证码写服务日志（标识打码），开发零配置可跑
 */
import { Logger } from '@nestjs/common'

import type { CodeSender } from './code-sender'

/** 标识打码：手机号 138****8000 / 邮箱 a***@example.com（log 通道不留完整标识） */
function maskIdentifier(identifier: string): string {
  if (identifier.includes('@')) {
    const [local, domain] = identifier.split('@')
    return `${local.slice(0, 1)}***@${domain}`
  }
  return identifier.length >= 7 ? `${identifier.slice(0, 3)}****${identifier.slice(-4)}` : '***'
}

/** log 降级通道：恒成功（发送动作即日志落盘） */
export class LogCodeSender implements CodeSender {
  constructor(
    private readonly logger: Logger,
    private readonly channel: string,
  ) {}

  send(identifier: string, code: string): Promise<void> {
    this.logger.log(`[mock 通道·${this.channel}] 验证码 ${code} → ${maskIdentifier(identifier)}（真实通道未配置，开发降级）`)
    return Promise.resolve()
  }
}
