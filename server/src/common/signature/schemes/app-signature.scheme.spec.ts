import { describe, expect, it, jest } from '@jest/globals'
import type { Request } from 'express'

import { AppSecretRegistry } from '../app-secret.registry'
import { AppSignatureScheme } from './app-signature.scheme'
import { StandardSignatureScheme } from './standard-signature.scheme'
import type { SignatureContext } from '../interfaces/signature-scheme.interface'

/** 构造携带头信息的最小请求 */
function makeRequest(headers: Record<string, unknown>): Request {
  return { headers, method: 'POST', path: '/api/open/member/auth/login' } as unknown as Request
}

function makeContext(headers: Record<string, unknown>): SignatureContext {
  return {
    request: makeRequest(headers),
    rawBody: Buffer.from('{}', 'utf8'),
    secret: 'global-secret',
    expireMs: 300_000,
  }
}

function makeScheme(options: { resolved?: string | null }) {
  const registry = new AppSecretRegistry()
  registry.registerResolver(() => Promise.resolve(options.resolved ?? null))
  const standardVerify = jest.fn()
  const standard = { verify: standardVerify } as unknown as StandardSignatureScheme
  const scheme = new AppSignatureScheme(registry, standard)
  return { scheme, standardVerify }
}

describe('AppSignatureScheme', () => {
  it('缺少 X-App-Key 头应拒绝（统一失败原因不透出）', async () => {
    const { scheme } = makeScheme({ resolved: 'app-secret' })
    await expect(scheme.verify(makeContext({}))).rejects.toThrow('缺少 AppKey 头')
  })

  it('AppKey 查无应用 / 已停用应拒绝（解析器返回 null）', async () => {
    const { scheme } = makeScheme({ resolved: null })
    await expect(scheme.verify(makeContext({ 'x-app-key': 'ah_unknown' }))).rejects.toThrow('AppKey 无效')
  })

  it('解析成功应以应用密钥委托标准方案验签（全局密钥不得代入）', async () => {
    const { scheme, standardVerify } = makeScheme({ resolved: 'app-secret' })
    const ctx = makeContext({ 'x-app-key': 'ah_known00000001' })
    await scheme.verify(ctx)
    expect(standardVerify).toHaveBeenCalledTimes(1)
    const delegated = standardVerify.mock.calls[0][0] as SignatureContext
    expect(delegated.request).toBe(ctx.request)
    expect(delegated.secret).toBe('app-secret')
    expect(delegated.rawBody).toBe(ctx.rawBody)
  })

  it('同名头重复出现（数组形态）应取首个值', async () => {
    const { scheme, standardVerify } = makeScheme({ resolved: 'app-secret' })
    await scheme.verify(makeContext({ 'x-app-key': ['ah_first00000001', 'ah_second0000'] }))
    expect(standardVerify).toHaveBeenCalled()
  })

  it('标准方案验签失败应原样上抛（Guard 统一转 401）', async () => {
    const registry = new AppSecretRegistry()
    registry.registerResolver(() => Promise.resolve('app-secret'))
    // 与真实现形态一致：verify 为同步方法、验签失败直接 throw
    const standard = {
      verify: () => {
        throw new Error('签名不匹配')
      },
    } as unknown as StandardSignatureScheme
    const scheme = new AppSignatureScheme(registry, standard)
    await expect(scheme.verify(makeContext({ 'x-app-key': 'ah_known00000001' }))).rejects.toThrow('签名不匹配')
  })
})

describe('AppSecretRegistry', () => {
  it('未注册解析器时应返回 null（按验签失败处理，不误放行）', async () => {
    const registry = new AppSecretRegistry()
    await expect(registry.resolve('ah_any00000000001')).resolves.toBeNull()
  })

  it('重复注册应抛错（启动期暴露装配错误）', () => {
    const registry = new AppSecretRegistry()
    registry.registerResolver(() => Promise.resolve('first'))
    expect(() => registry.registerResolver(() => Promise.resolve('second'))).toThrow('已注册')
  })
})
