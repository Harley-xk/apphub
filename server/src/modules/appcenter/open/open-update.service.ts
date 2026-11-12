/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 开放更新服务：自研协议与框架适配端点（D23 / D24）的共享候选查询、版本比较与 manifest 渲染（macOS 平台级 feed 按架构聚合）
 */
import { Inject, Injectable } from '@nestjs/common'
import { dump as yamlDump } from 'js-yaml'
import { rcompare, valid as validSemver } from 'semver'

import { businessError } from '../../../common/exceptions/business-error'
import { AppService } from '../app/app.service' // 值导入：构造注入元数据需要（import type 会擦除）
import { APP_STATUS, ELECTRON_MANIFEST_ARCH, PACKAGE_ARCH_VALUES, PACKAGE_PLATFORM, STABLE_CHANNEL_CODE, TAURI_TARGET_MAP } from '../appcenter.constants'
import type { AppPackageEntity } from '../entities/app-package.entity'
import type { AppVersionEntity } from '../entities/app-version.entity'
import { AppEntity } from '../entities/app.entity'
import { AppcenterErrorCode } from '../error-codes'
import { pickMacAggregatePackages } from '../package/package-mac-aggregate.util'
import { STORAGE_SERVICE } from '../storage/storage.service'
import type { StorageService } from '../storage/storage.service'
import { VersionService } from '../version/version.service'
import type { UpdateCandidate } from '../version/version.service'
import type { CheckPackageVo, CheckVersionVo, TauriManifestVo } from './dto/open.dto'
import type { VersionCheckDto } from './dto/open.dto'

/** 强制标记：manifest notes 首行前置（单一事实源两种渲染，D24） */
const FORCE_MARK = '[force]'

/** electron manifest files 条目（electron-updater 协议字段） */
interface ElectronManifestFile {
  url: string
  sha512: string
  size: number
}

/** 可渲染包：ossObjectKey 与 sha512 均已登记（不可下载的包不进入 manifest） */
type RenderablePackage = AppPackageEntity & { sha512: string }

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

  /**
   * electron latest*.yml 渲染（无 published 版本返回 null → 404，版本比较在客户端完成，D24）
   * - 传 arch：架构级 feed，按精确槽位取包；白名单外取值视同无该槽位
   * - 不传 arch 且 platform=macos：平台级默认 feed 按架构聚合（设计 B1 / B2 / B4）
   * - 其余平台级 feed：arch 固定映射（latest.yml→x64、latest-linux.yml→x64）
   */
  async getElectronManifest(input: { appKey: string, channelCode: string, platform: string, arch?: string }): Promise<string | null> {
    if (input.arch !== undefined) {
      if (!PACKAGE_ARCH_VALUES.includes(input.arch))
        return null
      const candidate = await this.findCandidate(input.appKey, input.channelCode, input.platform, input.arch)
      return this.renderSinglePackageManifest(candidate)
    }
    if (input.platform === PACKAGE_PLATFORM.MACOS) {
      const candidate = await this.findMacAggregateCandidate(input.appKey, input.channelCode)
      if (!candidate)
        return null
      const renderable = candidate.packages.filter(pkg => this.isRenderablePackage(pkg))
      return this.renderElectronManifest(candidate.version, pickMacAggregatePackages(renderable))
    }
    const candidate = await this.findCandidate(
      input.appKey,
      input.channelCode,
      input.platform,
      ELECTRON_MANIFEST_ARCH[input.platform] ?? null,
    )
    return this.renderSinglePackageManifest(candidate)
  }

  /** 单包渲染（平台级固定映射 / 架构级精确槽位）：取候选第一个包，无可用包返回 null */
  private renderSinglePackageManifest(candidate: UpdateCandidate | null): string | null {
    if (!candidate)
      return null
    const pkg = candidate.packages[0]
    if (!this.isRenderablePackage(pkg))
      return null
    return this.renderElectronManifest(candidate.version, [pkg])
  }

  /** electron manifest 渲染：按传入顺序展开每个包（主包 + 可选 blockmap），顶层字段取首个包 */
  private renderElectronManifest(version: AppVersionEntity, packages: RenderablePackage[]): string | null {
    if (packages.length === 0)
      return null
    const files: ElectronManifestFile[] = []
    for (const pkg of packages) {
      files.push({ url: this.storageService.signGetUrl(pkg.ossObjectKey), sha512: pkg.sha512, size: Number(pkg.fileSize) })
      // blockmap 可选条目：未上传则省略（客户端退回全量下载，不违背 D11）
      if (pkg.blockmapObjectKey && pkg.blockmapSha512) {
        files.push({
          url: this.storageService.signGetUrl(pkg.blockmapObjectKey),
          sha512: pkg.blockmapSha512,
          size: Number(pkg.blockmapFileSize ?? 0),
        })
      }
    }

    const main = packages[0]
    const manifest: Record<string, unknown> = {
      version: version.version,
      path: main.fileName,
      sha512: main.sha512,
      releaseDate: version.publishedAt?.toISOString(),
      releaseNotes: this.withForceMark(version.notes, version.forceUpdate),
      files,
    }
    // 剔除空值字段（yaml 不输出 null，保持 manifest 干净）
    for (const key of Object.keys(manifest)) {
      if (manifest[key] === undefined || manifest[key] === null)
        delete manifest[key]
    }
    return yamlDump(manifest, { lineWidth: -1 })
  }

  /** 可渲染判定（类型守卫：ossObjectKey 与 sha512 均非空） */
  private isRenderablePackage(pkg: AppPackageEntity | undefined): pkg is RenderablePackage {
    return Boolean(pkg?.ossObjectKey && pkg.sha512)
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

  /** macOS 多架构聚合候选：停用应用直接无候选（→ 404，主张 B3） */
  private async findMacAggregateCandidate(appKey: string, channelCode: string) {
    const app = await this.getExistsApp(appKey)
    if (app.status !== APP_STATUS.ENABLED)
      return null
    return this.versionService.findMacAggregateCandidate({ app, channelCode })
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
