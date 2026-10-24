/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 版本操作控制器（版本作用域）：编辑（状态机分流）/ 删除（仅 draft）/ 发布 / 下线
 */
import { Body, Controller, Delete, Param, Post, Put } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { VersionUpdateDto } from './dto/version.dto'
import { VersionService } from './version.service'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../../common/decorators/current-user.decorator'
import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import { RequirePermissions } from '../../system/permissions'
import { APPCENTER_PERMISSION_CODES } from '../permissions'
// 注意：作为 @Query()/@Body() 元类型的 DTO 类必须值导入（import type 会在运行时擦除）

@ApiTags('应用管理')
@Controller('appcenter/version')
export class VersionActionController {
  constructor(private readonly versionService: VersionService) {}

  @ApiOperation({ summary: '编辑版本（draft 任意编辑；published 仅说明与强制标记；offline 终态）' })
  @OperateLog('应用管理', '修改版本')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_UPDATE)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: VersionUpdateDto,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.versionService.update({ ...dto, id }, user.id)
  }

  @ApiOperation({ summary: '删除版本（仅草稿，连带清理包记录与 OSS 对象）' })
  @OperateLog('应用管理', '删除版本')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_REMOVE)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.versionService.remove(id, user.id)
  }

  @ApiOperation({ summary: '发布版本（前置校验：包记录 / 框架产物完整）' })
  @OperateLog('应用管理', '发布版本')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_PUBLISH)
  @Post(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.versionService.publish(id, user.id)
  }

  @ApiOperation({ summary: '下线版本（终态，更新检测不再返回）' })
  @OperateLog('应用管理', '下线版本')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_OFFLINE)
  @Post(':id/offline')
  async offline(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.versionService.offline(id, user.id)
  }
}
