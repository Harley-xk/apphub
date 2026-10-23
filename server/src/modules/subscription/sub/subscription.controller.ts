/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅实例管理控制器：实例分页列表（含已过期打标，状态实时推导，订阅与支付设计 §3.5）
 */
import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { SubscriptionPageDto } from './dto/subscription.dto'
import type { SubscriptionVo } from './dto/subscription.dto'
import { SubscriptionService } from './subscription.service'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../../common/decorators/current-user.decorator'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { RequirePermissions } from '../../system/permissions'
import { SUBSCRIPTION_PERMISSION_CODES } from '../permissions'

@ApiTags('订阅实例管理')
@Controller('subscription/sub')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @ApiOperation({ summary: '订阅实例分页列表（有效 / 已过期打标）' })
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.SUB_QUERY)
  @Get()
  async getPage(@Query() dto: SubscriptionPageDto, @CurrentUser() user: AuthUser): Promise<PageResult<SubscriptionVo>> {
    return this.subscriptionService.getPage(dto, user.id)
  }
}
