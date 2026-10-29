/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用服务：注册（生成凭证 + 事务预置 stable 通道）、元数据维护、图标直传凭证与保存校验、启停、凭证轮换与删除保护
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Like } from 'typeorm'
import type { FindOptionsWhere, Repository } from 'typeorm'

import { generateAppKey, generateAppSecret } from './app-token.util'
import { businessError } from '../../../common/exceptions/business-error'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import type { AppOptionVo } from '../../system/app-scope/app-lookup.port'
import { AppScopeService } from '../../system/app-scope/app-scope.service'
import {
  APP_STATUS,
  CHANNEL_STATUS,
  ICON_MAX_BYTES,
  ICON_OBJECT_KEY_PREFIX,
  ICON_PREVIEW_EXPIRES_SECONDS,
  STABLE_CHANNEL_CODE,
  VERSION_STATUS,
  buildIconObjectKey,
} from '../appcenter.constants'
import { AppChannelEntity } from '../entities/app-channel.entity'
import { AppPackageEntity } from '../entities/app-package.entity'
import { AppVersionEntity } from '../entities/app-version.entity'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import { collectPackageTargets } from '../package/package-targets.util'
import type { PackageTargetVo } from '../package/package-targets.util'
import { STORAGE_SERVICE } from '../storage/storage.service'
import type { StorageService } from '../storage/storage.service'
import type {
  AppCreateDto,
  AppCredentialVo,
  AppOptionsDto,
  AppPageDto,
  AppUpdateDto,
  AppVo,
  IconUploadTokenDto,
  IconUploadTokenVo,
} from './dto/app.dto'

