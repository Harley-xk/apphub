/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅计划管理控制器：分页 / 新增 / 修改 / 删除（订阅与支付设计 §3.5）
 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { CreatePlanDto, PlanPageDto, UpdatePlanDto } from './dto/plan.dto'
import type { PlanVo } from './dto/plan.dto'
import { PlanService } from './plan.service'
import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { RequirePermissions } from '../../system/permissions'
import { SUBSCRIPTION_PERMISSION_CODES } from '../permissions'

@ApiTags('订阅计划管理')
@Controller('subscription/plan')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @ApiOperation({ summary: '计划分页列表（应用 / 关键字 / 状态筛选）' })
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.PLAN_QUERY)
  @Get()
  async getPage(@Query() dto: PlanPageDto): Promise<PageResult<PlanVo>> {
    return this.planService.getPage(dto)
  }

  @ApiOperation({ summary: '新建计划（默认在售）' })
  @OperateLog('订阅计划管理', '新建计划')
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.PLAN_CREATE)
  @Post()
  async create(@Body() dto: CreatePlanDto): Promise<string> {
    return this.planService.create(dto)
  }

  @ApiOperation({ summary: '编辑计划（改名改价只影响此后新订单）' })
  @OperateLog('订阅计划管理', '编辑计划')
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.PLAN_UPDATE)
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto): Promise<void> {
    await this.planService.update(id, dto)
  }

  @ApiOperation({ summary: '删除计划（软删，存量订阅不受影响）' })
  @OperateLog('订阅计划管理', '删除计划')
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.PLAN_REMOVE)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.planService.remove(id)
  }
}
