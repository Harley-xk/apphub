/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: Mock 支付触发端点（在线支付渠道接入附录 §5.4 / P8 / PY14）：POST /api/pay/mock/settle
 * 按 orderNo 直达 markPaid 同一幂等逻辑；仅非生产环境由模块条件注册（生产无此路由），
 * 对任意渠道 pending 单生效（非生产下真实渠道也可能是 Mock 装配）
 */
import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

import { Public } from '../../../common/decorators/public.decorator'
import { SkipSignature } from '../../../common/signature/decorators/skip-signature.decorator'
import type { MarkPaidResult } from '../order/dto/order.dto'
import { OrderService } from '../order/order.service'

/** mock 结算入参 */
export class MockSettleDto {
  @IsString()
  @Length(1, 32, { message: '订单号长度非法' })
  orderNo!: string
}

/** mock 结算结果（markPaid 三态原样透出，幂等可重试） */
export interface MockSettleVo {
  result: MarkPaidResult
}

@ApiTags('支付-Mock（非生产）')
@Public()
@SkipSignature()
@Controller('pay/mock')
export class PayMockSettleController {
  constructor(private readonly orderService: OrderService) {}

  @ApiOperation({ summary: '触发 Mock 支付结算（仅非生产环境注册，走 markPaid 同一幂等逻辑）' })
  @Post('settle')
  async settle(@Body() dto: MockSettleDto): Promise<MockSettleVo> {
    // Mock 是模拟器：金额传 null 跳过核对（模拟实收恒等于订单额）
    const result = await this.orderService.markPaid(dto.orderNo, `MOCK-${Date.now()}`, null)
    return { result }
  }
}
