/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用服务：注册（生成凭证 + 事务预置 stable 通道）、元数据维护、启停、凭证轮换与删除保护
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Like } from 'typeorm'
import type { FindOptionsWhere, Repository } from 'typeorm'

import { generateAppKey, generateAppSecret } from './app-token.util'
import { businessError } from '../../../common/exceptions/business-error'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import type { AppOptionVo } from '../../system/app-scope/app-lookup.port'
import { AppScopeService } from '../../system/app-scope/app-scope.service'
import { APP_STATUS, CHANNEL_STATUS, STABLE_CHANNEL_CODE, VERSION_STATUS } from '../appcenter.constants'
import { AppChannelEntity } from '../entities/app-channel.entity'
import { AppVersionEntity } from '../entities/app-version.entity'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import type { AppCreateDto, AppCredentialVo, AppOptionsDto, AppPageDto, AppUpdateDto, AppVo } from './dto/app.dto'

/** 可选应用下拉的最大返回条数（授权弹窗远程搜索与订阅页筛选，应用数量有限） */
const APP_OPTIONS_LIMIT = 200

@Injectable()
export class AppService {
  constructor(
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
    @InjectRepository(AppVersionEntity)
    private readonly versionRepository: Repository<AppVersionEntity>,
    private readonly appScopeService: AppScopeService,
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
    return { list: list.map(app => this.toVo(app)), total }
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
    return this.toVo(await this.assertAccessible(userId, id))
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
   * 注册应用：生成 AppKey / Secret 并在事务内预置 stable 通道（主张 A1），响应携带完整凭证（列表恒为掩码，完整值可随时经 getSecret 查看）。
   */
  async create(dto: AppCreateDto): Promise<AppCredentialVo> {
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
          iconUrl: dto.iconUrl ?? null,
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

  /** 编辑应用元数据（凭证与 AppKey 不在此变更） */
  async update(dto: AppUpdateDto, userId: string): Promise<void> {
    const app = await this.assertAccessible(userId, dto.id)
    app.name = dto.name
    app.appType = dto.appType
    app.framework = dto.framework ?? null
    app.iconUrl = dto.iconUrl ?? null
    app.description = dto.description ?? null
    app.sort = dto.sort ?? app.sort
    await this.appRepository.save(app)
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

  /** 实体转出参：白名单映射（Secret 永不出列表 / 详情） */
  private toVo(app: AppEntity): AppVo {
    return {
      id: app.id,
      appKey: app.appKey,
      name: app.name,
      appType: app.appType,
      clientType: app.clientType,
      framework: app.framework,
      iconUrl: app.iconUrl,
      description: app.description,
      status: app.status,
      sort: app.sort,
      createTime: app.createTime,
    }
  }
}
