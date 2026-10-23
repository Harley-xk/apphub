/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 存储抽象：STS 直传凭证签发 / 对象元信息 / 删除 / 签名下载 URL（实现为 OSS 或未配置 stub，测试打桩）
 */

/** 存储服务注入 token（appcenter 模块内消费） */
export const STORAGE_SERVICE = 'appcenter:storage-service'

/** STS 直传凭证出参（浏览器 ali-oss 直传私有桶用，policy 收敛为精确键 PutObject） */
export interface UploadCredentialVo {
  region: string
  bucket: string
  /** 安装包对象键（前端不自由拼键，后端生成下发） */
  objectKey: string
  /** blockmap 对象键（electron-updater 差量更新用，与安装包同目录） */
  blockmapObjectKey: string
  accessKeyId: string
  accessKeySecret: string
  securityToken: string
  /** 凭证过期时刻（ISO 字符串，时效 1h；大文件分片续传中过期由前端 STS provider 自动刷新重取） */
  expiration: string
}

/** 对象元信息（登记时以服务端侧 content-length 为准落库 file_size） */
export interface ObjectHead {
  contentLength: number
}

export interface StorageService {
  /** OSS 主配置是否齐全（未配置时启动正常，存储操作统一抛 003400001） */
  isConfigured(): boolean

  /** 签发 STS 直传凭证：policy 仅允许 PutObject 到 objectKey 与 blockmapObjectKey */
  issueUploadCredential(input: { objectKey: string, blockmapObjectKey: string }): Promise<UploadCredentialVo>

  /** 查对象元信息：对象不存在返回 null（登记校验据此区分 003400004） */
  headObject(objectKey: string): Promise<ObjectHead | null>

  /** 删除对象：对象不存在视为成功（删包幂等） */
  deleteObject(objectKey: string): Promise<void>

  /**
   * 生成签名下载 URL（默认 2h；下载地址动态生成不落库）。
   * downloadFileName 传入时经 OSS 响应头覆盖（response-content-disposition）强制以该文件名下载，
   * 供管理端安装包下载保持登记时的原始文件名（中文 / 空格等特殊字符经 RFC 5987 编码）。
   */
  signGetUrl(objectKey: string, expiresSeconds?: number, downloadFileName?: string): string
}
