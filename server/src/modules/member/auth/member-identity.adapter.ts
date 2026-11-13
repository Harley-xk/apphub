/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 会员身份端口实现：为 analytics 活跃上报提供可选会员态校验（验签失败 / 过期一律返回 null，不抛错）
 */
import { Injectable } from '@nestjs/common'

import { MemberTokenService } from './member-token.service'
import type { MemberIdentity, MemberIdentityPort } from '../../analytics/ports/member-identity.port'

@Injectable()
export class MemberIdentityAdapter implements MemberIdentityPort {
  constructor(private readonly tokenService: MemberTokenService) {}

  /** 校验 access token：无效 / 过期 / 声明缺失返回 null（上报不因 token 问题失败，AT8） */
  async verifyAccessToken(token: string): Promise<MemberIdentity | null> {
    try {
      const payload = await this.tokenService.verifyAccessToken(token)
      return { memberId: payload.sub, appKey: payload.appKey }
    }
    catch {
      return null
    }
  }
}
