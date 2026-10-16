/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 版本平台包实体：一次发版 = 一个版本 + N 个平台包（主张 A2），框架协议产物（sha512 / minisign / blockmap）同表登记（主张 A5）
 */
import { Column, Entity, Index } from 'typeorm'

import { BaseEntity } from '../../../common/orm/base.entity'

@Entity('app_package')
// 部分唯一索引：版本内平台+架构唯一（注意 PG 唯一索引对 NULL 不判等——arch 为 null 的组合须由应用层占用校验兜底）
@Index('uk_app_package_scope', ['versionId', 'platform', 'arch'], { unique: true, where: 'deleted_at IS NULL' })
export class AppPackageEntity extends BaseEntity {
  /** 所属版本 id */
  @Column({ type: 'uuid' })
  versionId: string

  /** 平台：windows / macos / linux / android / ios / web */
  @Column({ type: 'varchar', length: 16 })
  platform: string

  /** 架构：x64 / arm64 / universal；web / android / ios 为 null */
  @Column({ type: 'varchar', length: 16, nullable: true })
  arch: string | null

  /** 原始文件名 */
  @Column({ type: 'varchar', length: 255 })
  fileName: string

  /** 字节数（bigint 列 PG 驱动读出为 string，toVo 统一转数值出口；以 HeadObject 的 content-length 为准落库） */
  @Column({ type: 'bigint' })
  fileSize: number

  /** 安装包 sha256（hex，自研协议客户端校验用，必填） */
  @Column({ type: 'char', length: 64 })
  sha256: string

  /** 安装包 sha512（base64 编码，electron-updater 校验用，D24；framework=electron 的桌面包必填） */
  @Column({ type: 'varchar', length: 96, nullable: true })
  sha512: string | null

  /** Tauri 更新包 minisign 签名（构建时 tauri signer sign 生成的 .sig 内容，D24；framework=tauri 必填） */
  @Column({ type: 'text', nullable: true })
  minisignSignature: string | null

  /** Electron .blockmap 差分文件的 OSS 键（可选上传；未上传则客户端退回全量下载，D11） */
  @Column({ type: 'varchar', length: 512, nullable: true })
  blockmapObjectKey: string | null

  /** blockmap 文件哈希（base64 sha512，latest.yml 的 files 数组需要） */
  @Column({ type: 'varchar', length: 96, nullable: true })
  blockmapSha512: string | null

  /** blockmap 文件字节数（latest.yml 的 files 数组条目需要 size） */
  @Column({ type: 'bigint', nullable: true })
  blockmapFileSize: number | null

  /** OSS 对象键（下载地址动态生成签名 URL，不落库完整 URL） */
  @Column({ type: 'varchar', length: 512 })
  ossObjectKey: string
}
