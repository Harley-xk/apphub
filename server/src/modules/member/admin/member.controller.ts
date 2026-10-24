/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员管理控制器：列表 / 详情（脱敏）/ 启停（分权分路由）/ 软删 / 解绑凭证 / 重置密码（统一认证设计 §3.4）。
 * 启用与禁用是两个独立权限点，拆分路由精确对应（@RequirePermissions 为静态元数据，无法按 body 分支）
 */
import { Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { MemberPageDto } from './dto/member.dto'
import type { MemberDetailVo, MemberVo, ResetPasswordVo } from './dto/member.dto'
import { MemberAdminService } from './member-admin.service'
import { OperateLog } from '../../../common/decorators/operate-log.decorator'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { RequirePermissions } from '../../system/permissions'
import { MEMBER_PERMISSION_CODES } from '../permissions'

@ApiTags('终端用户管理')
@Controller('member')
export class MemberController {
  constructor(private readonly adminService: MemberAdminService) {}

  @ApiOperation({ summary: '会员分页列表（昵称 / 手机 / 邮箱关键字）' })
  @RequirePermissions(MEMBER_PERMISSION_CODES.MEMBER_QUERY)
  @Get()
  async getPage(@Query() dto: MemberPageDto): Promise<PageResult<MemberVo>> {
    return this.adminService.getPage(dto)
  }

  @ApiOperation({ summary: '会员详情（凭证清单脱敏）' })
  @RequirePermissions(MEMBER_PERMISSION_CODES.MEMBER_QUERY)
  @Get(':id')
  async get(@Param('id') id: string): Promise<MemberDetailVo> {
    return this.adminService.get(id)
  }

  @ApiOperation({ summary: '禁用会员（吊销全部令牌）' })
  @OperateLog('终端用户管理', '禁用会员')
  @RequirePermissions(MEMBER_PERMISSION_CODES.MEMBER_DISABLE)
  @Put(':id/disable')
  async disable(@Param('id') id: string): Promise<void> {
    await this.adminService.disable(id)
  }

  @ApiOperation({ summary: '启用会员' })
  @OperateLog('终端用户管理', '启用会员')
  @RequirePermissions(MEMBER_PERMISSION_CODES.MEMBER_ENABLE)
  @Put(':id/enable')
  async enable(@Param('id') id: string): Promise<void> {
    await this.adminService.enable(id)
  }

  @ApiOperation({ summary: '删除会员（软删，凭证标识不释放）' })
  @OperateLog('终端用户管理', '删除会员')
  @RequirePermissions(MEMBER_PERMISSION_CODES.MEMBER_REMOVE)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.adminService.remove(id)
  }

  @ApiOperation({ summary: '解绑凭证（最后一条密码凭证拒绝）' })
  @OperateLog('终端用户管理', '解绑凭证')
  @RequirePermissions(MEMBER_PERMISSION_CODES.CREDENTIAL_UNBIND)
  @Delete(':id/credential/:cid')
  async unbindCredential(@Param('id') id: string, @Param('cid') cid: string): Promise<void> {
    await this.adminService.unbindCredential(id, cid)
  }

  @ApiOperation({ summary: '重置密码（新密码仅此一次返回）' })
  @OperateLog('终端用户管理', '重置密码')
  @RequirePermissions(MEMBER_PERMISSION_CODES.CREDENTIAL_RESET_PASSWORD)
  @Post(':id/password/reset')
  async resetPassword(@Param('id') id: string): Promise<ResetPasswordVo> {
    return this.adminService.resetPassword(id)
  }
}
