/*
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台控制器（薄壳）：取当前用户后转聚合服务，权限裁剪与范围收窄全部在 Service 内完成
 */
import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { DashboardService } from './dashboard.service'
import { DashboardQueryDto } from './dto/dashboard.dto'
import type { DashboardOverviewVo } from './dto/dashboard.dto'
import { DASHBOARD_PERMISSION_CODES } from './permissions'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../system/permissions'

@ApiTags('运营工作台')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: '工作台聚合概览（待办 / 指标 / sparkline / 最新动态，按权限裁剪与数据范围收窄）' })
  @RequirePermissions(DASHBOARD_PERMISSION_CODES.OVERVIEW_QUERY)
  @Get('overview')
  async getOverview(
    @Query() query: DashboardQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DashboardOverviewVo> {
    return this.dashboardService.getOverview(query.range ?? '7d', user.id)
  }
}
