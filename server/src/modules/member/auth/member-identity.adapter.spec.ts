import { describe, expect, it } from '@jest/globals'

import { MemberIdentityAdapter } from './member-identity.adapter'
import type { MemberTokenService } from './member-token.service'

function createAdapter(verify: () => Promise<{ sub: string, appKey: string }>): MemberIdentityAdapter {
  return new MemberIdentityAdapter({ verifyAccessToken: verify } as unknown as MemberTokenService)
}

describe('MemberIdentityAdapter', () => {
  it('验签成功应返回会员 id 与声明 appKey', async () => {
    const adapter = createAdapter(() => Promise.resolve({ sub: 'member-1', appKey: 'ah_demo' }))
    await expect(adapter.verifyAccessToken('token')).resolves.toEqual({
      memberId: 'member-1',
      appKey: 'ah_demo',
    })
  })

  it('验签失败 / 过期应返回 null 而不抛错（上报按匿名处理）', async () => {
    const adapter = createAdapter(() => Promise.reject(new Error('jwt expired')))
    await expect(adapter.verifyAccessToken('token')).resolves.toBeNull()
  })
})
