/*
 * 作者: Harley-xk
 * 创建: 2026-10-23
 *
 * 描述: 应用查找端口实现：供 system 模块的应用授权接口校验应用存在性与回显精简信息（端口注册见 §9）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In } from 'typeorm'
import type { Repository } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
import type { AppLookupPort, AppOptionVo } from '../../system/app-scope/app-lookup.port'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'

@Injectable()
export class AppLookupService implements AppLookupPort {
  constructor(
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
  ) {}

  /** 断言应用全部存在且未软删（授权写入校验；错误码归 appcenter 应用子域） */
  async assertAppsExist(appIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(appIds)]
    if (uniqueIds.length === 0)
      return
    const found = await this.appRepository.find({ select: ['id'], where: { id: In(uniqueIds) } })
    if (found.length !== uniqueIds.length) {
      throw businessError(AppcenterErrorCode.APP_NOT_EXISTS.message, {
        code: AppcenterErrorCode.APP_NOT_EXISTS,
      })
    }
  }

  /** 按 id 批量取应用精简信息（软删应用不可见，授权回显自然失效） */
  async listAppsByIds(appIds: string[]): Promise<AppOptionVo[]> {
    const uniqueIds = [...new Set(appIds)]
    if (uniqueIds.length === 0)
      return []
    const apps = await this.appRepository.find({
      select: ['id', 'appKey', 'name'],
      where: { id: In(uniqueIds) },
    })
    return apps.map(app => ({ id: app.id, appKey: app.appKey, name: app.name }))
  }
}
