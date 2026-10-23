import { describe, expect, it } from '@jest/globals'
import type OSS from 'ali-oss'

import { AppcenterErrorCode } from '../error-codes'
import { OssStorageService } from './oss-storage.service'
import type { OssStorageOptions } from './oss-storage.service'
import { UnconfiguredStorageService } from './unconfigured-storage.service'

const OPTIONS: OssStorageOptions = {
  region: 'oss-cn-hangzhou',
  bucket: 'apphub-test',
  accessKeyId: 'test-ak',
  accessKeySecret: 'test-sk',
  stsRoleArn: 'acs:ram::123:role/apphub-upload',
  stsSessionName: 'apphub-upload',
}

/** 注入桩 client 的可测实现（闭包捕获，规避派生类构造时序） */
function makeServiceWithClient(client: Record<string, unknown>): OssStorageService {
  class TestableOssStorageService extends OssStorageService {
    protected newClient(): OSS {
      return client as unknown as OSS
    }
  }
  return new TestableOssStorageService(OPTIONS)
}

describe('UnconfiguredStorageService（未配置分支）', () => {
  it('isConfigured 应为 false，服务可正常启动', () => {
    expect(new UnconfiguredStorageService().isConfigured()).toBe(false)
  })

  it('所有存储操作应统一抛 003400001（存储未配置）', async () => {
    const storage = new UnconfiguredStorageService()
    await expect(storage.issueUploadCredential({ objectKey: 'a', blockmapObjectKey: 'b' })).rejects.toMatchObject({
      code: AppcenterErrorCode.STS_ISSUE_FAILED.code,
    })
    await expect(storage.headObject('a')).rejects.toMatchObject({ code: AppcenterErrorCode.STS_ISSUE_FAILED.code })
    await expect(storage.deleteObject('a')).rejects.toMatchObject({ code: AppcenterErrorCode.STS_ISSUE_FAILED.code })
    expect(() => storage.signGetUrl('a')).toThrow('对象存储未配置')
  })
})

describe('OssStorageService', () => {
  it('STS_ROLE_ARN 缺失时签发直传凭证应抛 003400001（仅直传链路拒绝）', async () => {
    const service = new OssStorageService({ ...OPTIONS, stsRoleArn: '' })
    await expect(
      service.issueUploadCredential({ objectKey: 'packages/app/stable/1.0.0/a.exe', blockmapObjectKey: 'b.blockmap' }),
    ).rejects.toMatchObject({ code: AppcenterErrorCode.STS_ISSUE_FAILED.code })
  })

  it('签名下载 URL 应指向桶域名并携带过期与签名参数（本地 HMAC 计算，2h 默认时效）', () => {
    const service = new OssStorageService(OPTIONS)
    const url = service.signGetUrl('packages/app/stable/1.0.0/a.exe')
    expect(url).toContain('https://apphub-test.oss-cn-hangzhou.aliyuncs.com/packages/app/stable/1.0.0/a.exe')
    expect(url).toMatch(/[?&]Expires=\d+/)
    expect(url).toMatch(/[?&]Signature=/)
  })

  it('传入下载文件名时签名 URL 应携带 response-content-disposition（强制原始文件名下载）', () => {
    const service = new OssStorageService(OPTIONS)
    const url = service.signGetUrl('packages/app/stable/1.0.0/a.exe', 7200, '应用-1.3.0.exe')
    // ASCII 兜底 + RFC 5987 UTF-8 双段文件名（中文无损还原，浏览器优先 filename*）
    expect(decodeURIComponent(url)).toContain(
      'response-content-disposition=attachment; filename="__-1.3.0.exe"; filename*=UTF-8\'\'%E5%BA%94%E7%94%A8-1.3.0.exe',
    )
  })

  it('未传下载文件名时不注入 response-content-disposition（开放 API 下载地址保持原响应头）', () => {
    const service = new OssStorageService(OPTIONS)
    expect(service.signGetUrl('packages/app/stable/1.0.0/a.exe')).not.toContain('response-content-disposition')
  })

  it('headObject 对象不存在应归一为 null（登记校验据此区分 003400004）', async () => {
    const service = makeServiceWithClient({
      head: () => Promise.reject(Object.assign(new Error('NoSuchKey'), { status: 404 })),
    })
    await expect(service.headObject('ghost')).resolves.toBeNull()
  })

  it('headObject 成功应返回数值化 content-length（OSS 响应头为字符串）', async () => {
    const service = makeServiceWithClient({
      head: () => Promise.resolve({ res: { headers: { 'content-length': '1048576' } } }),
    })
    await expect(service.headObject('a.exe')).resolves.toEqual({ contentLength: 1048576 })
  })

  it('headObject 非 404 异常应原样上抛（不吞权限 / 网络错误）', async () => {
    const forbidden = Object.assign(new Error('AccessDenied'), { status: 403 })
    const service = makeServiceWithClient({ head: () => Promise.reject(forbidden) })
    await expect(service.headObject('a.exe')).rejects.toBe(forbidden)
  })

  it('deleteObject 对象已不存在应视为成功（删包幂等）', async () => {
    const service = makeServiceWithClient({
      delete: () => Promise.reject(Object.assign(new Error('NoSuchKey'), { status: 404 })),
    })
    await expect(service.deleteObject('ghost')).resolves.toBeUndefined()
  })
})
