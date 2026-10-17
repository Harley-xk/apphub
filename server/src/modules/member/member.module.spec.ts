import { describe, expect, it, jest } from '@jest/globals'

import { MemberModule } from './member.module'
import { DEFAULT_MEMBER_JWT_SECRET } from '../../config/configuration'

/** 配置桩：按 key 返回预设值 */
function makeConfig(values: Record<string, string | number | undefined>) {
  return { get: jest.fn((key: string) => values[key]) }
}

const PRODUCTION_OK = {
  env: 'production',
  'member.jwtSecret': 'prod-secret-not-default',
  'sms.accessKeyId': 'ak',
  'sms.accessKeySecret': 'sk',
  'sms.signName': '签名',
  'sms.templateCode': 'SMS_001',
  'mail.host': 'smtp.example.com',
  'mail.port': 465,
  'mail.user': 'noreply',
  'mail.password': 'pass',
  'mail.from': 'noreply@example.com',
}

function makeModule(values: Record<string, string | number | undefined>) {
  const registry = { registerModule: jest.fn() }
  const module = new MemberModule(makeConfig(values) as never, registry as never)
  return { module, registry }
}

describe('MemberModule 启动校验（生产 fail-fast，C7 契约守护）', () => {
  it('非生产环境缺通道配置不应阻断启动（走 log 降级）', () => {
    const { module } = makeModule({ env: 'development' })
    expect(() => module.onModuleInit()).not.toThrow()
  })

  it('生产环境配置齐备应正常启动', () => {
    const { module, registry } = makeModule(PRODUCTION_OK)
    expect(() => module.onModuleInit()).not.toThrow()
    expect(registry.registerModule).toHaveBeenCalled()
  })

  it('生产环境短信通道任一项缺失应拒绝启动', () => {
    const { module } = makeModule({ ...PRODUCTION_OK, 'sms.templateCode': '' })
    expect(() => module.onModuleInit()).toThrow('短信通道配置缺失')
  })

  it('生产环境邮件通道任一项缺失应拒绝启动', () => {
    const { module } = makeModule({ ...PRODUCTION_OK, 'mail.host': '' })
    expect(() => module.onModuleInit()).toThrow('邮件通道配置缺失')
  })

  it('生产环境沿用开发默认 JWT 密钥应拒绝启动（M2 契约回归）', () => {
    const { module } = makeModule({ ...PRODUCTION_OK, 'member.jwtSecret': DEFAULT_MEMBER_JWT_SECRET })
    expect(() => module.onModuleInit()).toThrow('MEMBER_JWT_SECRET')
  })
})
