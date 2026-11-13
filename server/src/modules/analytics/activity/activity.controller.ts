/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 活跃度查询控制器（薄壳）：概览与维度分布，权限与数据范围收窄在 Guard / Service 完成（设计 §5）
 */
import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { ActivityService } from './activity.service'
import { ActivityDistributionQueryDto, ActivityRangeQueryDto } from './dto/activity.dto'
import type { ActivityDistributionItemVo, ActivitySummaryVo } from './dto/activity.dto'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../system/permissions'
import { ANALYTICS_PERMISSION_CODES } from '../permissions'

@ApiTags('应用活跃度')
@RequirePermissions(ANALYTICS_PERMISSION_CODES.ACTIVITY_QUERY)
@Controller('analytics/activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @ApiOperation({ summary: '活跃度概览（DAU / 区间活跃 / 新增设备 / 定长趋势）' })
  @Get('summary')
  async getSummary(
    @Query() query: ActivityRangeQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ActivitySummaryVo> {
    return this.activityService.getSummary(query, user.id)
  }

  @ApiOperation({ summary: '活跃度维度分布（平台 / 架构 / 版本）' })
  @Get('distribution')
  async getDistribution(
    @Query() query: ActivityDistributionQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ActivityDistributionItemVo[]> {
    return this.activityService.getDistribution(query, user.id)
  }
}
