/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅开放端点：应用内在售计划清单（主张 S9：仅 AppKey 签名免 access token——
 * 计划列表是商品橱窗，未登录浏览、登录后才下单；AppKey 经 X-App-Key 头携带）与
 * 在线下单 / 订单轮询（M5，叠加 MemberAuthGuard 用户态，在线支付渠道接入附录 §5.1 / §5.2）
 */
import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { OnlineOrderCreateDto, OnlineOrderQueryDto } from './dto/open-order.dto'
import type { OnlineOrderCreateVo, OnlineOrderQueryVo } from './dto/open-order.dto'
import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator'
import { UseSignature } from '../../../common/signature/decorators/use-signature.decorator'
import { APP_SCHEME_NAME } from '../../../common/signature/schemes/app-signature.scheme'
import { CurrentMember, type AuthMember } from '../../member/auth/current-member.decorator'
import { MemberAuthGuard } from '../../member/auth/member-auth.guard'
import { OrderService } from '../order/order.service'
import type { OpenPlanVo } from '../plan/dto/plan.dto'
import { PlanService } from '../plan/plan.service'
// DTO 必须值导入：@Body() 参数元数据经 reflect-metadata 运行时读取（import type 会被剥离导致校验白名单丢失）

@ApiTags('开放接口-订阅')
@Public()
@UseSignature(APP_SCHEME_NAME)
@RateLimit({ appKeyFrom: 'header' })
@Controller('open/subscription')
export class OpenSubscriptionController {
  constructor(
    private readonly planService: PlanService,
    private readonly orderService: OrderService,
  ) {}

  @ApiOperation({ summary: '在售订阅计划清单（按 sort 升序）' })
  @Get('plans')
  async plans(@Headers('x-app-key') appKey: string): Promise<OpenPlanVo[]> {
    return this.planService.listOnShelf(appKey)
  }

  @ApiOperation({ summary: '在线下单（微信 Native / 支付宝当面付，返回二维码内容串）' })
  @UseGuards(MemberAuthGuard)
  @Post('order/create')
  async createOrder(
    @CurrentMember() member: AuthMember,
    @Body() dto: OnlineOrderCreateDto,
  ): Promise<OnlineOrderCreateVo> {
    return this.orderService.createOnlineOrder(member, dto)
  }

  @ApiOperation({ summary: '订单支付状态轮询（pending 时按节流顺带向渠道查单）' })
  @UseGuards(MemberAuthGuard)
  @Post('order/query')
  async queryOrder(
    @CurrentMember() member: AuthMember,
    @Body() dto: OnlineOrderQueryDto,
  ): Promise<OnlineOrderQueryVo> {
    return this.orderService.queryOnlineOrderStatus(member, dto.orderNo)
  }
}
