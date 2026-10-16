/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 超时订单兜底关单定时器（主张 S6）：每小时扫描超时 pending 单，惰性关单为主路径、
 * 定时扫描兜底（回调可能因网络丢失，查询路径也可能长期无人触达）；不引入 schedule 依赖
 */
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'

import { OrderService } from './order.service'
import { ORDER_SWEEP_INTERVAL_MS } from '../subscription.constants'

@Injectable()
export class OrderSweepTimer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OrderSweepTimer.name)
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly orderService: OrderService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.orderService.closeExpiredPending()
        .then((count) => {
          if (count > 0)
            this.logger.log(`兜底关单：关闭 ${count} 笔超时未支付订单`)
        })
        .catch((error: unknown) => {
          this.logger.warn(`兜底关单扫描失败：${error instanceof Error ? error.message : String(error)}`)
        })
    }, ORDER_SWEEP_INTERVAL_MS)
    // 不阻塞进程退出（CLI / 测试场景下事件循环不因定时器挂住）
    this.timer.unref?.()
  }

  onApplicationShutdown(): void {
    if (this.timer)
      clearInterval(this.timer)
  }
}
