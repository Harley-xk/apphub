/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 包域 DTO 集：直传凭证申请 / 登记入参与出参契约（file_size 由服务端 HeadObject 落库，前端不声明）
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator'

import { PACKAGE_ARCH, PACKAGE_PLATFORM } from '../../appcenter.constants'
import type { UploadCredentialVo } from '../../storage/storage.service'

/** 可直传平台（ios 仅登记元信息不走直传，web 无包记录——设计 §2.4 / §3.5） */
const UPLOADABLE_PLATFORMS = [
  PACKAGE_PLATFORM.WINDOWS,
  PACKAGE_PLATFORM.MACOS,
  PACKAGE_PLATFORM.LINUX,
  PACKAGE_PLATFORM.ANDROID,
] as const

/** 可登记平台（含 ios 元信息登记，排除 web） */
const REGISTRABLE_PLATFORMS = [...UPLOADABLE_PLATFORMS, PACKAGE_PLATFORM.IOS] as const

/** 包出参（fileSize / blockmapFileSize 数值化出口：bigint 列 PG 驱动读出为 string） */
export interface PackageVo {
  id: string
  versionId: string
  platform: string
  arch: string | null
  fileName: string
  fileSize: number
  sha256: string
  sha512: string | null
  minisignSignature: string | null
  ossObjectKey: string
  blockmapObjectKey: string | null
  blockmapSha512: string | null
  blockmapFileSize: number | null
  createTime: Date
}

/** 安装包下载出参（签名 URL 动态签发不落库，expiresIn 为秒数供前端提示） */
export interface PackageDownloadVo {
  /** OSS 签名下载 URL（浏览器直连，携带原始文件名下载） */
  url: string
  /** 原始文件名（与 url 的 Content-Disposition 一致） */
  fileName: string
  /** 链接有效期（秒） */
  expiresIn: number
}

/** 直传凭证申请入参 */
export class PackageUploadTokenDto {
  @ApiProperty({ description: '平台（可直传：windows / macos / linux / android）', example: 'windows' })
  @IsIn(UPLOADABLE_PLATFORMS, { message: '平台取值须为 windows / macos / linux / android' })
  platform: string

  @ApiPropertyOptional({ description: '架构（x64 / arm64 / universal；android 填空）', example: 'x64' })
  @IsOptional()
  @IsIn([PACKAGE_ARCH.X64, PACKAGE_ARCH.ARM64, PACKAGE_ARCH.UNIVERSAL], { message: '架构取值须为 x64 / arm64 / universal' })
  arch?: string

  @ApiProperty({ description: '原始文件名（对象键末段，后端生成下发）', example: 'app-setup-1.3.0.exe' })
  @IsString()
  @Matches(/^[^/\\\s]+$/, { message: '文件名不能包含路径分隔符或空白字符' })
  @MaxLength(255)
  fileName: string
}

/** 直传凭证响应（对象键 + STS 临时凭证，policy 收敛为这两个键的 PutObject） */
export type PackageUploadTokenVo = UploadCredentialVo

/** 包登记入参（前端直传完成后的回调登记） */
export class PackageRegisterDto {
  @ApiProperty({ description: '平台（windows / macos / linux / android / ios——ios 仅登记元信息可空 objectKey）', example: 'windows' })
  @IsIn(REGISTRABLE_PLATFORMS, { message: '平台取值须为 windows / macos / linux / android / ios' })
  platform: string

  @ApiPropertyOptional({ description: '架构（x64 / arm64 / universal；android / ios 填空）' })
  @IsOptional()
  @IsIn([PACKAGE_ARCH.X64, PACKAGE_ARCH.ARM64, PACKAGE_ARCH.UNIVERSAL], { message: '架构取值须为 x64 / arm64 / universal' })
  arch?: string

  @ApiProperty({ description: '原始文件名', example: 'app-setup-1.3.0.exe' })
  @IsString()
  @Matches(/^[^/\\\s]+$/, { message: '文件名不能包含路径分隔符或空白字符' })
  @MaxLength(255)
  fileName: string

  @ApiPropertyOptional({ description: 'OSS 对象键（直传凭证下发的键回传；ios 元信息登记可空）' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  objectKey?: string

  @ApiProperty({ description: '安装包 sha256（hex；ios 元信息登记传全零占位）' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: 'sha256 须为 64 位十六进制字符串' })
  sha256: string

  @ApiPropertyOptional({ description: '安装包 sha512（base64，electron-updater 校验用，D24）' })
  @IsOptional()
  @IsString()
  @MaxLength(96)
  sha512?: string

  @ApiPropertyOptional({ description: 'minisign 签名（tauri updater 验签用，D24）' })
  @IsOptional()
  @IsString()
  minisignSignature?: string

  @ApiPropertyOptional({ description: 'blockmap 文件 sha512（base64；blockmap 与安装包同目录，对象键后端推导）' })
  @IsOptional()
  @IsString()
  @MaxLength(96)
  blockmapSha512?: string

  @ApiPropertyOptional({ description: 'blockmap 文件字节数（未声明时以服务端 HeadObject 为准）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  blockmapFileSize?: number
}
