import { describe, expect, it } from '@jest/globals'

import { RateLimitPolicyRegistry } from './rate-limit-policy.registry'

describe('RateLimitPolicyRegistry', () => {
  it('未注册解析器时 resolve 应返回 null（按默认阈值处理）', async () => {
    const registry = new RateLimitPolicyRegistry()
    await expect(registry.resolve('ah_demo')).resolves.toBeNull()
  })

  it('注册后应透传解析器结果', async () => {
    const registry = new RateLimitPolicyRegistry()
    registry.registerResolver(appKey => Promise.resolve(appKey === 'ah_public' ? { clientType: 'public' } : null))
    await expect(registry.resolve('ah_public')).resolves.toEqual({ clientType: 'public' })
    await expect(registry.resolve('ah_missing')).resolves.toBeNull()
  })

  it('重复注册应抛错（装配错误启动期暴露）', () => {
    const registry = new RateLimitPolicyRegistry()
    registry.registerResolver(() => Promise.resolve(null))
    expect(() => registry.registerResolver(() => Promise.resolve(null))).toThrow('限流策略解析器已注册')
  })
})
