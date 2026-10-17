/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 渠道回调端点（在线支付渠道接入附录 §5.3 / PY1）：微信 / 支付宝各一，双豁免（@Public +
 * @SkipSignature）不挂限流（回调来自渠道服务器无 AppKey，验签即防线）；经 @Res() 裸响应发送渠道
 * 协议原文（微信 200 JSON / 支付宝纯文本 success）——Nest 在 @Res 模式下跳过响应包装拦截器
 */
import { Controller, Post, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { PayCallbackService } from './pay-callback.service'
import { Public } from '../../../common/decorators/public.decorator'
import { SkipSignature } from '../../../common/signature/decorators/skip-signature.decorator'

/** main.ts rawBody: true 挂载的原始请求体（验签取原始字节） */
type RawBodyRequest = Request & { rawBody?: Buffer }

@ApiTags('支付回调')
@Controller('pay/callback')
@Public()
@SkipSignature()
export class PayCallbackController {
  constructor(private readonly callbackService: PayCallbackService) {}

  /** 微信支付结果通知：受理成功 200 + {"code":"SUCCESS"}；失败 500 + FAIL（渠道按退避重推） */
  @Post('wechat')
  async wechat(@Req() req: RawBodyRequest, @Res() res: Response): Promise<void> {
    const rawBody = req.rawBody
    if (!rawBody?.length) {
      res.status(500).json({ code: 'FAIL', message: 'empty body' })
      return
    }
    const ok = await this.callbackService.handleWechat(req.headers, rawBody)
    if (ok) {
      res.status(200).json({ code: 'SUCCESS' })
    }
    else {
      res.status(500).json({ code: 'FAIL', message: 'verify or accept failed' })
    }
  }

  /** 支付宝异步通知：受理成功纯文本 success；失败 failure（渠道重推） */
  @Post('alipay')
  async alipay(@Req() req: RawBodyRequest, @Res() res: Response): Promise<void> {
    const body: unknown = req.body
    if (!body || typeof body !== 'object') {
      res.status(200).send('failure')
      return
    }
    const ok = await this.callbackService.handleAlipay(body as Record<string, unknown>)
    res.status(200).send(ok ? 'success' : 'failure')
  }
}
