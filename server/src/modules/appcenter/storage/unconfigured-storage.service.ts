/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 未配置存储 stub：OSS 环境变量缺失时的占位实现（服务正常启动，存储操作统一抛 003400001）
 */
import { businessError } from '../../../common/exceptions/business-error'
import { AppcenterErrorCode } from '../error-codes'
import type { ObjectHead, StorageService, UploadCredentialVo } from './storage.service'

export class UnconfiguredStorageService implements StorageService {
  isConfigured(): boolean {
    return false
  }

  issueUploadCredential(input: { objectKey: string, blockmapObjectKey: string }): Promise<UploadCredentialVo> {
    return Promise.reject(this.buildError(`无法签发对象 ${input.objectKey} 的直传凭证`))
  }

  headObject(objectKey: string): Promise<ObjectHead | null> {
    return Promise.reject(this.buildError(`无法读取对象 ${objectKey}`))
  }

  deleteObject(objectKey: string): Promise<void> {
    return Promise.reject(this.buildError(`无法删除对象 ${objectKey}`))
  }

  signGetUrl(objectKey: string): string {
    throw this.buildError(`无法为对象 ${objectKey} 生成签名下载 URL`)
  }

  /** 未配置错误：OSS 主配置缺失时所有存储操作不可用（STS 凭证签发失败码 003400001 顺带承载） */
  private buildError(action: string) {
    return businessError(`对象存储未配置（缺少 OSS_* 环境变量），${action}`, {
      code: AppcenterErrorCode.STS_ISSUE_FAILED,
    })
  }
}
