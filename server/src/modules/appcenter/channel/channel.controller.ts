/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 更新通道控制器：应用内通道的列表 / 创建 / 编辑 / 删除（stable 通道删除被服务层拒绝）
 */
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import { RequirePermissions } from '../../system/permissions'
import { APPCENTER_PERMISSION_CODES } from '../permissions'
import { ChannelService } from './channel.service'
// 注意：作为 @Query()/@Body() 元类型的 DTO 类必须值导入（import type 会在运行时擦除）
import { ChannelCreateDto, ChannelUpdateDto } from './dto/channel.dto'
import type { ChannelVo } from './dto/channel.dto'

@ApiTags('应用管理')
@Controller('appcenter/app/:id/channel')
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  @ApiOperation({ summary: '应用内通道列表' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.CHANNEL_QUERY)
  @Get()
  async list(@Param('id') appId: string): Promise<ChannelVo[]> {
    return this.channelService.list(appId)
  }

  @ApiOperation({ summary: '创建通道' })
  @OperateLog('应用管理', '新增通道')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.CHANNEL_CREATE)
  @Post()
  async create(@Param('id') appId: string, @Body() dto: ChannelCreateDto): Promise<string> {
    return this.channelService.create(appId, dto)
  }

  @ApiOperation({ summary: '编辑通道（code 不可改）' })
  @OperateLog('应用管理', '修改通道')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.CHANNEL_UPDATE)
  @Put(':channelId')
  async update(
    @Param('id') appId: string,
    @Param('channelId') channelId: string,
    @Body() dto: ChannelUpdateDto,
  ): Promise<void> {
    await this.channelService.update(appId, channelId, dto)
  }

  @ApiOperation({ summary: '删除通道（stable 不可删）' })
  @OperateLog('应用管理', '删除通道')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.CHANNEL_REMOVE)
  @Delete(':channelId')
  async remove(@Param('id') appId: string, @Param('channelId') channelId: string): Promise<void> {
    await this.channelService.remove(appId, channelId)
  }
}
