/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 版本服务：状态机 draft → published → offline（设计 §3.2）、semver 校验、发布前置校验（包存在 / 框架产物完整）、更新候选查询
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { rcompare, valid as validSemver } from 'semver'
import { In, IsNull, Not } from 'typeorm'
import type { FindOptionsWhere, Repository } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { AppService } from '../app/app.service'
import { CHANNEL_STATUS, PACKAGE_PLATFORM, VERSION_STATUS } from '../appcenter.constants'
import { AppChannelEntity } from '../entities/app-channel.entity'
import { AppPackageEntity } from '../entities/app-package.entity'
import { AppVersionEntity } from '../entities/app-version.entity'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import { assertFrameworkArtifacts } from '../package/package-artifacts.util'
import { STORAGE_SERVICE } from '../storage/storage.service'
import type { StorageService } from '../storage/storage.service'
import type { VersionCreateDto, VersionPageDto, VersionUpdateDto, VersionVo } from './dto/version.dto'

/** 更新检测候选：版本 + 该平台（+ 架构）匹配的包列表（自研协议与 D24 适配端点共用） */
export interface UpdateCandidate {
  version: AppVersionEntity
  packages: AppPackageEntity[]
}

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name)

  constructor(
    @InjectRepository(AppVersionEntity)
    private readonly versionRepository: Repository<AppVersionEntity>,
    @InjectRepository(AppPackageEntity)
    private readonly packageRepository: Repository<AppPackageEntity>,
    @InjectRepository(AppChannelEntity)
    private readonly channelRepository: Repository<AppChannelEntity>,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
    private readonly appService: AppService,
  ) {}

  /** 分页查询（按应用必选过滤，通道 / 状态可选；路径 :id 即 appId，先做数据范围校验） */
  async getPage(appId: string, dto: VersionPageDto, userId: string): Promise<PageResult<VersionVo>> {
    await this.appService.assertAccessible(userId, appId)
    const where: FindOptionsWhere<AppVersionEntity> = { appId }
    if (dto.channelId !== undefined)
      where.channelId = dto.channelId
    if (dto.status !== undefined)
      where.status = dto.status
    const [list, total] = await this.versionRepository.findAndCount({
      where,
      skip: (dto.pageNo - 1) * dto.pageSize,
      take: dto.pageSize,
      order: { createTime: 'DESC' },
    })
    const channelMap = await this.loadChannelMap(appId)
    return { list: list.map(version => this.toVo(version, channelMap)), total }
  }

  /** 创建 draft 版本：semver 校验 + 通道归属校验 + 通道内查重（含软删历史，设计 §4.6） */
  async create(appId: string, dto: VersionCreateDto, userId: string): Promise<string> {
    await this.appService.assertAccessible(userId, appId)
    const channel = await this.getExistsChannel(appId, dto.channelId)
    this.assertSemver(dto.version)
    await this.assertVersionAvailable(appId, channel.id, dto.version)
    const version = await this.versionRepository.save(
      this.versionRepository.create({
        appId,
        channelId: channel.id,
        version: dto.version,
        title: dto.title,
        notes: dto.notes ?? null,
        forceUpdate: dto.forceUpdate ?? false,
        status: VERSION_STATUS.DRAFT,
      }),
    )
    return version.id
  }

  /** 编辑：draft 任意编辑；published 仅 notes / forceUpdate；offline 终态一律拒绝（设计 §3.2） */
  async update(dto: VersionUpdateDto, userId: string): Promise<void> {
    const version = await this.getExistsVersion(dto.id)
    await this.appService.assertAccessible(userId, version.appId)
    if (version.status === VERSION_STATUS.OFFLINE) {
      throw businessError('已下线版本为终态，不可编辑（重新发布请新建版本）', {
        code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN,
      })
    }
    if (version.status === VERSION_STATUS.PUBLISHED) {
      // published 仅允许改 notes / forceUpdate：版本号 / 标题传入即拒（防止前端误以为已生效）
      if ((dto.version !== undefined && dto.version !== version.version)
        || (dto.title !== undefined && dto.title !== version.title)) {
        throw businessError('已发布版本仅允许修改更新说明与强制标记', {
          code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN,
        })
      }
    }
    else if (dto.version !== undefined && dto.version !== version.version) {
      // draft 改版本号：重走 semver 与通道内查重（排除自身）
      this.assertSemver(dto.version)
      await this.assertVersionAvailable(version.appId, version.channelId, dto.version, version.id)
    }
    version.version = dto.version ?? version.version
    version.title = dto.title ?? version.title
    version.notes = dto.notes ?? null
    version.forceUpdate = dto.forceUpdate ?? version.forceUpdate
    // channel 归属创建后不变：跨通道发布需新建版本（设计 §2.3）
    await this.versionRepository.save(version)
  }

  /** 删除版本：仅 draft 可删，连带软删包记录并同步清理 OSS 对象（含 blockmap） */
  async remove(id: string, userId: string): Promise<void> {
    const version = await this.getExistsVersion(id)
    await this.appService.assertAccessible(userId, version.appId)
    if (version.status !== VERSION_STATUS.DRAFT) {
      throw businessError('仅草稿版本允许删除（已发布版本先下线，下线版本保留历史）', {
        code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN,
      })
    }
    const packages = await this.packageRepository.find({ where: { versionId: id } })
    for (const pkg of packages) {
      await this.packageRepository.softRemove(pkg)
      await this.removePackageObjects(pkg)
    }
    await this.versionRepository.softRemove(version)
  }

  /** 发布：draft → published（前置校验：至少一个包记录（纯 web 应用除外）/ 通道内无已发布同号 / 框架产物完整） */
  async publish(id: string, userId: string): Promise<void> {
    const version = await this.getExistsVersion(id)
    const app = await this.appService.assertAccessible(userId, version.appId)
    if (version.status !== VERSION_STATUS.DRAFT) {
      throw businessError('仅草稿版本允许发布', { code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN })
    }
    const packages = await this.packageRepository.find({ where: { versionId: id } })

    // 前置校验一：至少挂一个包记录（web 平台无包记录、ios 仅登记元信息——存在记录即视为已上传完成；
    // 应用形态纯 web 时无分发需求，豁免该校验）
    const needPackage = app.appType.some(type => type !== PACKAGE_PLATFORM.WEB)
    if (needPackage && packages.length === 0) {
      throw businessError('发布前置校验未通过：版本下至少需要一个包记录（web 平台除外，设计 §3.2）', {
        code: AppcenterErrorCode.PUBLISH_NO_PACKAGE,
      })
    }

    // 前置校验二：通道内版本号未与已发布版本重复（并发窗口兜底，创建时查重已覆盖主路径）
    const duplicated = await this.versionRepository.findOne({
      where: { appId: version.appId, channelId: version.channelId, version: version.version, status: VERSION_STATUS.PUBLISHED },
    })
    if (duplicated && duplicated.id !== id) {
      throw businessError(AppcenterErrorCode.VERSION_DUPLICATE.message, {
        code: AppcenterErrorCode.VERSION_DUPLICATE,
      })
    }

    // 前置校验三：框架产物完整性（主张 A5：产物只能构建时生成，缺失返回 003004003）
    assertFrameworkArtifacts(app.framework, packages)

    version.status = VERSION_STATUS.PUBLISHED
    version.publishedAt = new Date()
    await this.versionRepository.save(version)
  }

  /** 下线：published → offline（终态；下线后客户端更新检测不再返回该版本） */
  async offline(id: string, userId: string): Promise<void> {
    const version = await this.getExistsVersion(id)
    await this.appService.assertAccessible(userId, version.appId)
    if (version.status !== VERSION_STATUS.PUBLISHED) {
      throw businessError('仅已发布版本允许下线', { code: AppcenterErrorCode.VERSION_STATUS_FORBIDDEN })
    }
    version.status = VERSION_STATUS.OFFLINE
    await this.versionRepository.save(version)
  }

  /**
   * 更新候选查询（自研协议与 D24 适配端点共用，设计 §3.4）：
   * 应用 + 通道 + 平台（+ 架构）下 published 且挂有匹配包的最新版本（semver 最大，内存比较）。
   * 通道不存在 / 停用 / 无候选均返回 null。
   */
  async findUpdateCandidate(input: {
    app: AppEntity
    channelCode: string
    platform: string
    arch: string | null
  }): Promise<UpdateCandidate | null> {
    const channel = await this.channelRepository.findOne({
      where: { appId: input.app.id, code: input.channelCode },
    })
    // 通道不存在或停用均视为无候选（?. 短路：无通道时 undefined !== enabled 成立）
    if (channel?.status !== CHANNEL_STATUS.ENABLED)
      return null
    const versions = await this.versionRepository.find({
      where: { appId: input.app.id, channelId: channel.id, status: VERSION_STATUS.PUBLISHED },
    })
    if (versions.length === 0)
      return null
    // web 平台无包记录（版本仅登记，更新检测只做提示，设计 §3.3）：版本本身即候选，跳过包过滤
    if (input.platform === PACKAGE_PLATFORM.WEB) {
      versions.sort((a, b) => rcompare(a.version, b.version))
      return { version: versions[0], packages: [] }
    }
    // 平台 + 架构匹配的包（arch 为 null 时须 IS NULL 匹配）
    const packages = await this.packageRepository.find({
      where: {
        versionId: In(versions.map(version => version.id)),
        platform: input.platform,
        arch: input.arch ?? IsNull(),
      },
    })
    const packagesByVersion = new Map<string, AppPackageEntity[]>()
    for (const pkg of packages) {
      const list = packagesByVersion.get(pkg.versionId) ?? []
      list.push(pkg)
      packagesByVersion.set(pkg.versionId, list)
    }
    // 候选 = 挂有匹配包的版本，semver 最大者（入库时已强制 semver，rcompare 安全）
    const candidates = versions.filter(version => (packagesByVersion.get(version.id)?.length ?? 0) > 0)
    if (candidates.length === 0)
      return null
    candidates.sort((a, b) => rcompare(a.version, b.version))
    const latest = candidates[0]
    return { version: latest, packages: packagesByVersion.get(latest.id) ?? [] }
  }

  /** semver 强制校验（MAJOR.MINOR.PATCH，可选预发布后缀） */
  private assertSemver(version: string): void {
    if (!validSemver(version)) {
      throw businessError(AppcenterErrorCode.VERSION_NOT_SEMVER.message, {
        code: AppcenterErrorCode.VERSION_NOT_SEMVER,
      })
    }
  }

  /** 通道内版本号查重：含软删历史（withDeleted，设计 §4.6——软删后版本号不可复用） */
  private async assertVersionAvailable(appId: string, channelId: string, version: string, excludeId?: string): Promise<void> {
    const where: FindOptionsWhere<AppVersionEntity> = { appId, channelId, version }
    if (excludeId)
      where.id = Not(excludeId)
    const duplicated = await this.versionRepository.findOne({ where, withDeleted: true })
    if (duplicated) {
      throw businessError(AppcenterErrorCode.VERSION_DUPLICATE.message, {
        code: AppcenterErrorCode.VERSION_DUPLICATE,
      })
    }
  }

  /** 清理包的 OSS 对象（安装包 + blockmap；对象不存在视为成功） */
  private async removePackageObjects(pkg: AppPackageEntity): Promise<void> {
    try {
      await this.storageService.deleteObject(pkg.ossObjectKey)
      if (pkg.blockmapObjectKey)
        await this.storageService.deleteObject(pkg.blockmapObjectKey)
    }
    catch (error) {
      // OSS 清理失败不阻断版本删除（软删记录保留对象键，后续可人工清理），留痕供人工跟进
      this.logger.warn(
        `删除版本时清理 OSS 对象失败（对象键 ${pkg.ossObjectKey}）：${error instanceof Error ? error.message : String(error)}`,
      )
    }
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

  /** 按主键查应用内通道：不存在（含跨应用）抛 CHANNEL_NOT_EXISTS */
  private async getExistsChannel(appId: string, channelId: string): Promise<AppChannelEntity> {
    const channel = await this.channelRepository.findOne({ where: { id: channelId, appId } })
    if (!channel) {
      throw businessError(AppcenterErrorCode.CHANNEL_NOT_EXISTS.message, {
        code: AppcenterErrorCode.CHANNEL_NOT_EXISTS,
      })
    }
    return channel
  }

  /** 应用内通道字典（列表回填 channelCode / channelName 用） */
  private async loadChannelMap(appId: string): Promise<Map<string, AppChannelEntity>> {
    const channels = await this.channelRepository.find({ where: { appId } })
    return new Map(channels.map(channel => [channel.id, channel]))
  }

  /** 实体转出参：白名单映射 + 通道信息回填 */
  private toVo(version: AppVersionEntity, channelMap: Map<string, AppChannelEntity>): VersionVo {
    const channel = channelMap.get(version.channelId)
    return {
      id: version.id,
      appId: version.appId,
      channelId: version.channelId,
      channelCode: channel?.code ?? '',
      channelName: channel?.name ?? '',
      version: version.version,
      title: version.title,
      notes: version.notes,
      forceUpdate: version.forceUpdate,
      status: version.status,
      publishedAt: version.publishedAt,
      createTime: version.createTime,
    }
  }
}
