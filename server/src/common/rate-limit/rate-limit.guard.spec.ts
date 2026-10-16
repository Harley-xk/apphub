import { describe, expect, it } from '@jest/globals'
import { HttpException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'

import { RateLimitPolicyRegistry } from './rate-limit-policy.registry'
import { RateLimit } from './rate-limit.decorator'
import { RateLimitGuard } from './rate-limit.guard'
import { InMemorySlidingWindowCounter } from './sliding-window-counter'

/** 测试用控制器：模拟开放 API 的两种 AppKey 来源与未挂载接口（方法不被调用，仅承载装饰器元数据） */
class TestController {
  @RateLimit({ appKeyFrom: 'header' })
  headerHandler(): boolean {
    return true
  }

  @RateLimit({ appKeyFrom: 'path' })
  pathHandler(): boolean {
    return true
  }

  plainHandler(): boolean {
    return true
  }
}

interface StubRequest {
  headers: Record<string, unknown>
  params?: Record<string, unknown>
  socket?: { remoteAddress: string }
}

function makeContext(handlerKey: keyof TestController, request: StubRequest) {
  // 仅取方法引用供 Reflector 读元数据，不会以分离 this 调用
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const handler = TestController.prototype[handlerKey]
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  }
}

function makeGuard(options: { limit?: number, resolver?: (appKey: string) => Promise<{ clientType: string } | null> } = {}) {
  const policyRegistry = new RateLimitPolicyRegistry()
  if (options.resolver)
    policyRegistry.registerResolver(options.resolver)
  const guard = new RateLimitGuard(
    new Reflector(),
    policyRegistry,
    { get: (key: string) => (key === 'rateLimit.limit' ? (options.limit ?? 3) : 60_000) } as ConfigService,
    new InMemorySlidingWindowCounter(),
  )
  return { guard }
}

const IP_REQUEST: StubRequest = {
  headers: { 'x-app-key': 'ah_demo' },
  socket: { remoteAddress: '1.2.3.4' },
}

describe('RateLimitGuard', () => {
  it('未挂载 @RateLimit 的接口应零开销放行且不消耗计数', async () => {
    const { guard } = makeGuard()
    await expect(guard.canActivate(makeContext('plainHandler', IP_REQUEST) as never)).resolves.toBe(true)
    // 同 IP 换到挂载接口：计数不受上面放行请求影响
    const limited = makeGuard()
    for (let i = 0; i < 3; i++)
      await limited.guard.canActivate(makeContext('headerHandler', IP_REQUEST) as never)
    await expect(limited.guard.canActivate(makeContext('headerHandler', IP_REQUEST) as never)).rejects.toMatchObject({
      status: 429,
    })
  })

  it('窗口内超出阈值应抛 429 HttpException', async () => {
    const { guard } = makeGuard({ limit: 3 })
    for (let i = 0; i < 3; i++)
      await expect(guard.canActivate(makeContext('headerHandler', IP_REQUEST) as never)).resolves.toBe(true)

    const rejection = guard.canActivate(makeContext('headerHandler', IP_REQUEST) as never)
    await expect(rejection).rejects.toBeInstanceOf(HttpException)
    await expect(rejection).rejects.toMatchObject({
      status: 429,
      message: '请求过于频繁，请稍后再试',
    })
  })

  it('AppKey 应取自路径参数（框架适配端点形态）', async () => {
    const { guard } = makeGuard({ limit: 1 })
    const request: StubRequest = { headers: {}, params: { appKey: 'ah_path' }, socket: { remoteAddress: '1.2.3.4' } }
    await expect(guard.canActivate(makeContext('pathHandler', request) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('pathHandler', request) as never)).rejects.toMatchObject({ status: 429 })
  })

  it('不同 AppKey / IP 组合应独立计数', async () => {
    const { guard } = makeGuard({ limit: 1 })
    const first: StubRequest = { headers: { 'x-app-key': 'ah_a' }, socket: { remoteAddress: '1.1.1.1' } }
    const second: StubRequest = { headers: { 'x-app-key': 'ah_b' }, socket: { remoteAddress: '2.2.2.2' } }
    await expect(guard.canActivate(makeContext('headerHandler', first) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('headerHandler', second) as never)).resolves.toBe(true)
  })

  it('未携带 AppKey 的请求仍应受限流保护（unknown 占位）', async () => {
    const { guard } = makeGuard({ limit: 2 })
    const request: StubRequest = { headers: {}, socket: { remoteAddress: '3.3.3.3' } }
    await expect(guard.canActivate(makeContext('headerHandler', request) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('headerHandler', request) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('headerHandler', request) as never)).rejects.toMatchObject({ status: 429 })
  })

  it('公开客户端阈值应减半（向上取整）', async () => {
    const { guard } = makeGuard({
      limit: 3,
      resolver: appKey => Promise.resolve(appKey === 'ah_public' ? { clientType: 'public' } : null),
    })
    const request: StubRequest = { headers: { 'x-app-key': 'ah_public' }, socket: { remoteAddress: '4.4.4.4' } }
    // ceil(3 / 2) = 2：前 2 次放行，第 3 次拒绝
    await expect(guard.canActivate(makeContext('headerHandler', request) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('headerHandler', request) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('headerHandler', request) as never)).rejects.toMatchObject({ status: 429 })
  })

  it('应用不存在（解析器返回 null）应按默认阈值处理', async () => {
    const { guard } = makeGuard({ limit: 2, resolver: () => Promise.resolve(null) })
    const request: StubRequest = { headers: { 'x-app-key': 'ah_ghost' }, socket: { remoteAddress: '5.5.5.5' } }
    for (let i = 0; i < 2; i++)
      await expect(guard.canActivate(makeContext('headerHandler', request) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('headerHandler', request) as never)).rejects.toMatchObject({ status: 429 })
  })

  it('未注册策略解析器时应按默认阈值处理', async () => {
    const { guard } = makeGuard({ limit: 1 })
    await expect(guard.canActivate(makeContext('headerHandler', IP_REQUEST) as never)).resolves.toBe(true)
    await expect(guard.canActivate(makeContext('headerHandler', IP_REQUEST) as never)).rejects.toMatchObject({ status: 429 })
  })
})
