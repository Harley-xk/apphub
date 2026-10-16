/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅订单管理控制器：分页 / 线下收款备案 / 手动关单（订阅与支付设计 §3.5）；
 * 在线支付下单 / 查询 / 渠道回调端点 M5 随 SDK 交付（主张 S4）
 */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { OfflineCreateDto, OrderPageDto } from './dto/order.dto'
import type { OrderVo } from './dto/order.dto'
import { OrderService } from './order.service'
import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { RequirePermissions } from '../../system/permissions'
import { SUBSCRIPTION_PERMISSION_CODES } from '../permissions'

@ApiTags('订阅订单管理')
@Controller('subscription/order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @ApiOperation({ summary: '订单分页列表（渠道 / 状态 / 应用 / 会员 / 订单号筛选）' })
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.ORDER_QUERY)
  @Get()
  async getPage(@Query() dto: OrderPageDto): Promise<PageResult<OrderVo>> {
    return this.orderService.getPage(dto)
  }

  @ApiOperation({ summary: '线下收款备案（创建 offline 订单并直接 paid，订阅即时顺延）' })
  @OperateLog('订阅订单管理', '线下收款备案')
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.ORDER_OFFLINE_CREATE)
  @Post('offline')
  async createOfflineOrder(@Body() dto: OfflineCreateDto): Promise<OrderVo> {
    return this.orderService.createOfflineOrder(dto)
  }

  @ApiOperation({ summary: '手动关闭待支付订单' })
  @OperateLog('订阅订单管理', '手动关闭订单')
  @RequirePermissions(SUBSCRIPTION_PERMISSION_CODES.ORDER_CLOSE)
  @Post(':id/close')
  async closeOrder(@Param('id') id: string): Promise<void> {
    await this.orderService.closeOrder(id)
  }
}
