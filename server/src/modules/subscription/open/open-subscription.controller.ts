/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅开放端点：应用内在售计划清单（主张 S9：仅 AppKey 签名免 access token——
 * 计划列表是商品橱窗，未登录浏览、登录后才下单；AppKey 经 X-App-Key 头携带）
 */
import { Controller, Get, Headers } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator'
import { UseSignature } from '../../../common/signature/decorators/use-signature.decorator'
import { APP_SCHEME_NAME } from '../../../common/signature/schemes/app-signature.scheme'
import type { OpenPlanVo } from '../plan/dto/plan.dto'
import { PlanService } from '../plan/plan.service'

@ApiTags('开放接口-订阅')
@Public()
@UseSignature(APP_SCHEME_NAME)
@RateLimit({ appKeyFrom: 'header' })
@Controller('open/subscription')
export class OpenSubscriptionController {
  constructor(private readonly planService: PlanService) {}

  @ApiOperation({ summary: '在售订阅计划清单（按 sort 升序）' })
  @Get('plans')
  async plans(@Headers('x-app-key') appKey: string): Promise<OpenPlanVo[]> {
    return this.planService.listOnShelf(appKey)
  }
}
