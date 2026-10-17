import { describe, expect, it, jest } from '@jest/globals'
import type { ExecutionContext } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'

import { REQUEST_MEMBER_KEY } from './current-member.decorator'
import { MemberAuthGuard } from './member-auth.guard'
import { MemberAuthService } from './member-auth.service'
import { MemberTokenService } from './member-token.service'
import { MemberErrorCode } from '../error-codes'

const MEMBER_ID = '00000000-0000-0000-0000-0000000000bb'

function makeContext(headers: Record<string, unknown>) {
  const request: Record<string, unknown> = { headers }
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => class Demo {},
    } as unknown as ExecutionContext,
  }
}

function makeGuard(options: { payload?: { sub: string, appKey: string } | 'throw', member?: object | null }) {
  const tokenService = {
    verifyAccessToken: jest.fn(() =>
      options.payload === 'throw'
        ? Promise.reject(new Error('jwt expired'))
        : Promise.resolve(options.payload)),
  }
  const authService = {
    getActiveMemberById: jest.fn(() => Promise.resolve(options.member ?? null)),
  }
  // ModuleRef 桩：按请求的 token 分发到对应服务桩（还原 guard 的 strict:false 懒解析）
  const moduleRef: ModuleRef = {
    get: (token: unknown) =>
      token === MemberTokenService ? tokenService : token === MemberAuthService ? authService : undefined,
  } as unknown as ModuleRef
  const guard = new MemberAuthGuard(moduleRef)
  return { guard, tokenService, authService, moduleRef }
}

const validPayload = { sub: MEMBER_ID, appKey: 'ah_app000000000001' }
const activeMember = { id: MEMBER_ID, status: 'active' }

describe('MemberAuthGuard', () => {
  it('缺少 Bearer 头应抛 0043005（401）', async () => {
    const { guard } = makeGuard({ payload: validPayload, member: activeMember })
    const { context } = makeContext({ 'x-app-key': 'ah_app000000000001' })
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: MemberErrorCode.ACCESS_TOKEN_INVALID.code,
      status: 401,
    })
  })

  it('验签失败（过期 / 伪造 / 跨域令牌）应统一抛 0043005，不区分原因', async () => {
    const { guard } = makeGuard({ payload: 'throw', member: activeMember })
    const { context } = makeContext({ authorization: 'Bearer bad-token', 'x-app-key': 'ah_app000000000001' })
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: MemberErrorCode.ACCESS_TOKEN_INVALID.code,
    })
  })

  it('令牌 appKey 声明与请求 AppKey 头不一致应抛 0043004（D19 域绑定）', async () => {
    const { guard } = makeGuard({ payload: validPayload, member: activeMember })
    const { context } = makeContext({ authorization: 'Bearer ok', 'x-app-key': 'ah_other000000001' })
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: MemberErrorCode.TOKEN_APP_MISMATCH.code,
    })
  })

  it('缺少 AppKey 头同样按域不匹配拒绝（空值不可绑定）', async () => {
    const { guard } = makeGuard({ payload: validPayload, member: activeMember })
    const { context } = makeContext({ authorization: 'Bearer ok' })
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: MemberErrorCode.TOKEN_APP_MISMATCH.code,
    })
  })

  it('会员禁用 / 软删（查库不可见）应抛 0043005（即时失效语义）', async () => {
    const { guard } = makeGuard({ payload: validPayload, member: null })
    const { context } = makeContext({ authorization: 'Bearer ok', 'x-app-key': 'ah_app000000000001' })
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: MemberErrorCode.ACCESS_TOKEN_INVALID.code,
    })
  })

  it('校验通过应放行并在请求上挂载会员身份（id + appKey）', async () => {
    const { guard } = makeGuard({ payload: validPayload, member: activeMember })
    const { context, request } = makeContext({ authorization: 'Bearer ok', 'x-app-key': 'ah_app000000000001' })
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(request[REQUEST_MEMBER_KEY]).toEqual({ id: MEMBER_ID, appKey: 'ah_app000000000001' })
  })
})
