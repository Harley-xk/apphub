/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 限流注解：开放 API 按 AppKey + IP 滑动窗口限流的挂载点（详见 docs/应用管理平台/统一认证设计.md §3.3）
 */
import { SetMetadata } from '@nestjs/common'

/** 限流元数据键（Guard 读取，方法级优先于控制器级） */
export const RATE_LIMIT_METADATA = 'common:rate-limit'

/** 限流选项 */
export interface RateLimitOptions {
  /**
   * AppKey 来源：
   * - header：取 X-App-Key 请求头（自研协议开放 API）
   * - path：取 URL 路径参数 appKey（框架内建更新器适配端点，D24——内建更新器无法携带自定义头）
   */
  appKeyFrom: 'header' | 'path'
  /**
   * 设备维度来源（可选）：'header' 时限流键改为 `${appKey}:${X-Device-Id}`，
   * 不再叠加 IP——NAT 后大量设备共享出口 IP 会互相挤占（应用活跃度统计设计 AT13）。
   * 未携带 X-Device-Id 时以 `unknown` 占位（仍受限）。
   */
  deviceFrom?: 'header'
  /**
   * 显式阈值（次/窗口）：设置后不受公开客户端阈值减半影响——
   * 设备维度阈值按设备规划（如活跃上报 120 次/分钟/设备），与调用方类型无关。
   */
  limit?: number
}

/**
 * 挂载限流：控制器级（整控制器生效）或方法级（单个接口生效，优先于控制器级）。
 * 未挂载的接口（管理端全部、开放 API 之外的接口）零开销放行。
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_METADATA, options)
