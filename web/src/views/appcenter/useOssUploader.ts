/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: OSS 直传组合式工具（安装包与应用图标共用）：文件流式哈希（sha256 hex / sha512 base64）+ STS 凭证直传（ali-oss 动态加载）
 */
import { sha256 as sha256Hash, sha512 as sha512Hash } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/** OSS 直传所需的最小凭证字段（安装包 UploadTokenVO 与图标 IconUploadTokenVO 均满足） */
export interface OssUploadCredential {
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  securityToken: string
}

/** 文件哈希结果：sha256（hex，登记必填）与 sha512（base64，electron-updater 校验用） */
export interface FileHash {
  sha256: string
  sha512: string
}

/** 字节数组 → base64（64 字节 digest 分段拼接，避免超限） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/** 流式计算文件哈希（按 chunk 喂入，大安装包不整读内存） */
export async function hashFile(file: File): Promise<FileHash> {
  const h256 = sha256Hash.create()
  const h512 = sha512Hash.create()
  for await (const chunk of file.stream()) {
    const bytes = chunk as Uint8Array
    h256.update(bytes)
    h512.update(bytes)
  }
  return { sha256: bytesToHex(h256.digest()), sha512: bytesToBase64(h512.digest()) }
}

/**
 * STS 凭证直传单文件到 OSS（凭证 1h 时效覆盖单次上传；更大文件的断点续传由
 * 应用侧下载链路承担，管理端上传场景不引入分片续传复杂度）
 */
export async function putObject(credential: OssUploadCredential, objectKey: string, file: File): Promise<void> {
  // ali-oss 体积大，动态 import 仅在上传时加载
  const OSSModule = await import('ali-oss')
  const client = new OSSModule.default({
    region: credential.region,
    bucket: credential.bucket,
    accessKeyId: credential.accessKeyId,
    accessKeySecret: credential.accessKeySecret,
    stsToken: credential.securityToken,
  })
  await client.put(objectKey, file)
}

/** iOS 元信息登记的 sha256 全零占位（不走直传，设计 §2.4） */
export const IOS_SHA256_PLACEHOLDER = '0'.repeat(64)
