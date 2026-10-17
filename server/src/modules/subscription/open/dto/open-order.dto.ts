/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅开放端点下单 / 轮询 DTO（在线支付渠道接入附录 §5.1 / §5.2）
 */
import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsString, IsUUID, Length } from 'class-validator'

/** 在线下单入参（member 来自令牌，appKey 来自 X-App-Key 验签层） */
export class OnlineOrderCreateDto {
  @ApiProperty({ description: '订阅计划 id' })
  @IsUUID()
  planId!: string

  @ApiProperty({ description: '支付渠道（wechat / alipay）' })
  @IsIn(['wechat', 'alipay'], { message: '支付渠道仅支持 wechat / alipay' })
  channel!: string
}

/** 在线下单出参：应用侧拿 qrCodeUrl 自行渲染二维码 */
export interface OnlineOrderCreateVo {
  orderNo: string
  /** 应付金额（分） */
  amount: number
  /** 二维码内容串（微信 code_url / 支付宝 qr_code / Mock mock://） */
  qrCodeUrl: string
  /** 待支付过期时刻（ISO 字符串，超时自动关单） */
  expireAt: string
}

/** 订单轮询入参 */
export class OnlineOrderQueryDto {
  @ApiProperty({ description: '订单号' })
  @IsString()
  @Length(1, 32, { message: '订单号长度非法' })
  orderNo!: string
}

/** 订单轮询出参（不含订阅信息——确认 paid 后走 introspect 取订阅态） */
export interface OnlineOrderQueryVo {
  /** pending / paid / closed */
  status: string
  /** 支付完成时刻（ISO 字符串，paid 时返回） */
  paidAt?: string | null
}
