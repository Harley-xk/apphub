/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 限流守卫：@RateLimit 挂载的接口按 AppKey + IP 滑动窗口限流，公开客户端阈值减半（统一认证设计 §3.3）
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Inject, Injectable } from '@nestjs/common'
import { HttpException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { RateLimitPolicyRegistry } from './rate-limit-policy.registry'
import { RATE_LIMIT_METADATA } from './rate-limit.decorator'
import type { RateLimitOptions } from './rate-limit.decorator'
import { RATE_LIMIT_COUNTER } from './sliding-window-counter'
import type { SlidingWindowCounter } from './sliding-window-counter'
import { getClientIp } from '../utils/client-info'

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policyRegistry: RateLimitPolicyRegistry,
    private readonly configService: ConfigService,
    @Inject(RATE_LIMIT_COUNTER) private readonly counter: SlidingWindowCounter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 无 @RateLimit 标注的接口零开销放行（方法级优先于控制器级，与签名/权限守卫同读取模式）
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_METADATA, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!options)
      return true

    const request = context.switchToHttp().getRequest<Request>()
    const appKey = this.resolveAppKey(request, options)
    const ip = getClientIp(request) ?? 'unknown'
    const limit = this.configService.get<number>('rateLimit.limit') ?? 60
    const windowMs = this.configService.get<number>('rateLimit.windowMs') ?? 60_000
    const device = this.resolveDevice(request, options)

    // 公开客户端（Secret 编译进二进制，暴露风险高）阈值减半，向上取整且保底 1；
    // 显式阈值（设备维度策略）不参与减半——阈值按设备规划，与调用方类型无关
    let effectiveLimit = options.limit ?? limit
    if (options.limit === undefined && appKey !== null) {
      const policy = await this.policyRegistry.resolve(appKey)
      if (policy?.clientType === 'public')
        effectiveLimit = Math.max(1, Math.ceil(limit / 2))
    }

    // 设备维度：限流键改为 AppKey + 设备（未带设备头以 unknown 占位）；其余接口维持 AppKey + IP。
    // AppKey 缺失（未携带 / 路径无值）时以 unknown 占位——此类请求依然受限流保护
    const key = device !== null
      ? `${appKey ?? 'unknown'}:${device}`
      : `${appKey ?? 'unknown'}:${ip}`
    if (!this.counter.tryAcquire(key, effectiveLimit, windowMs))
      throw new HttpException('请求过于频繁，请稍后再试', 429)

    return true
  }

  /** 设备维度取值：未启用设备维度返回 null；启用但缺失时返回 unknown 占位（AT13） */
  private resolveDevice(request: Request, options: RateLimitOptions): string | null {
    if (options.deviceFrom !== 'header')
      return null
    const header = request.headers['x-device-id']
    const value = Array.isArray(header) ? header[0] : header
    return typeof value === 'string' && value !== '' ? value : 'unknown'
  }

  /** 按 AppKey 来源取值：头（自研协议）或路径参数（框架适配端点，D24） */
  private resolveAppKey(request: Request, options: RateLimitOptions): string | null {
    if (options.appKeyFrom === 'path') {
      const value = request.params?.appKey
      return typeof value === 'string' && value !== '' ? value : null
    }
    const header = request.headers['x-app-key']
    const value = Array.isArray(header) ? header[0] : header
    return typeof value === 'string' && value !== '' ? value : null
  }
}
