/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 包服务：STS 直传凭证签发（对象键后端生成）、登记（HeadObject 校验 / file_size 服务端为准）、删除（连带 OSS 清理）；
 *       draft / published 均可维护，offline 冻结；published 支持替换（事务内软删旧包 + 清理旧对象）
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomBytes } from 'node:crypto'
import { IsNull } from 'typeorm'
import type { FindOptionsWhere, Repository } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
import { AppService } from '../app/app.service'
import {
  buildPackageObjectKey,
  PACKAGE_DOWNLOAD_EXPIRES_SECONDS,
  PACKAGE_PLATFORM,
  VERSION_STATUS,
} from '../appcenter.constants'
import { assertFrameworkArtifacts } from './package-artifacts.util'
import { AppChannelEntity } from '../entities/app-channel.entity'
import { AppPackageEntity } from '../entities/app-package.entity'
import { AppVersionEntity } from '../entities/app-version.entity'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import { STORAGE_SERVICE } from '../storage/storage.service'
import type { StorageService } from '../storage/storage.service'
import type {
  PackageDownloadVo,
  PackageRegisterDto,
  PackageUploadTokenDto,
  PackageUploadTokenVo,
  PackageVo,
} from './dto/package.dto'

/** 替换批次短标识（8 位十六进制）：插入对象键，避免同名文件覆盖旧对象 */
function generateBatchId(): string {
  return randomBytes(4).toString('hex')
}

@Injectable()
export class PackageService {
  private readonly logger = new Logger(PackageService.name)

  constructor(
    @InjectRepository(AppPackageEntity)
    private readonly packageRepository: Repository<AppPackageEntity>,
    @InjectRepository(AppVersionEntity)
    private readonly versionRepository: Repository<AppVersionEntity>,
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
    @InjectRepository(AppChannelEntity)
    private readonly channelRepository: Repository<AppChannelEntity>,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
    private readonly appService: AppService,
  ) {}

  /** 版本下包记录列表（下钻页包面板数据源；经 versionId → appId 反查做数据范围校验） */
  async list(versionId: string, userId: string): Promise<PackageVo[]> {
    const version = await this.getExistsVersion(versionId)
    await this.appService.assertAccessible(userId, version.appId)
    const packages = await this.packageRepository.find({
      where: { versionId },
      order: { createTime: 'ASC' },
    })
    return packages.map(pkg => this.toVo(pkg))
  }

  /**
   * 管理端下载：签发安装包签名 URL（任意版本状态均可下载——已发版产物需可随时取回复核；
   * ios 元信息包无安装包文件拒绝）。数据范围校验经 versionId → appId 反查。
   */
  async getDownloadUrl(versionId: string, pkgId: string, userId: string): Promise<PackageDownloadVo> {
    const pkg = await this.packageRepository.findOne({ where: { id: pkgId, versionId } })
    if (!pkg) {
      throw businessError(AppcenterErrorCode.PACKAGE_NOT_EXISTS.message, {
        code: AppcenterErrorCode.PACKAGE_NOT_EXISTS,
      })
    }
    const version = await this.getExistsVersion(versionId)
    await this.appService.assertAccessible(userId, version.appId)
    if (!pkg.ossObjectKey) {
      throw businessError(AppcenterErrorCode.PACKAGE_OBJECT_MISSING.message, {
        code: AppcenterErrorCode.PACKAGE_OBJECT_MISSING,
      })
    }
    return {
      url: this.storageService.signGetUrl(pkg.ossObjectKey, PACKAGE_DOWNLOAD_EXPIRES_SECONDS, pkg.fileName),
      fileName: pkg.fileName,
      expiresIn: PACKAGE_DOWNLOAD_EXPIRES_SECONDS,
    }
  }

  /**
   * 签发直传凭证：版本可维护校验（draft / published）+ 槽位状态校验 + 对象键生成下发（A3 直传方案）。
   * 替换模式要求槽位已占用并生成带随机批次段的对象键（避免同名覆盖旧对象）；普通模式要求槽位空闲。
   */
  async issueUploadToken(versionId: string, dto: PackageUploadTokenDto, userId: string): Promise<PackageUploadTokenVo> {
    const { version, app, channel } = await this.loadMutableContext(versionId, userId)
    const occupied = await this.findOccupiedPackage(versionId, dto.platform, dto.arch ?? null)
    this.assertSlotState(occupied, dto.replaceExisting)
    // 对象键由后端生成下发（前端不自由拼键），blockmap 放包同目录
    const objectKey = buildPackageObjectKey({
      appKey: app.appKey,
      channelCode: channel.code,
      version: version.version,
      platform: dto.platform,
      arch: dto.arch ?? null,
      fileName: dto.fileName,
      batchId: dto.replaceExisting ? generateBatchId() : undefined,
    })
    const blockmapObjectKey = `${objectKey}.blockmap`
    return this.storageService.issueUploadCredential({ objectKey, blockmapObjectKey })
  }

