import { describe, expect, it, jest } from '@jest/globals'
import { Logger } from '@nestjs/common'

import { AliyunSmsSender, isSmsConfigured } from './aliyun-sms.sender'
import { LogCodeSender } from './log-code.sender'
import { isMailConfigured } from './smtp-mail.sender'

const SMS_CONFIG = {
  accessKeyId: 'ak-test',
  accessKeySecret: 'sk-test',
  signName: 'apphub测试签名',
  templateCode: 'SMS_000000001',
}

/** 以覆写私有 client 的方式隔离 SDK 网络调用 */
function makeSmsSender(sendSms: jest.Mock): AliyunSmsSender {
  const sender = new AliyunSmsSender(SMS_CONFIG)
  Object.defineProperty(sender, 'client', { value: { sendSms } })
  return sender
}

describe('AliyunSmsSender 阿里云短信通道', () => {
  it('响应 body.code 为 OK 应视为成功', async () => {
    const sendSms = jest.fn(() => Promise.resolve({ body: { code: 'OK' } }))
    await expect(makeSmsSender(sendSms).send('13800138000', '123456')).resolves.toBeUndefined()
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumbers: '13800138000',
      signName: SMS_CONFIG.signName,
      templateCode: SMS_CONFIG.templateCode,
    }))
  })

  it('响应 body.code 非 OK 应抛错（阿里云业务失败不抛 HTTP 异常，契约守护点）', async () => {
    const sendSms = jest.fn(() => Promise.resolve<{ body: { code?: string, message?: string } }>({ body: { code: 'OK' } }))
    sendSms.mockResolvedValueOnce({ body: { code: 'isv.BUSINESS_LIMIT_CONTROL', message: '触发分钟级流控' } })
    await expect(makeSmsSender(sendSms).send('13800138000', '123456')).rejects.toThrow('isv.BUSINESS_LIMIT_CONTROL')
  })

  it('SDK 抛网络异常应向上传播（由验证码域统一转 0042010）', async () => {
    const sendSms = jest.fn(() => Promise.resolve<{ body: { code?: string, message?: string } }>({ body: { code: 'OK' } }))
    sendSms.mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
    await expect(makeSmsSender(sendSms).send('13800138000', '123456')).rejects.toThrow('ETIMEDOUT')
  })

  it('isSmsConfigured：四项任一缺失即未配置', () => {
    expect(isSmsConfigured(SMS_CONFIG)).toBe(true)
    expect(isSmsConfigured({ ...SMS_CONFIG, templateCode: '' })).toBe(false)
    expect(isSmsConfigured({ ...SMS_CONFIG, accessKeyId: undefined as unknown as string })).toBe(false)
  })
})

describe('SmtpMailSender 邮件通道', () => {
  it('isMailConfigured：五项任一缺失即未配置', () => {
    const config = { host: 'smtp.example.com', port: 465, user: 'noreply@example.com', password: 'pass', from: '"apphub" <noreply@example.com>' }
    expect(isMailConfigured(config)).toBe(true)
    expect(isMailConfigured({ ...config, host: '' })).toBe(false)
    expect(isMailConfigured({ ...config, from: '' })).toBe(false)
  })
})

describe('LogCodeSender log 降级通道', () => {
  it('发送即日志且恒成功（标识打码不留全量）', async () => {
    const log = jest.fn()
    const sender = new LogCodeSender({ log } as unknown as Logger, 'sms')
    await expect(sender.send('13800138000', '123456')).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('138****8000'))
    expect(log).toHaveBeenCalledWith(expect.not.stringContaining('13800138000'))
  })

  it('邮箱标识同样打码', async () => {
    const log = jest.fn()
    const sender = new LogCodeSender({ log } as unknown as Logger, 'mail')
    await sender.send('someone@example.com', '654321')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('s***@example.com'))
  })
})
