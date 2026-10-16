/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员访问令牌守卫：开放 API 用户态接口的 Bearer 校验——member JWT 验签（独立密钥域）→
 * 逐请求查库（禁用 / 删除即时失效，D18）→ 令牌 appKey 声明与请求 AppKey 一致性（D19，0043004）。
 * 以 @UseGuards 挂载于用户态接口（全局 Guard 链之后执行：签名 → system JWT(@Public 豁免) → 权限 → 本守卫）
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common'
import type { Request } from 'express'

import { businessError } from '../../../common/exceptions/business-error'
import { MemberErrorCode } from '../error-codes'
import { REQUEST_MEMBER_KEY, type AuthMember } from './current-member.decorator'
import { MemberAuthService } from './member-auth.service'
import { MemberTokenService, type MemberAccessPayload } from './member-token.service'

/** 从请求头取 AppKey（与签名方案 / 限流守卫同一出处，主张 I8） */
function readAppKey(request: Request): string | null {
  const header = request.headers['x-app-key']
  const value = Array.isArray(header) ? header[0] : header
  return typeof value === 'string' && value !== '' ? value : null
}

@Injectable()
export class MemberAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: MemberTokenService,
    private readonly authService: MemberAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & Record<string, unknown>>()

    // Bearer 解析（缺失 / 格式非法统一 0043005，不区分失败环节）
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      throw businessError(MemberErrorCode.ACCESS_TOKEN_INVALID.message, {
        status: 401,
        code: MemberErrorCode.ACCESS_TOKEN_INVALID,
      })
    }
    const token = header.slice('Bearer '.length).trim()
    if (!token) {
      throw businessError(MemberErrorCode.ACCESS_TOKEN_INVALID.message, {
        status: 401,
        code: MemberErrorCode.ACCESS_TOKEN_INVALID,
      })
    }

    // 验签（member 域独立密钥，system 域管理端令牌在此必然验签失败——两套信任域互不可串）；
    // 声明缺失（sub / appKey）在 verifyAccessToken 内抛错，同样落入统一 0043005
    let payload: MemberAccessPayload
    try {
      payload = await this.tokenService.verifyAccessToken(token)
    }
    catch {
      throw businessError(MemberErrorCode.ACCESS_TOKEN_INVALID.message, {
        status: 401,
        code: MemberErrorCode.ACCESS_TOKEN_INVALID,
      })
    }

    // 令牌绑定应用（D19）：appKey 声明与请求 AppKey 头一致（该头经签名方案验密钥源，非可伪造明文——主张 I1）
    const requestAppKey = readAppKey(request)
    if (!requestAppKey || requestAppKey !== payload.appKey) {
      throw businessError(MemberErrorCode.TOKEN_APP_MISMATCH.message, {
        status: 401,
        code: MemberErrorCode.TOKEN_APP_MISMATCH,
      })
    }

    // 逐请求查库：禁用 / 删除的已发令牌即时失效（禁用给出区分文案便于端侧引导）
    const member = await this.authService.getActiveMemberById(payload.sub)
    if (!member) {
      throw businessError(MemberErrorCode.ACCESS_TOKEN_INVALID.message, {
        status: 401,
        code: MemberErrorCode.ACCESS_TOKEN_INVALID,
      })
    }

    request[REQUEST_MEMBER_KEY] = { id: member.id, appKey: payload.appKey } satisfies AuthMember
    return true
  }
}