/** 可选应用下拉的最大返回条数（授权弹窗远程搜索与订阅页筛选，应用数量有限） */
const APP_OPTIONS_LIMIT = 200

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name)

  constructor(
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
    @InjectRepository(AppVersionEntity)
    private readonly versionRepository: Repository<AppVersionEntity>,
    @InjectRepository(AppPackageEntity)
    private readonly packageRepository: Repository<AppPackageEntity>,
    private readonly appScopeService: AppScopeService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  /**
   * 分页查询（名称模糊、状态 / 调用方类型 / 框架精确过滤）。
   * 数据范围收窄：SCOPED 时注入 `id IN (appIds)`，空集合直接返回空页（fail-closed，A5）。
   */
  async getPage(dto: AppPageDto, userId: string): Promise<PageResult<AppVo>> {
    const scopeAppIds = await this.appScopeService.getListAppIds(userId, 'appcenter')
    if (scopeAppIds !== null && scopeAppIds.length === 0)
      return { list: [], total: 0 }
    const where: FindOptionsWhere<AppEntity> = {}
    if (scopeAppIds !== null)
      where.id = In(scopeAppIds)
    if (dto.name !== undefined && dto.name !== '')
      where.name = Like(`%${dto.name}%`)
    if (dto.status !== undefined)
      where.status = dto.status
    if (dto.clientType !== undefined)
      where.clientType = dto.clientType
    if (dto.framework !== undefined)
      where.framework = dto.framework
    const [list, total] = await this.appRepository.findAndCount({
      where,
      skip: (dto.pageNo - 1) * dto.pageSize,
      take: dto.pageSize,
      order: { sort: 'ASC', createTime: 'DESC' },
    })
    const targetMap = await this.loadPackageTargets(list.map(app => app.id))
    return { list: list.map(app => this.toVo(app, targetMap.get(app.id) ?? [])), total }
  }

  /**
   * 当前用户可管理的应用精简列表（授权弹窗与订阅页应用筛选的数据源）；
   * keyword 同时匹配应用名称与 AppKey（远程搜索）。
   */
  async listOptions(dto: AppOptionsDto, userId: string): Promise<AppOptionVo[]> {
    const scopeAppIds = await this.appScopeService.getListAppIds(userId, 'appcenter')
    if (scopeAppIds !== null && scopeAppIds.length === 0)
      return []
    const base: FindOptionsWhere<AppEntity> = scopeAppIds !== null ? { id: In(scopeAppIds) } : {}
    const keyword = dto.keyword?.trim()
    const where: FindOptionsWhere<AppEntity> | FindOptionsWhere<AppEntity>[] = keyword
      ? [
          { ...base, name: Like(`%${keyword}%`) },
          { ...base, appKey: Like(`%${keyword}%`) },
        ]
      : base
    const apps = await this.appRepository.find({
      select: ['id', 'appKey', 'name'],
      where,
      order: { sort: 'ASC', createTime: 'DESC' },
      take: APP_OPTIONS_LIMIT,
    })
    return apps.map(app => ({ id: app.id, appKey: app.appKey, name: app.name }))
  }

  /** 应用详情（不含 Secret） */
  async get(id: string, userId: string): Promise<AppVo> {
    const app = await this.assertAccessible(userId, id)
    const targets = (await this.loadPackageTargets([app.id])).get(app.id) ?? []
    return this.toVo(app, targets)
  }

  /**
   * 应用级支持平台 / 架构（设计 §3.7 主张 A6）：仅聚合已发布版本的包记录，
   * 按版本 id 批量查包（两次查询覆盖整页，不做逐应用 N+1）。
   */
  private async loadPackageTargets(appIds: string[]): Promise<Map<string, PackageTargetVo[]>> {
    const result = new Map<string, PackageTargetVo[]>()
    if (appIds.length === 0)
      return result
    const versions = await this.versionRepository.find({
      where: { appId: In(appIds), status: VERSION_STATUS.PUBLISHED },
      select: ['id', 'appId'],
    })
    if (versions.length === 0)
      return result
    const appIdByVersionId = new Map(versions.map(version => [version.id, version.appId]))
    const packages = await this.packageRepository.find({
      where: { versionId: In([...appIdByVersionId.keys()]) },
      select: ['versionId', 'platform', 'arch'],
    })
    const packagesByAppId = new Map<string, Pick<AppPackageEntity, 'platform' | 'arch'>[]>()
    for (const pkg of packages) {
      const appId = appIdByVersionId.get(pkg.versionId)
      if (!appId)
        continue
      const rows = packagesByAppId.get(appId) ?? []
      rows.push(pkg)
      packagesByAppId.set(appId, rows)
    }
    for (const [appId, rows] of packagesByAppId)
      result.set(appId, collectPackageTargets(rows))
    return result
  }

  /**
   * 查看完整凭证（列表 `****` 掩码的按需数据源）：经数据范围校验后返回明文。
   * 单独端点而非并入列表 / 详情出参——Secret 不随每次列表刷新进入浏览器网络面板；
   * 调用方（控制器）负责记操作日志「查看应用凭证」。
   */
  async getSecret(id: string, userId: string): Promise<AppCredentialVo> {
    const app = await this.assertAccessible(userId, id)
    return { id: app.id, appKey: app.appKey, appSecret: app.appSecret }
  }

  /**
   * 签发图标直传凭证：对象键由后端生成（`icons/{yyyyMMdd}/{uuid}.{ext}`），
   * STS policy 收敛为该精确键（应用图标上传设计 IC2 / IC3）。
   */
  async issueIconUploadToken(dto: IconUploadTokenDto): Promise<IconUploadTokenVo> {
    const objectKey = buildIconObjectKey(dto.fileName)
    return this.storageService.issueIconUploadCredential(objectKey)
  }

  /**
   * 注册应用：生成 AppKey / Secret 并在事务内预置 stable 通道（主张 A1），响应携带完整凭证（列表恒为掩码，完整值可随时经 getSecret 查看）。
   */
  async create(dto: AppCreateDto): Promise<AppCredentialVo> {
    // 图标直传后回传对象键：落库前 HeadObject 兜底校验（存在 + 体积上限），网络调用置于事务外
    const iconUrl = await this.resolveIconValue(dto.iconUrl)
    const appKey = generateAppKey()
    const appSecret = generateAppSecret()
    const app = await this.appRepository.manager.transaction(async (manager) => {
      const saved = await manager.getRepository(AppEntity).save(
        manager.getRepository(AppEntity).create({
          appKey,
          appSecret,
          name: dto.name,
          appType: dto.appType,
          clientType: dto.clientType,
          framework: dto.framework ?? null,
          iconUrl,
          description: dto.description ?? null,
          status: APP_STATUS.ENABLED,
          sort: dto.sort ?? 0,
        }),
      )
      // 预置 stable 通道且不可删除：保证客户端默认有通道可用（主张 A1）
      await manager.getRepository(AppChannelEntity).save(
        manager.getRepository(AppChannelEntity).create({
          appId: saved.id,
          code: STABLE_CHANNEL_CODE,
          name: '稳定版',
          status: CHANNEL_STATUS.ENABLED,
          sort: 0,
        }),
      )
      return saved
    })
    return { id: app.id, appKey: app.appKey, appSecret: app.appSecret }
  }

  /** 编辑应用元数据（凭证与 AppKey 不在此变更）；图标被替换或清空时尽力清理旧对象 */
  async update(dto: AppUpdateDto, userId: string): Promise<void> {
    const app = await this.assertAccessible(userId, dto.id)
    const iconUrl = await this.resolveIconValue(dto.iconUrl)
    const previousIcon = app.iconUrl
    app.name = dto.name
    app.appType = dto.appType
    app.framework = dto.framework ?? null
    app.iconUrl = iconUrl
    app.description = dto.description ?? null
    app.sort = dto.sort ?? app.sort
    await this.appRepository.save(app)
    if (previousIcon && previousIcon !== iconUrl)
      await this.deleteIconObjectQuietly(previousIcon)
  }

  /** 启用 / 停用（停用后其开放 API 调用全部拒绝） */
  async updateStatus(id: string, status: string, userId: string): Promise<void> {
    const app = await this.assertAccessible(userId, id)
    app.status = status
    await this.appRepository.save(app)
  }

  /** 重置 Secret：旧 Secret 立即失效（D22），响应携带新完整凭证 */
  async resetSecret(id: string, userId: string): Promise<AppCredentialVo> {
    const app = await this.assertAccessible(userId, id)
    app.appSecret = generateAppSecret()
    await this.appRepository.save(app)
    return { id: app.id, appKey: app.appKey, appSecret: app.appSecret }
  }

  /** 删除应用：有已发布版本不允许删（先下线版本），软删（通道 / 版本历史保留可追溯） */
  async remove(id: string, userId: string): Promise<void> {
    const app = await this.assertAccessible(userId, id)
    const publishedCount = await this.versionRepository.count({
      where: { appId: id, status: VERSION_STATUS.PUBLISHED },
    })
    if (publishedCount > 0) {
      throw businessError(AppcenterErrorCode.APP_HAS_PUBLISHED_VERSION.message, {
        code: AppcenterErrorCode.APP_HAS_PUBLISHED_VERSION,
      })
    }
    await this.appRepository.softRemove(app)
    // 软删后清理图标对象：失败仅告警（记录已不可见，对象残留可人工清理）
    await this.deleteIconObjectQuietly(app.iconUrl)
  }

  /** 按 AppKey 查应用（开放 API 有效性校验与限流策略源用；不限状态——停用语义由开放层处理，软删行不可见） */
  async findByAppKey(appKey: string): Promise<AppEntity | null> {
    // 空值短路：TypeORM 会丢弃 undefined 的 where 条件退化为「任意一行」，缺 X-App-Key 的请求必须按无效 AppKey 拒绝
    if (!appKey)
      return null
    return this.appRepository.findOne({ where: { appKey } })
  }

  /**
   * 取当前用户可操作的应用：不存在（含已软删）抛 APP_NOT_EXISTS（404 优先）；
   * 存在但不在数据范围内抛 APP_SCOPE_FORBIDDEN（403，A11）。通道 / 版本 / 包服务复用此入口。
   */
  async assertAccessible(userId: string, appId: string): Promise<AppEntity> {
    const app = await this.getExistsApp(appId)
    await this.appScopeService.assertAppAllowed(userId, app.id, 'appcenter')
    return app
  }

  /**
   * 图标取值归一（应用图标上传设计 IC4 / IC6）：
   * - 空 → null；
   * - `icons/` 对象键 → HeadObject 校验存在与体积上限（RAM policy 无法限制上传体积，保存动作兜底）；
   * - `http(s)://` 外部地址 → 历史数据兼容，原样保留（无归属对象可校验）；
   * - 其余取值拒绝（前端已不再产生，防止脏值入库）。
   */
  private async resolveIconValue(input: string | undefined): Promise<string | null> {
    const value = input?.trim() ?? ''
    if (!value)
      return null
    if (value.startsWith(ICON_OBJECT_KEY_PREFIX)) {
      const head = await this.storageService.headObject(value)
      if (!head) {
        throw businessError(AppcenterErrorCode.ICON_OBJECT_NOT_EXISTS.message, {
          code: AppcenterErrorCode.ICON_OBJECT_NOT_EXISTS,
        })
      }
      if (head.contentLength > ICON_MAX_BYTES) {
        throw businessError(AppcenterErrorCode.ICON_TOO_LARGE.message, {
          code: AppcenterErrorCode.ICON_TOO_LARGE,
        })
      }
      return value
    }
    if (/^https?:\/\//i.test(value))
      return value
    throw businessError('图标地址格式不合法（须为上传后的对象键或 http(s) 地址）', {
      code: AppcenterErrorCode.ICON_INVALID_ADDRESS,
    })
  }

  /** 图标展示地址：对象键 → 签名 URL（2h）；历史外部地址原样；存储未配置等情况返回 null（不影响列表展示） */
  private buildIconPreviewUrl(iconUrl: string | null): string | null {
    if (!iconUrl)
      return null
    if (iconUrl.startsWith(ICON_OBJECT_KEY_PREFIX)) {
      try {
        return this.storageService.signGetUrl(iconUrl, ICON_PREVIEW_EXPIRES_SECONDS)
      }
      catch {
        return null
      }
    }
    return /^https?:\/\//i.test(iconUrl) ? iconUrl : null
  }

  /** 尽力删除旧图标对象：仅处理本域对象键，失败告警不阻断主流程（IC7） */
  private async deleteIconObjectQuietly(iconUrl: string | null): Promise<void> {
    if (!iconUrl?.startsWith(ICON_OBJECT_KEY_PREFIX))
      return
    try {
      await this.storageService.deleteObject(iconUrl)
    }
    catch (error) {
      this.logger.warn(`清理图标对象失败（对象键 ${iconUrl}）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 按主键查应用：不存在（含已软删）抛 APP_NOT_EXISTS */
  private async getExistsApp(id: string): Promise<AppEntity> {
    const app = await this.appRepository.findOne({ where: { id } })
    if (!app) {
      throw businessError(AppcenterErrorCode.APP_NOT_EXISTS.message, {
        code: AppcenterErrorCode.APP_NOT_EXISTS,
      })
    }
    return app
  }

  /** 实体转出参：白名单映射（Secret 永不出列表 / 详情；支持平台由调用方聚合后传入） */
  private toVo(app: AppEntity, packageTargets: PackageTargetVo[]): AppVo {
    return {
      id: app.id,
      appKey: app.appKey,
      name: app.name,
      appType: app.appType,
      clientType: app.clientType,
      framework: app.framework,
      packageTargets,
      iconUrl: app.iconUrl,
      iconPreviewUrl: this.buildIconPreviewUrl(app.iconUrl),
      description: app.description,
      status: app.status,
      sort: app.sort,
      createTime: app.createTime,
    }
  }
}
