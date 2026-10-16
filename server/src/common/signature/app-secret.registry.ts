/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 应用密钥源注册表：业务模块注入「按 AppKey 解析开放 API 签名密钥」的来源，供 app 签名方案验签（D15/D17，主张 I2）
 */
import { Injectable } from '@nestjs/common'

/**
 * 应用密钥解析器：按 AppKey 返回开放 API 签名密钥（AppSecret），返回 null 表示应用不存在或已停用。
 * 由业务模块（appcenter）在启动期注入，common 不反向依赖业务模块（与限流策略注册同构）。
 */
export type AppSecretResolver = (appKey: string) => Promise<string | null>

@Injectable()
export class AppSecretRegistry {
  private resolver: AppSecretResolver | null = null

  /** 注册密钥解析器：仅允许注册一次（重复注册即装配错误，启动期暴露） */
  registerResolver(resolver: AppSecretResolver): void {
    if (this.resolver)
      throw new Error('应用密钥解析器已注册，不允许重复注册')
    this.resolver = resolver
  }

  /** 解析签名密钥：未注册解析器或应用无效时返回 null（方案按验签失败拒绝） */
  async resolve(appKey: string): Promise<string | null> {
    return this.resolver ? this.resolver(appKey) : null
  }
}
