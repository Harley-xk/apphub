/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用控制器：分页 / 详情 / 查看凭证 / 注册 / 编辑 / 启停 / 凭证重置 / 删除（列表和详情不含 Secret，完整凭证经查看 / 注册 / 重置返回）
 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../../common/decorators/current-user.decorator'
import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import type { AppOptionVo } from '../../system/app-scope/app-lookup.port'
import { RequirePermissions } from '../../system/permissions'
import { APPCENTER_PERMISSION_CODES } from '../permissions'
// 注意：作为 @Query()/@Body() 元类型的 DTO 类必须值导入（import type 会在运行时擦除，
// design:paramtypes 退化为 Object，ValidationPipe 的 whitelist 将拒绝全部字段）
import { AppService } from './app.service'
import { AppCreateDto, AppOptionsDto, AppPageDto, AppStatusDto, AppUpdateDto } from './dto/app.dto'
import type { AppCredentialVo, AppVo } from './dto/app.dto'

@ApiTags('应用管理')
@Controller('appcenter/app')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: '应用分页列表（按数据范围收窄）' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_QUERY)
  @Get()
  async getPage(@Query() dto: AppPageDto, @CurrentUser() user: AuthUser): Promise<PageResult<AppVo>> {
    return this.appService.getPage(dto, user.id)
  }

  // 注意：固定路径须声明在 :id 之前，否则被 :id 吞掉
  @ApiOperation({ summary: '当前用户可管理的应用精简列表（授权弹窗 / 订阅页筛选）' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_QUERY)
  @Get('options')
  async listOptions(@Query() dto: AppOptionsDto, @CurrentUser() user: AuthUser): Promise<AppOptionVo[]> {
    return this.appService.listOptions(dto, user.id)
  }

  @ApiOperation({ summary: '应用详情（不含 Secret）' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_QUERY)
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<AppVo> {
    return this.appService.get(id, user.id)
  }

  // 两段路径 `:id/secret` 与单段 `GET :id` 不冲突（单段路由不匹配多段路径）
  @ApiOperation({ summary: '查看应用完整凭证（列表 **** 掩码的按需数据源）' })
  @OperateLog('应用管理', '查看应用凭证')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_QUERY)
  @Get(':id/secret')
  async getSecret(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<AppCredentialVo> {
    return this.appService.getSecret(id, user.id)
  }

  @ApiOperation({ summary: '注册应用（响应含完整凭证）' })
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
  async update(@Param('id') id: string, @Body() dto: AppUpdateDto, @CurrentUser() user: AuthUser): Promise<void> {
    await this.appService.update(dto, user.id)
  }

  @ApiOperation({ summary: '启用 / 停用应用' })
  @OperateLog('应用管理', '修改应用状态')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_TOGGLE_STATUS)
  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() dto: AppStatusDto, @CurrentUser() user: AuthUser): Promise<void> {
    await this.appService.updateStatus(id, dto.status, user.id)
  }

  @ApiOperation({ summary: '重置 Secret（旧凭证立即失效，响应含新完整凭证）' })
  @OperateLog('应用管理', '重置应用凭证')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_RESET_SECRET)
  @Put(':id/secret')
  async resetSecret(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<AppCredentialVo> {
    return this.appService.resetSecret(id, user.id)
  }

  @ApiOperation({ summary: '删除应用（有已发布版本不允许删）' })
  @OperateLog('应用管理', '删除应用')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.APP_REMOVE)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.appService.remove(id, user.id)
  }
}
