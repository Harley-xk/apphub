/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 应用签名方案：开放 API 的应用级 HMAC 验签——按 X-App-Key 头解析应用密钥后复用标准方案全部验签逻辑（统一认证设计 §3.6 主张 I2/I8）
 */
import { Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { AppSecretRegistry } from '../app-secret.registry'
import { StandardSignatureScheme } from './standard-signature.scheme'
import type { SignatureContext, SignatureScheme } from '../interfaces/signature-scheme.interface'

/** 应用签名方案名：开放 API 控制器经 @UseSignature('app') 引用 */
export const APP_SCHEME_NAME = 'app'

@Injectable()
export class AppSignatureScheme implements SignatureScheme {
  readonly name = APP_SCHEME_NAME

  constructor(
    private readonly appSecretRegistry: AppSecretRegistry,
    // 组合标准方案：时间窗 / nonce 防重放 / 签名串构造 / 常量时间比对全部复用，仅密钥来源不同
    private readonly standardScheme: StandardSignatureScheme,
  ) {}

  async verify(ctx: SignatureContext): Promise<void> {
    const request: Request = ctx.request
    const header = request.headers['x-app-key']
    const appKey = Array.isArray(header) ? header[0] : header
    if (typeof appKey !== 'string' || !appKey)
      throw new Error('缺少 AppKey 头')

    // 密钥源由 appcenter 注册（查无应用 / 已停用均返回 null）：不区分失败原因，统一按验签失败拒绝
    const secret = await this.appSecretRegistry.resolve(appKey)
    if (!secret)
      throw new Error('AppKey 无效或应用不可用')

    // 委托标准方案验签（同步抛错经 async 包装为 rejected promise，签名头三件套 / 签名串构造 / 比对逻辑与底座完全一致）
    this.standardScheme.verify({ ...ctx, secret })
  }
}