  /**
   * 登记包记录：HeadObject 校验对象存在，file_size 以服务端 content-length 为准落库。
   * published 版本校验框架产物完整性（草稿由发布前置校验兜底）；替换在同一事务内软删旧包并插入新包，
   * 提交后清理旧 OSS 对象（失败仅留痕）。
   */
  async register(versionId: string, dto: PackageRegisterDto, userId: string): Promise<string> {
    const { version, app } = await this.loadMutableContext(versionId, userId)
    const occupied = await this.findOccupiedPackage(versionId, dto.platform, dto.arch ?? null)
    this.assertSlotState(occupied, dto.replaceExisting)
    // 发布后不允许补入不完整产物：electron 缺 sha512 / tauri 缺 minisign 会让适配端点整平台失联
    if (version.status === VERSION_STATUS.PUBLISHED)
      assertFrameworkArtifacts(app.framework, [dto])

    const objectKey = dto.objectKey?.trim() ?? ''
    if (!objectKey && dto.platform !== PACKAGE_PLATFORM.IOS) {
      throw businessError('缺少安装包对象键（ios 元信息登记除外）', {
        code: AppcenterErrorCode.PACKAGE_OBJECT_NOT_EXISTS,
      })
    }

    // HeadObject：对象不存在抛 003400004；file_size 以服务端侧为准（前端不声明）
    let fileSize = 0
    if (objectKey) {
      const head = await this.storageService.headObject(objectKey)
      if (!head) {
        throw businessError(AppcenterErrorCode.PACKAGE_OBJECT_NOT_EXISTS.message, {
          code: AppcenterErrorCode.PACKAGE_OBJECT_NOT_EXISTS,
        })
      }
      fileSize = head.contentLength
    }

    // blockmap 可选：声明了哈希 / 大小即校验同目录 blockmap 对象存在，大小未声明以 HeadObject 为准
    let blockmapObjectKey: string | null = null
    let blockmapFileSize = dto.blockmapFileSize ?? null
    if (objectKey && (dto.blockmapSha512 || blockmapFileSize !== null)) {
      const blockmapHead = await this.storageService.headObject(`${objectKey}.blockmap`)
      if (!blockmapHead) {
        throw businessError('blockmap 差分文件对象不存在（已声明 blockmap 产物但未上传）', {
          code: AppcenterErrorCode.PACKAGE_OBJECT_NOT_EXISTS,
        })
      }
      blockmapObjectKey = `${objectKey}.blockmap`
      blockmapFileSize = blockmapFileSize ?? blockmapHead.contentLength
    }

    const data = {
      versionId,
      platform: dto.platform,
      arch: dto.arch ?? null,
      fileName: dto.fileName,
      fileSize,
      sha256: dto.sha256,
      sha512: dto.sha512 ?? null,
      minisignSignature: dto.minisignSignature ?? null,
      blockmapObjectKey,
      blockmapSha512: dto.blockmapSha512 ?? null,
      blockmapFileSize,
      ossObjectKey: objectKey,
    }

    // 替换：软删旧包 + 插入新包在同一事务，避免「旧包已删、新包未落」的空档
    if (occupied) {
      const newId = await this.packageRepository.manager.transaction(async (manager) => {
        const repo = manager.getRepository(AppPackageEntity)
        await repo.softRemove(occupied)
        const saved = await repo.save(repo.create(data))
        return saved.id
      })
      await this.removeObjectsBestEffort(occupied)
      return newId
    }

    const pkg = await this.packageRepository.save(this.packageRepository.create(data))
    return pkg.id
  }

  /**
   * 删除包：draft / published 均可（offline 冻结）；软删记录并同步清理 OSS 对象（安装包 + blockmap）。
   * published 下删除会撤回该平台分发（候选回退到更早版本或无更新），由管理端二次确认告知影响。
   */
  async remove(versionId: string, pkgId: string, userId: string): Promise<void> {
    const pkg = await this.packageRepository.findOne({ where: { id: pkgId, versionId } })
    if (!pkg) {
      throw businessError(AppcenterErrorCode.PACKAGE_NOT_EXISTS.message, {
        code: AppcenterErrorCode.PACKAGE_NOT_EXISTS,
      })
    }
    const version = await this.getExistsVersion(versionId)
    await this.appService.assertAccessible(userId, version.appId)
    if (version.status === VERSION_STATUS.OFFLINE) {
      throw businessError('已下线版本为终态，不允许删除平台包（重新分发请新建版本）', {
        code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN,
      })
    }
    await this.packageRepository.softRemove(pkg)
    await this.removeObjectsBestEffort(pkg)
  }

