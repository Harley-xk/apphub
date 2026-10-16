/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 终端令牌在线校验开放 API（D7）：应用持终端用户 access token 换取身份与订阅状态；
 * GET 参与签名（@UseSignature 显式标注全方法验签，主张 I1），叠加 MemberAuthGuard
 */
import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { CurrentMember, type AuthMember } from './current-member.decorator'
import type { IntrospectVo } from './dto/open-member.dto'
import { MemberAuthGuard } from './member-auth.guard'
import { MemberAuthService } from './member-auth.service'
import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator'
import { UseSignature } from '../../../common/signature/decorators/use-signature.decorator'
import { APP_SCHEME_NAME } from '../../../common/signature/schemes/app-signature.scheme'

@ApiTags('开放接口-终端认证')
@Public()
@UseSignature(APP_SCHEME_NAME)
@RateLimit({ appKeyFrom: 'header' })
@UseGuards(MemberAuthGuard)
@Controller('open/member/token')
export class OpenMemberTokenController {
  constructor(private readonly authService: MemberAuthService) {}

  @ApiOperation({ summary: '令牌在线校验（会员身份 + 订阅状态）' })
  @Get('introspect')
  async introspect(@CurrentMember() member: AuthMember): Promise<IntrospectVo> {
    return this.authService.introspect(member.id, member.appKey)
  }
}
