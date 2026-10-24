/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 版本包接口封装：列表 / 下载 URL 签发 / STS 直传凭证签发 / 登记回调 / 删除（draft / published 可维护，offline 冻结；下载不限状态）
 */
import { http } from '@/api/http'

/** 包记录（后端 PackageVo，fileSize 数值化出口；时间为毫秒时间戳） */
export interface PackageVO {
  id: string
  versionId: string
  /** 平台：windows / macos / linux / android / ios */
  platform: string
  /** 架构：x64 / arm64 / universal；android / ios 为 null */
  arch: string | null
  fileName: string
  fileSize: number
  /** 安装包 sha256（hex，自研协议客户端校验用） */
  sha256: string
  /** 安装包 sha512（base64，electron-updater 校验用） */
  sha512: string | null
  /** minisign 签名（tauri updater 验签用） */
  minisignSignature: string | null
  ossObjectKey: string
  blockmapObjectKey: string | null
  blockmapSha512: string | null
  blockmapFileSize: number | null
  createTime: number
}

/** 安装包下载链接（后端动态签发签名 URL，2h 有效，不落库） */
export interface PackageDownloadVO {
  /** OSS 签名下载 URL（浏览器直连，携带原始文件名强制下载） */
  url: string
  /** 原始文件名（与 url 的 Content-Disposition 一致） */
  fileName: string
  /** 链接有效期（秒） */
  expiresIn: number
}

/** STS 直传凭证（后端 PackageUploadTokenVo：对象键由后端生成下发，前端不自由拼键） */
export interface UploadTokenVO {
  region: string
  bucket: string
  objectKey: string
  blockmapObjectKey: string
  accessKeyId: string
  accessKeySecret: string
  securityToken: string
  /** 凭证过期时刻（ISO 字符串，时效 1h） */
  expiration: string
}

/** 直传凭证申请入参 */
export interface UploadTokenData {
  platform: string
  arch?: string
  fileName: string
  /** 替换已占用槽位（对象键由后端插入随机批次段，避免覆盖旧对象） */
  replaceExisting?: boolean
}

/** 包登记入参（直传完成后的回调登记，file_size 以服务端 HeadObject 为准） */
export interface PackageRegisterData {
  platform: string
  arch?: string
  fileName: string
  /** OSS 对象键（凭证下发的键回传；ios 元信息登记可空） */
  objectKey?: string
  sha256: string
  sha512?: string
  minisignSignature?: string
  blockmapSha512?: string
  blockmapFileSize?: number
  /** 替换已占用槽位：后端事务内软删旧包并清理旧 OSS 对象 */
  replaceExisting?: boolean
}

export async function getPackageList(versionId: string): Promise<PackageVO[]> {
  const { data } = await http.get<PackageVO[]>(`/appcenter/version/${versionId}/package`)
  return data!
}

/** 签发安装包下载 URL（任意版本状态可下载，ios 元信息包后端拒绝） */
export async function getPackageDownloadUrl(versionId: string, pkgId: string): Promise<PackageDownloadVO> {
  const { data } = await http.get<PackageDownloadVO>(`/appcenter/version/${versionId}/package/${pkgId}/download-url`)
  return data!
}

export async function issueUploadToken(versionId: string, payload: UploadTokenData): Promise<UploadTokenVO> {
  const { data } = await http.post<UploadTokenVO>(`/appcenter/version/${versionId}/package/upload-token`, payload)
  return data!
}

export async function registerPackage(versionId: string, payload: PackageRegisterData): Promise<string> {
  const { data } = await http.post<string>(`/appcenter/version/${versionId}/package`, payload)
  return data!
}

export async function deletePackage(versionId: string, pkgId: string): Promise<void> {
  await http.delete<null>(`/appcenter/version/${versionId}/package/${pkgId}`)
}
