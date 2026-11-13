/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 活跃事件上报控制器（开放 API）：应用级 HMAC 验签 + 可选会员态，按设备维度限流（设计 §4.1）
 */
import { Body, Controller, Headers, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { ActivityIngestService } from './activity-ingest.service'
import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator'
import { UseSignature } from '../../../common/signature/decorators/use-signature.decorator'
import type { ActivityReportVo } from '../activity/dto/activity.dto'
import { ActivityReportDto } from '../activity/dto/activity.dto'

@ApiTags('开放接口')
@Public()
@UseSignature('app')
// 限流按 AppKey + 设备维度（AT13）：明确阈值 120 次/分钟/设备，覆盖离线批量补报
@RateLimit({ appKeyFrom: 'header', deviceFrom: 'header', limit: 120 })
@Controller('open/app/activity')
export class ActivityReportController {
  constructor(private readonly ingestService: ActivityIngestService) {}

  @ApiOperation({ summary: '活跃事件上报（启动 / 窗口激活 / 退出，批量 ≤ 50 条；可选 Bearer 会员态）' })
  @Post('report')
  async report(
    @Headers('x-app-key') appKey: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: ActivityReportDto,
  ): Promise<ActivityReportVo> {
    return this.ingestService.report(appKey, authorization, dto)
  }
}
