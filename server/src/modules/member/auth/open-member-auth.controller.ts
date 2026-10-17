/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 终端认证开放 API：注册 / 登录 / 刷新 / 登出 / 绑定（统一认证设计 §3.1/§3.2）。
 * 应用级 HMAC 签名（app 方案按 X-App-Key 查 AppSecret）+ AppKey+IP 限流；用户态接口叠加 MemberAuthGuard
 */
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentMember, type AuthMember } from './current-member.decorator'
import {
  BindCredentialDto,
  BindResultVo,
  LogoutMemberDto,
  LoginMemberDto,
  RefreshTokenDto,
  RegisterMemberDto,
  SendCodeDto,
} from './dto/open-member.dto'
import { MemberAuthGuard } from './member-auth.guard'
import { MemberAuthService } from './member-auth.service'
import type { TokenPairVo } from './member-token.service'
import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator'
import { UseSignature } from '../../../common/signature/decorators/use-signature.decorator'
import { APP_SCHEME_NAME } from '../../../common/signature/schemes/app-signature.scheme'
import { getClientInfo } from '../../../common/utils/client-info'

/** 从请求头取 AppKey（与签名方案 / 限流守卫同一出处，主张 I8） */
function readAppKey(request: Request): string {
  const header = request.headers['x-app-key']
  const value = Array.isArray(header) ? header[0] : header
  return typeof value === 'string' && value !== '' ? value : ''
}

@ApiTags('开放接口-终端认证')
@Public()
@UseSignature(APP_SCHEME_NAME)
@RateLimit({ appKeyFrom: 'header' })
@Controller('open/member/auth')
export class OpenMemberAuthController {
  constructor(private readonly authService: MemberAuthService) {}

  @ApiOperation({ summary: '注册（注册即登录，返回令牌对；五类型凭证，验证码类型须先发码）' })
  @Post('register')
  async register(@Body() dto: RegisterMemberDto, @Req() request: Request): Promise<TokenPairVo> {
    return this.authService.register(dto, readAppKey(request), getClientInfo(request))
  }

  @ApiOperation({ summary: '登录（密码 / 验证码 / 扫码按类型；验证码与扫码查无凭证自动注册）' })
  @Post('login')
  async login(@Body() dto: LoginMemberDto, @Req() request: Request): Promise<TokenPairVo> {
    return this.authService.login(dto, readAppKey(request), getClientInfo(request))
  }

  @ApiOperation({ summary: '发送验证码（手机 / 邮箱；60s 重发间隔、单 identifier 日限 10 条）' })
  @Post('code/send')
  async sendCode(@Body() dto: SendCodeDto, @Req() request: Request): Promise<void> {
    await this.authService.sendCode(dto, readAppKey(request), getClientInfo(request))
  }

  @ApiOperation({ summary: '刷新令牌（轮换：旧 refresh 吊销 + 新令牌对）' })
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request): Promise<TokenPairVo> {
    return this.authService.refresh(dto.refreshToken, readAppKey(request), getClientInfo(request))
  }

  @ApiOperation({ summary: '登出（吊销 body 携带的 refresh，幂等）' })
  @UseGuards(MemberAuthGuard)
  @Post('logout')
  async logout(
    @CurrentMember() member: AuthMember,
    @Body() dto: LogoutMemberDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.authService.logout(member.id, dto.refreshToken, member.appKey, getClientInfo(request))
  }

  @ApiOperation({ summary: '绑定新凭证（绑定合并：追加 / 幂等 / 拒绝三分支）' })
  @UseGuards(MemberAuthGuard)
  @Post('bind')
  async bind(@CurrentMember() member: AuthMember, @Body() dto: BindCredentialDto): Promise<BindResultVo> {
    return this.authService.bind(member.id, dto)
  }
}
