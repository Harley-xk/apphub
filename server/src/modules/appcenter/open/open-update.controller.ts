/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 框架内建更新器适配端点（D24）：electron latest*.yml ×3 与 tauri JSON，AppKey 从 URL 路径提取。
 * manifest 为框架协议裸载荷，经 @Res 直出绕过统一响应包裹（electron-updater / tauri-plugin-updater 不识别包裹结构）
 */
import { Controller, Get, Param, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { OpenUpdateService } from './open-update.service'
import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator'
import { SkipSignature } from '../../../common/signature/decorators/skip-signature.decorator'
import { PACKAGE_PLATFORM } from '../appcenter.constants'

@ApiTags('开放接口')
@Public()
@SkipSignature()
@RateLimit({ appKeyFrom: 'path' })
@Controller('update/:appKey/:channel')
export class OpenUpdateController {
  constructor(private readonly openUpdateService: OpenUpdateService) {}

  @ApiOperation({ summary: 'electron-updater 清单（Windows；无 published 版本 404）' })
  @Get('electron/latest.yml')
  async getElectronLatest(
    @Param('appKey') appKey: string,
    @Param('channel') channel: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.writeElectronManifest(response, appKey, channel, PACKAGE_PLATFORM.WINDOWS)
  }

  @ApiOperation({ summary: 'electron-updater 清单（macOS；无 published 版本 404）' })
  @Get('electron/latest-mac.yml')
  async getElectronLatestMac(
    @Param('appKey') appKey: string,
    @Param('channel') channel: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.writeElectronManifest(response, appKey, channel, PACKAGE_PLATFORM.MACOS)
  }

  @ApiOperation({ summary: 'electron-updater 清单（Linux；无 published 版本 404）' })
  @Get('electron/latest-linux.yml')
  async getElectronLatestLinux(
    @Param('appKey') appKey: string,
    @Param('channel') channel: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.writeElectronManifest(response, appKey, channel, PACKAGE_PLATFORM.LINUX)
  }

  @ApiOperation({ summary: 'tauri-plugin-updater 清单（无更新 / 未识别 target 返回 204）' })
  @Get('tauri/:target/:currentVersion')
  async getTauriManifest(
    @Param('appKey') appKey: string,
    @Param('channel') channel: string,
    @Param('target') target: string,
    @Param('currentVersion') currentVersion: string,
    @Res() response: Response,
  ): Promise<void> {
    const manifest = await this.openUpdateService.getTauriManifest({
      appKey,
      channelCode: channel,
      target,
      currentVersion,
    })
    // 无更新语义：204 No Content（tauri-plugin-updater 按「无更新」容错，设计 §3.4）
    if (manifest === null) {
      response.status(204).send()
      return
    }
    response.status(200).json(manifest)
  }

  /** electron manifest 直出：无 published 版本 404（应用侧容错，版本比较在客户端完成） */
  private async writeElectronManifest(
    response: Response,
    appKey: string,
    channel: string,
    platform: string,
  ): Promise<void> {
    const manifest = await this.openUpdateService.getElectronManifest({ appKey, channelCode: channel, platform })
    if (manifest === null) {
      response.status(404).send()
      return
    }
    response.type('application/yaml').status(200).send(manifest)
  }
}
