/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用调用凭证生成工具：AppKey（ah_ + 16 位随机小写字母数字）与 AppSecret（32 位随机串）
 */
import { randomBytes } from 'node:crypto'

const ALPHANUM_LOWER = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 拒绝采样生成指定长度的随机小写字母数字串（252 = 36 × 7，剔除高位字节避免模偏差） */
function randomFromCharset(length: number): string {
  let result = ''
  while (result.length < length) {
    const bytes = randomBytes(length * 2)
    for (const byte of bytes) {
      if (byte < 252 && result.length < length)
        result += ALPHANUM_LOWER[byte % ALPHANUM_LOWER.length] ?? ''
    }
  }
  return result
}

/** 生成应用标识：`ah_` + 16 位随机小写字母数字（展示与接口携带用，创建后不变） */
export function generateAppKey(): string {
  return `ah_${randomFromCharset(16)}`
}

/** 生成调用凭证：32 位随机串（明文存库，管理端列表掩码 + 点击按需查看；D22 重置即旧凭证失效） */
export function generateAppSecret(): string {
  return randomFromCharset(32)
}
