/*
 * 作者: Harley-xk
 * 创建: 2026-10-24
 *
 * 描述: 发版 skill 分发服务：读取构建产物目录，提供版本清单 / 安装说明 / 安装器 / 版本化文件（公开分发，路径白名单）
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

/** 清单中的单个文件（url 为相对平台基址的公开分发路径） */
export interface SkillFileVo {
  path: string
  url: string
  sha256: string
  size: number
}

/** 版本清单（manifest.json 原样透出） */
export interface SkillManifestVo {
  name: string
  version: string
  generatedAt: string
  files: SkillFileVo[]
  installer: SkillFileVo
  installDoc: SkillFileVo
}

@Injectable()
export class SkillDistributionService {
  private readonly logger = new Logger(SkillDistributionService.name)
  /** 分发产物目录（含 manifest.json / INSTALL.md / install.mjs / {version}/**） */
  private readonly skillDir: string

  constructor(configService: ConfigService) {
    const configured = configService.get<string>('skill.distDir')
    // 优先显式配置（测试 / 特殊部署）；其次按编译产物定位 dist/skill；最后按 server 工作目录兜底
    const candidates = [
      configured,
      path.resolve(__dirname, '../../..', 'skill', 'apphub-release'),
      path.resolve(process.cwd(), 'dist', 'skill', 'apphub-release'),
    ].filter((item): item is string => Boolean(item))
    this.skillDir = candidates.find(dir => existsSync(path.join(dir, 'manifest.json'))) ?? candidates[0]
    if (!existsSync(path.join(this.skillDir, 'manifest.json')))
      this.logger.warn(`发版 skill 分发产物未生成：${this.skillDir}（构建时由 scripts/build-skill-manifest.mjs 产出）`)
  }

  /** 版本清单：不存在或格式非法均按 404 处理（不向公开调用方暴露路径细节） */
  async getManifest(): Promise<SkillManifestVo> {
    const content = await this.readText('manifest.json')
    try {
      return JSON.parse(content) as SkillManifestVo
    }
    catch {
      throw new NotFoundException('技能分发产物格式非法')
    }
  }

  /** 冷启动安装说明（Markdown） */
  async getInstallDoc(): Promise<string> {
    return this.readText('INSTALL.md')
  }

  /** 冷启动安装 / 更新器（Node 脚本） */
  async getInstaller(): Promise<string> {
    return this.readText('install.mjs')
  }

  /**
   * 版本化文件：只允许 manifest.files 清单内的文件，且版本必须与当前清单一致。
   * 白名单校验同时阻断路径穿越与读取分发目录外的任意文件。
   */
  async getSkillFile(version: string, relPath: string): Promise<string> {
    const manifest = await this.getManifest()
    if (manifest.version !== version)
      throw new NotFoundException('技能版本不存在')
    const file = manifest.files.find(item => item.path === relPath)
    if (!file)
      throw new NotFoundException('技能文件不存在')
    // 版本化文件位于 {skillDir}/{version}/{path}
    return this.readText(path.join(manifest.version, file.path))
  }

  /** 读取分发目录内文件：resolve 后必须仍在技能目录内 */
  private async readText(relPath: string): Promise<string> {
    const base = path.resolve(this.skillDir)
    const target = path.resolve(base, relPath)
    if (target !== base && !target.startsWith(`${base}${path.sep}`))
      throw new NotFoundException('技能文件不存在')
    try {
      return await fs.readFile(target, 'utf8')
    }
    catch {
      throw new NotFoundException('技能分发产物不存在')
    }
  }
}
