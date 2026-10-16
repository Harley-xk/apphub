/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用控制器：分页 / 详情 / 注册 / 编辑 / 启停 / 凭证重置 / 删除（注册与重置响应完整凭证，仅此一次）
 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { RequirePermissions } from '../../system/permissions'
import { APPCENTER_PERMISSION_CODES } from '../permissions'
// 注意：作为 @Query()/@Body() 元类型的 DTO 类必须值导入（import type 会在运行时擦除，
// design:paramtypes 退化为 Object，ValidationPipe 的 whitelist 将拒绝全部字段）
import { AppService } from './app.service'
import { AppCreateDto, AppPageDto, AppStatusDto, AppUpdateDto } from './dto/app.dto'
import type { AppCredentialVo, AppVo } from './dto/app.dto'

@ApiTags('应用管理')
@Controller('appcenter/app')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: '应用分页列表' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_QUERY)
  @Get()
  async getPage(@Query() dto: AppPageDto): Promise<PageResult<AppVo>> {
    return this.appService.getPage(dto)
  }

  @ApiOperation({ summary: '应用详情（不含 Secret）' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_QUERY)
  @Get(':id')
  async get(@Param('id') id: string): Promise<AppVo> {
    return this.appService.get(id)
  }

  @ApiOperation({ summary: '注册应用（响应含完整凭证，仅此一次）' })
  @OperateLog('应用管理', '注册应用')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_CREATE)
  @Post()
  async create(@Body() dto: AppCreateDto): Promise<AppCredentialVo> {
    return this.appService.create(dto)
  }

  @ApiOperation({ summary: '编辑应用元数据' })
  @OperateLog('应用管理', '修改应用')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_UPDATE)
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: AppUpdateDto): Promise<void> {
    await this.appService.update(dto)
  }

  @ApiOperation({ summary: '启用 / 停用应用' })
  @OperateLog('应用管理', '修改应用状态')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_UPDATE)
  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() dto: AppStatusDto): Promise<void> {
    await this.appService.updateStatus(id, dto.status)
  }

  @ApiOperation({ summary: '重置 Secret（旧凭证立即失效，响应含新完整凭证，仅此一次）' })
  @OperateLog('应用管理', '重置应用凭证')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_RESET_SECRET)
  @Put(':id/secret')
  async resetSecret(@Param('id') id: string): Promise<AppCredentialVo> {
    return this.appService.resetSecret(id)
  }

  @ApiOperation({ summary: '删除应用（有已发布版本不允许删）' })
  @OperateLog('应用管理', '删除应用')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_REMOVE)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.appService.remove(id)
  }
}
