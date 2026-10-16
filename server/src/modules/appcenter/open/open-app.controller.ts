/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 开放应用控制器：自研协议更新检测端点（豁免签名与 JWT 的救生通道，D23；按 AppKey + IP 限流）
 */
import { Body, Controller, Headers, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

// 注意：作为 @Query()/@Body() 元类型的 DTO 类必须值导入（import type 会在运行时擦除）
import { VersionCheckDto } from './dto/open.dto'
import type { CheckVersionVo } from './dto/open.dto'
import { OpenUpdateService } from './open-update.service'
import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator'
import { SkipSignature } from '../../../common/signature/decorators/skip-signature.decorator'

@ApiTags('开放接口')
@Public()
@SkipSignature()
@RateLimit({ appKeyFrom: 'header' })
@Controller('open/app')
export class OpenAppController {
  constructor(private readonly openUpdateService: OpenUpdateService) {}

  @ApiOperation({ summary: '更新检测（自研协议，AppKey 经 X-App-Key 头携带）' })
  @Post('version/check')
  async check(
    @Headers('x-app-key') appKey: string,
    @Body() dto: VersionCheckDto,
  ): Promise<CheckVersionVo> {
    return this.openUpdateService.checkVersion(appKey, dto)
  }
}
