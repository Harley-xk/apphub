/*
 * 作者: Harley-xk
 * 创建: 2026-10-23
 *
 * 描述: 应用查找端口与注册表：system 只依赖抽象（应用存在性 / 精简信息），由 appcenter 启动期注册实现，避免反向静态依赖
 */
import { Injectable } from '@nestjs/common'

/** 应用精简信息（授权回显与下拉数据源共用：id / appKey / name） */
export interface AppOptionVo {
  id: string
  appKey: string
  name: string
}

/**
 * 应用查找端口：由 appcenter 模块实现（应用实体是 appcenter 的数据事实源）。
 *
 * system 模块不静态依赖 appcenter（appcenter 已在依赖 system 的权限注册表），
 * 故以端口 + 启动期注册解耦（应用管理员与数据范围设计 §9，与 AppSecretRegistry 同款方向）。
 */
export interface AppLookupPort {
  /** 断言应用全部存在且未软删；任一缺失由实现方抛 APP_NOT_EXISTS（错误码归 appcenter 模块段） */
  assertAppsExist(appIds: string[]): Promise<void>
  /** 按 id 批量取应用精简信息（仅返回未软删应用，顺序不保证） */
  listAppsByIds(appIds: string[]): Promise<AppOptionVo[]>
}

/**
 * 端口注册表：appcenter 在 onModuleInit 注册实现；system 侧懒取。
 * 未注册时由调用方抛明确错误（避免静默放行无效 appId）。
 */
@Injectable()
export class AppLookupRegistry {
  private port: AppLookupPort | null = null

  /** 注册实现：仅允许注册一次（重复注册即装配错误，启动期暴露） */
  register(port: AppLookupPort): void {
    if (this.port)
      throw new Error('应用查找端口已注册，不允许重复注册')
    this.port = port
  }

  /** 取端口实现：未注册返回 null，由调用方决定报错方式 */
  get(): AppLookupPort | null {
    return this.port
  }
}
