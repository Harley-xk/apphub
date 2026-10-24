/*
 * 作者: Harley-xk
 * 创建: 2026-10-24
 *
 * 描述: 发版 skill 公开分发接口：冷启动说明 / 版本清单 / 安装器 / 版本化文件（免 JWT、免签名，经 /api 反代即可用）
 */
import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { SkillDistributionService } from './skill.service'
import { Public } from '../../../common/decorators/public.decorator'
import { SkipSignature } from '../../../common/signature/decorators/skip-signature.decorator'

@Public()
@SkipSignature()
@ApiTags('技能分发')
@Controller('skill/apphub-release')
export class SkillController {
  constructor(private readonly skillService: SkillDistributionService) {}

  @ApiOperation({ summary: '发版技能安装说明（冷启动入口，公开）' })
  @Header('Cache-Control', 'no-cache')
  @Get()
  async getInstallDoc(): Promise<StreamableFile> {
    return this.textFile(await this.skillService.getInstallDoc(), 'text/markdown; charset=utf-8')
  }

  @ApiOperation({ summary: '发版技能版本清单（公开）' })
  @Header('Cache-Control', 'no-cache')
  @Get('manifest')
  async getManifest(): Promise<StreamableFile> {
    const manifest = await this.skillService.getManifest()
    return this.textFile(JSON.stringify(manifest), 'application/json; charset=utf-8')
  }

  @ApiOperation({ summary: '发版技能安装 / 更新器（公开）' })
  @Header('Cache-Control', 'no-cache')
  @Get('install.mjs')
  async getInstaller(): Promise<StreamableFile> {
    return this.textFile(await this.skillService.getInstaller(), 'application/javascript; charset=utf-8')
  }

  @ApiOperation({ summary: '版本化技能文件（公开，版本与路径均按清单白名单校验）' })
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Get('files/:version/SKILL.md')
  async getSkillMd(@Param('version') version: string): Promise<StreamableFile> {
    return this.textFile(await this.skillService.getSkillFile(version, 'SKILL.md'), 'text/markdown; charset=utf-8')
  }

  @ApiOperation({ summary: '版本化技能版本号文件（公开）' })
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Get('files/:version/VERSION')
  async getVersionFile(@Param('version') version: string): Promise<StreamableFile> {
    return this.textFile(await this.skillService.getSkillFile(version, 'VERSION'), 'text/plain; charset=utf-8')
  }

  @ApiOperation({ summary: '版本化技能脚本文件（公开）' })
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Get('files/:version/scripts/:name')
  async getScript(@Param('version') version: string, @Param('name') name: string): Promise<StreamableFile> {
    return this.textFile(
      await this.skillService.getSkillFile(version, `scripts/${name}`),
      'application/javascript; charset=utf-8',
    )
  }

  /** 分发接口返回原始内容（StreamableFile 直通统一响应包装，客户端可直接解析） */
  private textFile(content: string, type: string): StreamableFile {
    return new StreamableFile(Buffer.from(content, 'utf8'), { type })
  }
}
