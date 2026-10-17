/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 阿里云短信通道（C2）：单通用模板发送验证码（C8），通道失败抛错由验证码域统一转 004002010
 */
import Dysmsapi, { SendSmsRequest } from '@alicloud/dysmsapi20170525'
import { $OpenApiUtil } from '@alicloud/openapi-core'

import type { CodeSender } from './code-sender'
import { VERIFY_CODE_TTL_MS } from '../../member.constants'

/** 短信通道配置（configuration.ts sms 段） */
export interface SmsChannelConfig {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
}

/** 四项齐备视为短信通道已配置（认证方式扩展设计 §3.2 装配条件） */
export function isSmsConfigured(config: SmsChannelConfig): boolean {
  return Boolean(config.accessKeyId && config.accessKeySecret && config.signName && config.templateCode)
}

/** 阿里云短信通道：dysmsapi V2 SDK，同步调用 10s 超时（认证方式扩展设计 §4.5） */
export class AliyunSmsSender implements CodeSender {
  private readonly client: Dysmsapi
  private readonly signName: string
  private readonly templateCode: string

  constructor(config: SmsChannelConfig) {
    const openApiConfig = new $OpenApiUtil.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    })
    openApiConfig.endpoint = 'dysmsapi.aliyuncs.com'
    openApiConfig.connectTimeout = 10_000
    openApiConfig.readTimeout = 10_000
    this.client = new Dysmsapi(openApiConfig)
    this.signName = config.signName
    this.templateCode = config.templateCode
  }

  async send(identifier: string, code: string): Promise<void> {
    const request = new SendSmsRequest({
      phoneNumbers: identifier,
      signName: this.signName,
      templateCode: this.templateCode,
      // 单通用模板两变量：code + 有效期分钟数（C8）
      templateParam: JSON.stringify({ code, minutes: Math.floor(VERIFY_CODE_TTL_MS / 60_000) }),
    })
    const response = await this.client.sendSms(request)
    // 阿里云业务失败不抛 HTTP 异常，以 body.code 区分（OK 之外一律视为发送失败）
    if (response.body?.code !== 'OK') {
      throw new Error(`阿里云短信发送失败：${response.body?.code ?? 'NO_RESPONSE'} ${response.body?.message ?? ''}`)
    }
  }
}
