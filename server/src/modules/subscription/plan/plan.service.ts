/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅计划服务：管理端 CRUD（按应用维度）与开放端点在售清单（订阅与支付设计 §3.5、§3.1）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Like, type FindOptionsWhere, type Repository } from 'typeorm'

import type { CreatePlanDto, OpenPlanVo, PlanPageDto, PlanVo, UpdatePlanDto } from './dto/plan.dto'
import { businessError } from '../../../common/exceptions/business-error'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { AppEntity } from '../../appcenter/entities/app.entity'
import { AppcenterErrorCode } from '../../appcenter/error-codes'
import { SubPlanEntity } from '../entities/sub-plan.entity'
import { SubscriptionErrorCode } from '../error-codes'
import { PERIOD_MONTHS, PLAN_STATUS, type PeriodType } from '../subscription.constants'

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(SubPlanEntity)
    private readonly planRepository: Repository<SubPlanEntity>,
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
  ) {}

  /** 计划分页列表（应用 / 关键字 / 状态筛选，带应用名回显） */
  async getPage(dto: PlanPageDto): Promise<PageResult<PlanVo>> {
    const where: FindOptionsWhere<SubPlanEntity> = {}
    if (dto.appId)
      where.appId = dto.appId
    if (dto.keyword)
      where.name = Like(`%${dto.keyword}%`)
    if (dto.status)
      where.status = dto.status
    const [list, total] = await this.planRepository.findAndCount({
      where,
      skip: (dto.pageNo - 1) * dto.pageSize,
      take: dto.pageSize,
      order: { sort: 'ASC', createTime: 'DESC' },
    })
    const appMap = await this.loadAppMap(list.map(plan => plan.appId))
    return { list: list.map(plan => this.toVo(plan, appMap)), total }
  }

  /** 新建计划（durationMonths 按档位服务端映射，不信任前端） */
  async create(dto: CreatePlanDto): Promise<string> {
    await this.getExistsApp(dto.appId)
    const plan = await this.planRepository.save(
      this.planRepository.create({
        appId: dto.appId,
        name: dto.name,
        periodType: dto.periodType,
        durationMonths: this.mapDurationMonths(dto.periodType),
        price: dto.price,
        originalPrice: dto.originalPrice ?? null,
        status: PLAN_STATUS.ON,
        sort: dto.sort ?? 0,
        remark: dto.remark ?? null,
      }),
    )
    return plan.id
  }

  /** 编辑计划（改名 / 改价只影响此后新订单，历史订单与对账不受影响——快照设计 §4.3） */
  async update(id: string, dto: UpdatePlanDto): Promise<void> {
    const plan = await this.getExistsPlan(id)
    plan.name = dto.name
    plan.periodType = dto.periodType
    plan.durationMonths = this.mapDurationMonths(dto.periodType)
    plan.price = dto.price
    plan.originalPrice = dto.originalPrice ?? null
    plan.status = dto.status
    plan.sort = dto.sort ?? plan.sort
    plan.remark = dto.remark ?? null
    await this.planRepository.save(plan)
  }

  /** 删除计划（软删；存量订阅不受影响，订单侧以快照引用） */
  async remove(id: string): Promise<void> {
    await this.getExistsPlan(id)
    await this.planRepository.softDelete(id)
  }

  /** 开放端点在售清单（主张 S9：仅 AppKey 签名；停用应用一并拒绝） */
  async listOnShelf(appKey: string): Promise<OpenPlanVo[]> {
    const app = await this.appRepository.findOne({ where: { appKey } })
    if (!app) {
      throw businessError(AppcenterErrorCode.APP_NOT_EXISTS.message, {
        code: AppcenterErrorCode.APP_NOT_EXISTS,
      })
    }
    if (app.status !== 'enabled') {
      throw businessError(AppcenterErrorCode.APP_DISABLED.message, {
        code: AppcenterErrorCode.APP_DISABLED,
      })
    }
    const plans = await this.planRepository.find({
      where: { appId: app.id, status: PLAN_STATUS.ON },
      order: { sort: 'ASC', createTime: 'DESC' },
    })
    return plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      periodType: plan.periodType,
      durationMonths: plan.durationMonths,
      price: plan.price,
      originalPrice: plan.originalPrice,
      remark: plan.remark,
    }))
  }

  /** 周期档位 → 日历月数（permanent 为 null） */
  private mapDurationMonths(periodType: string): number | null {
    return periodType === 'permanent' ? null : PERIOD_MONTHS[periodType as Exclude<PeriodType, 'permanent'>]
  }

  private async getExistsApp(appId: string): Promise<AppEntity> {
    const app = await this.appRepository.findOne({ where: { id: appId } })
    if (!app) {
      throw businessError(AppcenterErrorCode.APP_NOT_EXISTS.message, {
        code: AppcenterErrorCode.APP_NOT_EXISTS,
      })
    }
    return app
  }

  private async getExistsPlan(id: string): Promise<SubPlanEntity> {
    const plan = await this.planRepository.findOne({ where: { id } })
    if (!plan) {
      throw businessError(SubscriptionErrorCode.PLAN_NOT_EXISTS.message, {
        code: SubscriptionErrorCode.PLAN_NOT_EXISTS,
      })
    }
    return plan
  }

  /** 批量回显应用名（关联应用被软删时名称缺失显示占位） */
  private async loadAppMap(appIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(appIds)]
    if (uniqueIds.length === 0)
      return new Map()
    const apps = await this.appRepository.find({
      select: ['id', 'name'],
      where: { id: In(uniqueIds) },
      withDeleted: true,
    })
    return new Map(apps.map(app => [app.id, app.name]))
  }

  private toVo(plan: SubPlanEntity, appMap: Map<string, string>): PlanVo {
    return {
      id: plan.id,
      appId: plan.appId,
      appName: appMap.get(plan.appId) ?? '（应用已删除）',
      name: plan.name,
      periodType: plan.periodType,
      durationMonths: plan.durationMonths,
      price: plan.price,
      originalPrice: plan.originalPrice,
      status: plan.status,
      sort: plan.sort,
      remark: plan.remark,
      createTime: plan.createTime,
    }
  }
}
