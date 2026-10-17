import { describe, expect, it, jest } from '@jest/globals'

import { CaptchaService } from './captcha.service'
import { MemberErrorCode } from '../error-codes'

/** 可推进时钟的测试替身：覆写 readTime 控制「现在」 */
class TestableCaptchaService extends CaptchaService {
  now = 1_700_000_000_000

  protected override readTime(): number {
    return this.now
  }
}

function makeService() {
  const smsSend = jest.fn(() => Promise.resolve())
  const mailSend = jest.fn(() => Promise.resolve())
  const service = new TestableCaptchaService({ send: smsSend }, { send: mailSend })
  return { service, smsSend, mailSend }
}

/** 从发送桩捕获最近一次验证码 */
function lastCode(send: jest.Mock<(identifier: string, code: string) => Promise<void>>): string {
  return send.mock.calls[send.mock.calls.length - 1][1]
}

describe('CaptchaService 验证码域', () => {
  it('发送成功应落存并可通过 verify 校验后即作废（单次成功作废）', async () => {
    const { service, smsSend } = makeService()
    await service.send('phone', '13800138000')
    expect(smsSend).toHaveBeenCalledWith('13800138000', expect.stringMatching(/^\d{6}$/))

    const code = lastCode(smsSend)
    expect(service.verify('phone', '13800138000', code)).toBe(true)
    // 单次作废：同一码二连校验失败
    expect(service.verify('phone', '13800138000', code)).toBe(false)
  })

  it('校验失败一次即作废（C6 单次作废——正确码在错误尝试后也不可用）', async () => {
    const { service, smsSend } = makeService()
    await service.send('phone', '13800138000')
    const code = lastCode(smsSend)
    expect(service.verify('phone', '13800138000', '000000')).toBe(false)
    expect(service.verify('phone', '13800138000', code)).toBe(false)
  })

  it('60 秒重发间隔内应拒绝（0042008），间隔外放行（以最近一次成功发送计时）', async () => {
    const { service } = makeService()
    await service.send('email', 'a@b.com')
    service.now += 30 * 1000
    await expect(service.send('email', 'a@b.com')).rejects.toMatchObject({
      code: MemberErrorCode.VERIFY_CODE_TOO_FREQUENT.code,
    })
    service.now += 31 * 1000
    await expect(service.send('email', 'a@b.com')).resolves.toBeUndefined()
  })

  it('验证码作废后重发间隔仍生效（sentAt 独立于验证码条目，防错码后立即重发绕过频控）', async () => {
    const { service, smsSend } = makeService()
    await service.send('phone', '13800138000')
    service.verify('phone', '13800138000', lastCode(smsSend)) // 消费作废
    await expect(service.send('phone', '13800138000')).rejects.toMatchObject({
      code: MemberErrorCode.VERIFY_CODE_TOO_FREQUENT.code,
    })
  })

  it('自然日限额第 11 条应拒绝（0042009），不同 identifier 互不影响（C10 全局维度）', async () => {
    const { service } = makeService()
    // 一个手机号当日连发 10 条（每次推过间隔窗口）
    for (let i = 0; i < 10; i++) {
      service.now += 61 * 1000
      await expect(service.send('phone', '13900139000')).resolves.toBeUndefined()
    }
    service.now += 61 * 1000
    await expect(service.send('phone', '13900139000')).rejects.toMatchObject({
      code: MemberErrorCode.VERIFY_CODE_DAILY_LIMIT.code,
    })
    // 不同 identifier 独立计数
    await expect(service.send('phone', '13700137000')).resolves.toBeUndefined()
  })

  it('跨自然日计数归零', async () => {
    const { service } = makeService()
    for (let i = 0; i < 10; i++) {
      service.now += 61 * 1000
      await service.send('email', 'c@d.com')
    }
    service.now += 61 * 1000
    await expect(service.send('email', 'c@d.com')).rejects.toMatchObject({
      code: MemberErrorCode.VERIFY_CODE_DAILY_LIMIT.code,
    })
    // 推进 25 小时：跨日 + 间隔窗口
    service.now += 25 * 60 * 60 * 1000
    await expect(service.send('email', 'c@d.com')).resolves.toBeUndefined()
  })

  it('通道发送失败应抛 0042010 且不落存不计次（失败不占间隔与额度，C9）', async () => {
    const { service, smsSend } = makeService()
    smsSend.mockRejectedValueOnce(new Error('SMTP 不可达'))
    await expect(service.send('phone', '13800138000')).rejects.toMatchObject({
      code: MemberErrorCode.VERIFY_CODE_SEND_FAILED.code,
    })
    // 失败后立即可重发（间隔未占用）
    smsSend.mockImplementationOnce(() => Promise.resolve())
    await expect(service.send('phone', '13800138000')).resolves.toBeUndefined()
  })

  it('验证码过期后校验应失败（5 分钟有效期）', async () => {
    const { service, smsSend } = makeService()
    await service.send('phone', '13800138000')
    const code = lastCode(smsSend)
    service.now += 5 * 60 * 1000 + 1
    expect(service.verify('phone', '13800138000', code)).toBe(false)
  })

  it('phone 走短信通道、email 走邮件通道（装配分流）', async () => {
    const { service, smsSend, mailSend } = makeService()
    await service.send('phone', '13800138000')
    await service.send('email', 'a@b.com')
    expect(smsSend).toHaveBeenCalledTimes(1)
    expect(mailSend).toHaveBeenCalledTimes(1)
  })
})
