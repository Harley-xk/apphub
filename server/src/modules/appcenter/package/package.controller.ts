/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 包控制器（版本作用域）：列表 / 直传凭证签发 / 登记 / 删除（上传与登记仅草稿版本）
 */
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../../common/decorators/current-user.decorator'
import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import { RequirePermissions } from '../../system/permissions'
import { APPCENTER_PERMISSION_CODES } from '../permissions'
// 注意：作为 @Query()/@Body() 元类型的 DTO 类必须值导入（import type 会在运行时擦除）
import { PackageRegisterDto, PackageUploadTokenDto } from './dto/package.dto'
import type { PackageUploadTokenVo, PackageVo } from './dto/package.dto'
import { PackageService } from './package.service'

@ApiTags('应用管理')
@Controller('appcenter/version/:id/package')
export class PackageController {
  constructor(private readonly packageService: PackageService) {}

  @ApiOperation({ summary: '版本下包记录列表' })
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_QUERY)
  @Get()
  async list(@Param('id') versionId: string, @CurrentUser() user: AuthUser): Promise<PackageVo[]> {
    return this.packageService.list(versionId, user.id)
  }

  @ApiOperation({ summary: '签发 STS 直传凭证（对象键后端生成，policy 收敛精确键 PutObject）' })
  @OperateLog('应用管理', '申请包上传凭证')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_UPDATE)
  @Post('upload-token')
  async issueUploadToken(
    @Param('id') versionId: string,
    @Body() dto: PackageUploadTokenDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PackageUploadTokenVo> {
    return this.packageService.issueUploadToken(versionId, dto, user.id)
  }

  @ApiOperation({ summary: '登记包记录（HeadObject 校验，file_size 以服务端为准）' })
  @OperateLog('应用管理', '登记安装包')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_UPDATE)
  @Post()
  async register(
    @Param('id') versionId: string,
    @Body() dto: PackageRegisterDto,
    @CurrentUser() user: AuthUser,
  ): Promise<string> {
    return this.packageService.register(versionId, dto, user.id)
  }

  @ApiOperation({ summary: '删除包（仅草稿版本，连带清理 OSS 对象）' })
  @OperateLog('应用管理', '删除安装包')
  @RequirePermissions(APPCENTER_PERMISSION_CODES.VERSION_UPDATE)
  @Delete(':pkgId')
  async remove(
    @Param('id') versionId: string,
    @Param('pkgId') pkgId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.packageService.remove(versionId, pkgId, user.id)
  }
}
