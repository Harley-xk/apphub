/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 开放更新服务：自研协议与框架适配端点（D23 / D24）的共享候选查询、版本比较与 manifest 渲染
 */
import { Inject, Injectable } from '@nestjs/common'
import { dump as yamlDump } from 'js-yaml'
import { rcompare, valid as validSemver } from 'semver'

import { businessError } from '../../../common/exceptions/business-error'
import { AppService } from '../app/app.service' // 值导入：构造注入元数据需要（import type 会擦除）
import { APP_STATUS, ELECTRON_MANIFEST_ARCH, STABLE_CHANNEL_CODE, TAURI_TARGET_MAP } from '../appcenter.constants'
import type { AppPackageEntity } from '../entities/app-package.entity'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import { STORAGE_SERVICE } from '../storage/storage.service'
import type { StorageService } from '../storage/storage.service'
import { VersionService } from '../version/version.service'
import type { CheckPackageVo, CheckVersionVo, TauriManifestVo } from './dto/open.dto'
import type { VersionCheckDto } from './dto/open.dto'

/** 强制标记：manifest notes 首行前置（单一事实源两种渲染，D24） */
const FORCE_MARK = '[force]'

@Injectable()
export class OpenUpdateService {
  constructor(
    private readonly appService: AppService,
    private readonly versionService: VersionService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  /** 自研协议更新检测（设计 §3.3）：AppKey 无效即拒；停用应用 / 无候选返回无更新 */
  async checkVersion(appKey: string, dto: VersionCheckDto): Promise<CheckVersionVo> {
    const app = await this.getExistsApp(appKey)
    if (app.status !== APP_STATUS.ENABLED)
      return { hasUpdate: false }
    const candidate = await this.versionService.findUpdateCandidate({
      app,
      channelCode: dto.channel ?? STABLE_CHANNEL_CODE,
      platform: dto.platform,
      arch: dto.arch ?? null,
    })
    if (!candidate)
      return { hasUpdate: false }
    // currentVersion 语义放宽：非 semver（含空）按必有更新处理（容忍旧客户端脏数据）
    // rcompare(candidate, current) ≥ 0 即候选不新于当前（rcompare 为负时候选更新）
    const current = dto.currentVersion ? validSemver(dto.currentVersion) : null
    if (current && rcompare(candidate.version.version, current) >= 0)
      return { hasUpdate: false }

    const pkg = candidate.packages[0]
    return {
      hasUpdate: true,
      latestVersion: candidate.version.version,
      title: candidate.version.title,
      notes: candidate.version.notes,
      forceUpdate: candidate.version.forceUpdate,
      package: this.toCheckPackage(pkg),
    }
  }

  /** electron latest*.yml 渲染（无 published 版本返回 null → 404，版本比较在客户端完成，D24） */
  async getElectronManifest(input: { appKey: string, channelCode: string, platform: string }): Promise<string | null> {
    // 平台级 feed 的 arch 固定映射（设计 §3.4）：latest.yml→x64、latest-mac.yml→universal、latest-linux.yml→x64
    const candidate = await this.findCandidate(
      input.appKey,
      input.channelCode,
      input.platform,
      ELECTRON_MANIFEST_ARCH[input.platform] ?? null,
    )
    if (!candidate)
      return null
    const pkg = candidate.packages[0]
    if (!pkg?.ossObjectKey || !pkg.sha512)
      return null

    const files: { url: string, sha512: string, size: number }[] = [
      { url: this.storageService.signGetUrl(pkg.ossObjectKey), sha512: pkg.sha512, size: Number(pkg.fileSize) },
    ]
    // blockmap 可选条目：未上传则省略（客户端退回全量下载，不违背 D11）
    if (pkg.blockmapObjectKey && pkg.blockmapSha512)
      files.push({
        url: this.storageService.signGetUrl(pkg.blockmapObjectKey),
        sha512: pkg.blockmapSha512,
        size: Number(pkg.blockmapFileSize ?? 0),
      })

    const manifest: Record<string, unknown> = {
      version: candidate.version.version,
      path: pkg.fileName,
      sha512: pkg.sha512,
      releaseDate: candidate.version.publishedAt?.toISOString(),
      releaseNotes: this.withForceMark(candidate.version.notes, candidate.version.forceUpdate),
      files,
    }
    // 剔除空值字段（yaml 不输出 null，保持 manifest 干净）
    for (const key of Object.keys(manifest)) {
      if (manifest[key] === undefined || manifest[key] === null)
        delete manifest[key]
    }
    return yamlDump(manifest, { lineWidth: -1 })
  }

  /** tauri manifest 渲染（服务端完成版本比较：无更新 / 未识别 target 返回 null → 204，D24） */
  async getTauriManifest(input: { appKey: string, channelCode: string, target: string, currentVersion: string }): Promise<TauriManifestVo | null> {
    const targetMap = TAURI_TARGET_MAP[input.target]
    if (!targetMap)
      return null
    const candidate = await this.findCandidate(input.appKey, input.channelCode, targetMap.platform, targetMap.arch)
    if (!candidate)
      return null
    // 服务端版本比较：候选不新于 currentVersion 返回 204（非 semver 按必有更新处理）
    const current = validSemver(input.currentVersion)
    if (current && rcompare(candidate.version.version, current) >= 0)
      return null
    const pkg = candidate.packages[0]
    if (!pkg?.ossObjectKey)
      return null

    return {
      version: candidate.version.version,
      pub_date: (candidate.version.publishedAt ?? candidate.version.createTime).toISOString(),
      notes: this.withForceMark(candidate.version.notes, candidate.version.forceUpdate),
      platforms: {
        [input.target]: {
          signature: pkg.minisignSignature ?? '',
          url: this.storageService.signGetUrl(pkg.ossObjectKey),
        },
      },
    }
  }

  /** 应用有效性：查无应用抛 APP_KEY_INVALID（路由 / 统计用途，无效即拒，D23） */
  private async getExistsApp(appKey: string): Promise<AppEntity> {
    const app = await this.appService.findByAppKey(appKey)
    if (!app) {
      throw businessError(AppcenterErrorCode.APP_KEY_INVALID.message, {
        code: AppcenterErrorCode.APP_KEY_INVALID,
      })
    }
    return app
  }

  /** 共享候选查询：停用应用直接无候选（electron → 404 / tauri → 204） */
  private async findCandidate(appKey: string, channelCode: string, platform: string, arch: string | null) {
    const app = await this.getExistsApp(appKey)
    if (app.status !== APP_STATUS.ENABLED)
      return null
    return this.versionService.findUpdateCandidate({ app, channelCode, platform, arch })
  }

  /** 自研协议包信息：无包 / 提示型平台（oss_object_key 为空）返回 null */
  private toCheckPackage(pkg: AppPackageEntity | undefined): CheckPackageVo | null {
    if (!pkg?.ossObjectKey)
      return null
    return {
      fileName: pkg.fileName,
      fileSize: Number(pkg.fileSize),
      sha256: pkg.sha256,
      downloadUrl: this.storageService.signGetUrl(pkg.ossObjectKey),
    }
  }

  /** notes 首行前置 [force] 标记（应用侧展示前剔除标记行） */
  private withForceMark(notes: string | null, forceUpdate: boolean): string {
    const text = notes ?? ''
    return forceUpdate ? `${FORCE_MARK}\n${text}` : text
  }
}
