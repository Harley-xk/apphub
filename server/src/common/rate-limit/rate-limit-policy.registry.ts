/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 限流策略注册表：业务模块注入「按 AppKey 解析调用方类型」的策略源，供 Guard 对公开客户端收紧阈值
 */
import { Injectable } from '@nestjs/common'

/** 调用方策略信息（appcenter 注入的实现查 app 表返回 client_type） */
export interface RateLimitPolicy {
  /** 调用方类型：confidential（机密客户端）/ public（公开客户端，限流阈值减半） */
  clientType: string
}

/**
 * 策略解析器：按 AppKey 返回调用方策略，返回 null 表示应用不存在（按默认阈值处理）。
 * 由业务模块（appcenter）在启动期注入，common 不反向依赖业务模块。
 */
export type RateLimitPolicyResolver = (appKey: string) => Promise<RateLimitPolicy | null>

@Injectable()
export class RateLimitPolicyRegistry {
  private resolver: RateLimitPolicyResolver | null = null

  /** 注册策略解析器：仅允许注册一次（重复注册即装配错误，启动期暴露） */
  registerResolver(resolver: RateLimitPolicyResolver): void {
    if (this.resolver)
      throw new Error('限流策略解析器已注册，不允许重复注册')
    this.resolver = resolver
  }

  /** 解析调用方策略：未注册解析器或应用不存在时返回 null（按默认阈值处理） */
  async resolve(appKey: string): Promise<RateLimitPolicy | null> {
    return this.resolver ? this.resolver(appKey) : null
  }
}
