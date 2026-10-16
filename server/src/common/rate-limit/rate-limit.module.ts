/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 限流全局模块：提供滑动窗口计数器与策略注册表，Guard 经 AppModule 的 APP_GUARD 注册
 */
import { Global, Module } from '@nestjs/common'

import { RateLimitPolicyRegistry } from './rate-limit-policy.registry'
import { InMemorySlidingWindowCounter, RATE_LIMIT_COUNTER } from './sliding-window-counter'

@Global()
@Module({
  providers: [
    // 内存计数实现：单实例部署适用，多实例部署经该 token 替换为集中式实现（如 Redis）
    { provide: RATE_LIMIT_COUNTER, useClass: InMemorySlidingWindowCounter },
    RateLimitPolicyRegistry,
  ],
  exports: [RATE_LIMIT_COUNTER, RateLimitPolicyRegistry],
})
export class RateLimitModule {}
