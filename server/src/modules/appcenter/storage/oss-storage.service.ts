/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: OSS 存储实现：STS 直传凭证签发（policy 收敛精确键 PutObject）/ HeadObject / 删除 / 签名下载 URL
 */
import { Logger } from '@nestjs/common'
import OSS from 'ali-oss'
import STS from 'ali-oss/lib/sts'

import { businessError } from '../../../common/exceptions/business-error'
import { AppcenterErrorCode } from '../error-codes'
import type { ObjectHead, StorageService, UploadCredentialVo } from './storage.service'

/** 签名下载 URL 默认时效：2h（自研协议 downloadUrl 与 D24 适配端点 manifest 同口径） */
const DEFAULT_SIGN_EXPIRES_SECONDS = 2 * 60 * 60

/** STS 凭证时效：1h（大文件分片续传中过期由前端 STS provider 自动刷新重取） */
const STS_DURATION_SECONDS = 3600

/**
 * Content-Disposition 取值：ASCII 兜底名 + RFC 5987 UTF-8 文件名。
 * 旧客户端读 filename，现代浏览器优先 filename*（中文 / 空格等原始文件名无损）。
 */
function buildContentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export interface OssStorageOptions {
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  stsRoleArn: string
  stsSessionName: string
}

export class OssStorageService implements StorageService {
  private readonly logger = new Logger(OssStorageService.name)
  private readonly client: OSS

  constructor(private readonly options: OssStorageOptions) {
    this.client = this.newClient()
  }

  isConfigured(): boolean {
    return true
  }

  async issueUploadCredential(input: { objectKey: string, blockmapObjectKey: string }): Promise<UploadCredentialVo> {
    if (!this.options.stsRoleArn) {
      // RAM 角色未配置：仅直传链路拒绝（签名 URL / 对象管理不受影响）
      throw businessError('STS 直传未配置（缺少 STS_ROLE_ARN），无法签发上传凭证', {
        code: AppcenterErrorCode.STS_ISSUE_FAILED,
      })
    }
    // policy 收敛为仅允许 PutObject 到安装包与 blockmap 两个精确对象键
    const policy = {
      Version: '1',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['oss:PutObject'],
          Resource: [
            `acs:oss:*:*:${this.options.bucket}/${input.objectKey}`,
            `acs:oss:*:*:${this.options.bucket}/${input.blockmapObjectKey}`,
          ],
        },
      ],
    }
    try {
      const sts = new STS({
        accessKeyId: this.options.accessKeyId,
        accessKeySecret: this.options.accessKeySecret,
      })
      const { credentials } = await sts.assumeRole(
        this.options.stsRoleArn,
        policy,
        STS_DURATION_SECONDS,
        this.options.stsSessionName,
      )
      return {
        region: this.options.region,
        bucket: this.options.bucket,
        objectKey: input.objectKey,
        blockmapObjectKey: input.blockmapObjectKey,
        accessKeyId: credentials.AccessKeyId,
        accessKeySecret: credentials.AccessKeySecret,
        securityToken: credentials.SecurityToken,
        expiration: credentials.Expiration,
      }
    }
    catch (error) {
      this.logger.error(`STS 凭证签发失败：${error instanceof Error ? error.message : String(error)}`, (error as Error)?.stack)
      throw businessError('STS 凭证签发失败（RAM / STS 配置异常或服务不可用）', {
        code: AppcenterErrorCode.STS_ISSUE_FAILED,
      })
    }
  }

  async headObject(objectKey: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.head(objectKey)
      // @types/ali-oss 的 headers 泛型为空对象，按实际响应头字典取值
      const headers = result.res.headers as Record<string, string>
      return { contentLength: Number(headers['content-length'] ?? 0) }
    }
    catch (error) {
      // 对象不存在（登记校验据此区分 003400004）：404 归一为 null，其余（如 403）原样上抛
      if ((error as { status?: number }).status === 404)
        return null
      throw error
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.client.delete(objectKey)
    }
    catch (error) {
      // 对象已不存在视为删除成功（幂等）
      if ((error as { status?: number }).status !== 404)
        throw error
    }
  }

  signGetUrl(
    objectKey: string,
    expiresSeconds = DEFAULT_SIGN_EXPIRES_SECONDS,
    downloadFileName?: string,
  ): string {
    // 管理端下载：response-content-disposition 覆盖响应头，浏览器按原始文件名落盘且不预览
    const response = downloadFileName
      ? { 'content-disposition': buildContentDisposition(downloadFileName) }
      : undefined
    return this.client.signatureUrl(objectKey, {
      expires: expiresSeconds,
      ...(response ? { response } : {}),
    })
  }

  /** 创建 OSS 客户端（桩注入点：单测替换 client 观测 headObject / deleteObject 错误映射） */
  protected newClient(): OSS {
    return new OSS({
      region: this.options.region,
      bucket: this.options.bucket,
      accessKeyId: this.options.accessKeyId,
      accessKeySecret: this.options.accessKeySecret,
      secure: true,
    })
  }
}