  /** 查 (platform, arch) 占用行（未删）；arch=null 须 IS NULL 匹配（PG 唯一索引对 NULL 不判等） */
  private async findOccupiedPackage(versionId: string, platform: string, arch: string | null): Promise<AppPackageEntity | null> {
    const where: FindOptionsWhere<AppPackageEntity> = {
      versionId,
      platform,
      arch: arch ?? IsNull(),
    }
    return this.packageRepository.findOne({ where })
  }

  /** 槽位状态与替换意图一致性：替换须有占用行，新增须槽位空闲（防误覆盖与空替换） */
  private assertSlotState(occupied: AppPackageEntity | null, replaceExisting?: boolean): void {
    if (replaceExisting && !occupied) {
      throw businessError(AppcenterErrorCode.PACKAGE_REPLACE_TARGET_NOT_EXISTS.message, {
        code: AppcenterErrorCode.PACKAGE_REPLACE_TARGET_NOT_EXISTS,
      })
    }
    if (!replaceExisting && occupied) {
      throw businessError(AppcenterErrorCode.PACKAGE_PLATFORM_DUPLICATE.message, {
        code: AppcenterErrorCode.PACKAGE_PLATFORM_DUPLICATE,
      })
    }
  }

  /** 清理包关联的 OSS 对象（失败不阻断主流程，留痕供人工跟进） */
  private async removeObjectsBestEffort(pkg: AppPackageEntity): Promise<void> {
    if (!pkg.ossObjectKey)
      return
    try {
      await this.storageService.deleteObject(pkg.ossObjectKey)
      if (pkg.blockmapObjectKey)
        await this.storageService.deleteObject(pkg.blockmapObjectKey)
    }
    catch (error) {
      this.logger.warn(
        `清理 OSS 对象失败（对象键 ${pkg.ossObjectKey}）：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 加载版本上下文并校验可维护状态（draft / published；offline 冻结；先完成数据范围校验） */
  private async loadMutableContext(versionId: string, userId: string): Promise<{
    version: AppVersionEntity
    app: AppEntity
    channel: AppChannelEntity
  }> {
    const version = await this.getExistsVersion(versionId)
    await this.appService.assertAccessible(userId, version.appId)
    if (version.status === VERSION_STATUS.OFFLINE) {
      throw businessError('已下线版本为终态，不允许维护平台包（重新分发请新建版本）', {
        code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN,
      })
    }
    const app = await this.appRepository.findOne({ where: { id: version.appId } })
    if (!app) {
      throw businessError(AppcenterErrorCode.APP_NOT_EXISTS.message, { code: AppcenterErrorCode.APP_NOT_EXISTS })
    }
    const channel = await this.channelRepository.findOne({ where: { id: version.channelId, appId: version.appId } })
    if (!channel) {
      throw businessError(AppcenterErrorCode.CHANNEL_NOT_EXISTS.message, {
        code: AppcenterErrorCode.CHANNEL_NOT_EXISTS,
      })
    }
    return { version, app, channel }
  }

  /** 按主键查版本：不存在抛 VERSION_NOT_EXISTS */
  private async getExistsVersion(id: string): Promise<AppVersionEntity> {
    const version = await this.versionRepository.findOne({ where: { id } })
    if (!version) {
      throw businessError(AppcenterErrorCode.VERSION_NOT_EXISTS.message, {
        code: AppcenterErrorCode.VERSION_NOT_EXISTS,
      })
    }
    return version
  }

  /** 实体转出参：白名单映射 + bigint 数值化出口 */
  private toVo(pkg: AppPackageEntity): PackageVo {
    return {
      id: pkg.id,
      versionId: pkg.versionId,
      platform: pkg.platform,
      arch: pkg.arch,
      fileName: pkg.fileName,
      fileSize: Number(pkg.fileSize),
      sha256: pkg.sha256,
      sha512: pkg.sha512,
      minisignSignature: pkg.minisignSignature,
      ossObjectKey: pkg.ossObjectKey,
      blockmapObjectKey: pkg.blockmapObjectKey,
      blockmapSha512: pkg.blockmapSha512,
      blockmapFileSize: pkg.blockmapFileSize === null ? null : Number(pkg.blockmapFileSize),
      createTime: pkg.createTime,
    }
  }
}
