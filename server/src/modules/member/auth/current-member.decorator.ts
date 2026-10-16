/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 当前会员参数装饰器：MemberAuthGuard 校验通过后挂到请求上的终端用户身份（开放 API 用户态接口专用）
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

/** 请求上挂载会员身份的键（Guard 写入，装饰器读取——同 system 域 REQUEST_USER_KEY 契约形态） */
export const REQUEST_MEMBER_KEY = 'member:current'

/** 会员身份（令牌校验通过后可用的最小信息集） */
export interface AuthMember {
  id: string
  /** 令牌绑定的应用 AppKey（D19） */
  appKey: string
}

/** 取当前会员（用户态接口处理器参数用）；未经过 MemberAuthGuard 的接口取值为 undefined */
export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthMember | undefined => {
    const request = context.switchToHttp().getRequest<Request & Record<string, unknown>>()
    return request[REQUEST_MEMBER_KEY] as AuthMember | undefined
  },
)
