/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 会员身份端口与注册表：analytics 只依赖抽象（可选会员态校验），由 member 模块启动期注册实现（设计 §4.4 / §7.2）
 */
import { Injectable, Module } from '@nestjs/common'

/** 会员身份解析结果：令牌有效返回会员与绑定应用，无效返回 null（不抛错） */
export interface MemberIdentity {
  memberId: string
  /** 令牌声明的绑定应用 AppKey（D19，调用方须与本次请求 AppKey 比对） */
  appKey: string
}

/**
 * 会员身份端口：analytics 定义的消费方端口，member 模块在 onModuleInit 注册实现。
 * 与 AppLookupPort 同款方向：消费方定义抽象，提供方启动期注册，避免 analytics ↔ member 静态依赖。
 */
export interface MemberIdentityPort {
  /** 校验会员 access token：有效返回身份，无效 / 过期 / 会员不可用一律返回 null */
  verifyAccessToken(token: string): Promise<MemberIdentity | null>
}

/** 端口注册表：member 在 onModuleInit 注册实现；analytics 侧懒取，未注册时按匿名处理 */
@Injectable()
export class MemberIdentityRegistry {
  private port: MemberIdentityPort | null = null

  /** 注册实现：仅允许注册一次（重复注册即装配错误，启动期暴露） */
  register(port: MemberIdentityPort): void {
    if (this.port)
      throw new Error('会员身份端口已注册，不允许重复注册')
    this.port = port
  }

  /** 取端口实现：未注册返回 null，由调用方按匿名处理 */
  get(): MemberIdentityPort | null {
    return this.port
  }
}

/** 端口模块：analytics 与 member 共同引用同一实例（Nest 按模块类去重，单例） */
@Module({
  providers: [MemberIdentityRegistry],
  exports: [MemberIdentityRegistry],
})
export class MemberIdentityPortsModule {}
