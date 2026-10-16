import { describe, expect, it } from '@jest/globals'

import { generateAppKey, generateAppSecret } from './app-token.util'

describe('应用凭证生成', () => {
  it('AppKey 应为 ah_ 前缀 + 16 位小写字母数字', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateAppKey()).toMatch(/^ah_[a-z0-9]{16}$/)
    }
  })

  it('AppSecret 应为 32 位小写字母数字', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateAppSecret()).toMatch(/^[a-z0-9]{32}$/)
    }
  })

  it('连续生成不应重复（随机性冒烟）', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateAppKey()))
    const secrets = new Set(Array.from({ length: 100 }, () => generateAppSecret()))
    expect(keys.size).toBe(100)
    expect(secrets.size).toBe(100)
  })
})
