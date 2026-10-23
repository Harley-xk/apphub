/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 包服务：STS 直传凭证签发（对象键后端生成）、登记（HeadObject 校验 / file_size 服务端为准）、删除（连带 OSS 清理）
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull } from 'typeorm'
import type { FindOptionsWhere, Repository } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
import { AppService } from '../app/app.service'
import { buildPackageObjectKey, PACKAGE_PLATFORM, VERSION_STATUS } from '../appcenter.constants'
import { AppChannelEntity } from '../entities/app-channel.entity'
import { AppPackageEntity } from '../entities/app-package.entity'
import { AppVersionEntity } from '../entities/app-version.entity'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import { STORAGE_SERVICE } from '../storage/storage.service'
import type { StorageService } from '../storage/storage.service'
import type { PackageRegisterDto, PackageUploadTokenDto, PackageUploadTokenVo, PackageVo } from './dto/package.dto'

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

  /** 签发直传凭证：draft 校验 + (platform, arch) 占用校验 + 对象键生成下发（A3 直传方案） */
  async issueUploadToken(versionId: string, dto: PackageUploadTokenDto, userId: string): Promise<PackageUploadTokenVo> {
    const { version, app, channel } = await this.loadDraftContext(versionId, userId)
    await this.assertPlatformAvailable(versionId, dto.platform, dto.arch ?? null)
    // 对象键由后端生成下发（前端不自由拼键），blockmap 放包同目录
    const objectKey = buildPackageObjectKey({
      appKey: app.appKey,
      channelCode: channel.code,
      version: version.version,
      platform: dto.platform,
      arch: dto.arch ?? null,
      fileName: dto.fileName,
    })
    const blockmapObjectKey = `${objectKey}.blockmap`
    return this.storageService.issueUploadCredential({ objectKey, blockmapObjectKey })
  }

  /** 登记包记录：HeadObject 校验对象存在，file_size 以服务端 content-length 为准落库 */
  async register(versionId: string, dto: PackageRegisterDto, userId: string): Promise<string> {
    await this.loadDraftContext(versionId, userId)
    await this.assertPlatformAvailable(versionId, dto.platform, dto.arch ?? null)

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

    const pkg = await this.packageRepository.save(
      this.packageRepository.create({
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
      }),
    )
    return pkg.id
  }

  /** 删除包：仅 draft 版本；软删记录并同步清理 OSS 对象（安装包 + blockmap） */
  async remove(versionId: string, pkgId: string, userId: string): Promise<void> {
    const pkg = await this.packageRepository.findOne({ where: { id: pkgId, versionId } })
    if (!pkg) {
      throw businessError(AppcenterErrorCode.PACKAGE_NOT_EXISTS.message, {
        code: AppcenterErrorCode.PACKAGE_NOT_EXISTS,
      })
    }
    const version = await this.getExistsVersion(versionId)
    await this.appService.assertAccessible(userId, version.appId)
    if (version.status !== VERSION_STATUS.DRAFT) {
      throw businessError('仅草稿版本的包允许删除', { code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN })
    }
    await this.packageRepository.softRemove(pkg)
    if (pkg.ossObjectKey) {
      try {
        await this.storageService.deleteObject(pkg.ossObjectKey)
        if (pkg.blockmapObjectKey)
          await this.storageService.deleteObject(pkg.blockmapObjectKey)
      }
      catch (error) {
        // OSS 清理失败不阻断删除（记录保留对象键，人工跟进），留痕
        this.logger.warn(
          `删除包时清理 OSS 对象失败（对象键 ${pkg.ossObjectKey}）：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  /** (platform, arch) 占用校验：查未删行（删包即释放槽位，draft 可删包重传兜底）；arch=null 须 IS NULL 匹配（PG 唯一索引对 NULL 不判等） */
  private async assertPlatformAvailable(versionId: string, platform: string, arch: string | null): Promise<void> {
    const where: FindOptionsWhere<AppPackageEntity> = {
      versionId,
      platform,
      arch: arch ?? IsNull(),
    }
    const occupied = await this.packageRepository.findOne({ where })
    if (occupied) {
      throw businessError(AppcenterErrorCode.PACKAGE_PLATFORM_DUPLICATE.message, {
        code: AppcenterErrorCode.PACKAGE_PLATFORM_DUPLICATE,
      })
    }
  }

  /** 加载版本上下文并校验 draft 状态（上传 / 登记仅草稿可操作；先完成数据范围校验） */
  private async loadDraftContext(versionId: string, userId: string): Promise<{
    version: AppVersionEntity
    app: AppEntity
    channel: AppChannelEntity
  }> {
    const version = await this.getExistsVersion(versionId)
    await this.appService.assertAccessible(userId, version.appId)
    if (version.status !== VERSION_STATUS.DRAFT) {
      throw businessError('仅草稿版本允许上传与登记安装包', { code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN })
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
