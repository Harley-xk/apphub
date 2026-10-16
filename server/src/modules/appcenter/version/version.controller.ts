/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 版本控制器（应用作用域）：应用内版本分页列表与创建（跨通道发布需新建版本）
 */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { RequirePermissions } from '../../system/permissions'
import { APPCENTER_PERMISSION_CODES } from '../permissions'
// 注意：作为 @Query()/@Body() 元类型的 DTO 类必须值导入（import type 会在运行时擦除）
import { VersionCreateDto, VersionPageDto } from './dto/version.dto'
import type { VersionVo } from './dto/version.dto'
import { VersionService } from './version.service'

@ApiTags('应用管理')
@Controller('appcenter/app/:id/version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @ApiOperation({ summary: '应用内版本分页列表（通道 / 状态过滤）' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_QUERY)
  @Get()
  async getPage(@Param('id') appId: string, @Query() dto: VersionPageDto): Promise<PageResult<VersionVo>> {
    return this.versionService.getPage(appId, dto)
  }

  @ApiOperation({ summary: '创建草稿版本（semver 强制校验）' })
  @OperateLog('应用管理', '新增版本')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_CREATE)
  @Post()
  async create(@Param('id') appId: string, @Body() dto: VersionCreateDto): Promise<string> {
    return this.versionService.create(appId, dto)
  }
}
