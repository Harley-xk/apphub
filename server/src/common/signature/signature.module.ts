/*
 * 作者: Harley-xk
 * 创建: 2026-09-11
 *
 * 描述: 签名模块：装配标准方案、方案注册表、nonce 存储与全局守卫，并做启动期密钥 fail-fast 校验
 */

import { Global, Logger, Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AppSecretRegistry } from './app-secret.registry'
import { NONCE_STORE, InMemoryNonceStore } from './nonce-store/in-memory-nonce-store'
import { AppSignatureScheme } from './schemes/app-signature.scheme'
import { StandardSignatureScheme } from './schemes/standard-signature.scheme'
import { SignatureSchemeRegistry } from './signature-scheme.registry'
import { SignatureGuard } from './signature.guard'

@Global()
@Module({
  providers: [
    // nonce 防重放存储：默认内存实现，多实例部署时可经此 token 覆盖为集中式存储（如 Redis）
    { provide: NONCE_STORE, useClass: InMemoryNonceStore },
    // 应用密钥源：业务模块（appcenter）启动期注册解析器（按 AppKey 查 AppSecret，D15/D17）
    AppSecretRegistry,
    StandardSignatureScheme,
    AppSignatureScheme,
    {
      // 注册表：装配期注入标准方案与应用方案；业务模块经 onModuleInit 注册自定义方案
      provide: SignatureSchemeRegistry,
      useFactory: (standard: StandardSignatureScheme, app: AppSignatureScheme) => {
        const registry = new SignatureSchemeRegistry()
        registry.register(standard)
        registry.register(app)
        return registry
      },
      inject: [StandardSignatureScheme, AppSignatureScheme],
    },
    SignatureGuard,
  ],
  exports: [SignatureSchemeRegistry, NONCE_STORE, AppSecretRegistry],
})
export class SignatureModule implements OnModuleInit {
  private readonly logger = new Logger(SignatureModule.name)

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    // fail-fast：签名启用但密钥为空时阻止启动——安全机制不得静默失效
    const enabled = this.configService.get<boolean>('signature.enabled')
    const secret = this.configService.get<string>('signature.secret')
    if (enabled && !secret) {
      this.logger.fatal('SIGNATURE_ENABLED 已开启但 SIGNATURE_SECRET 为空，请配置签名密钥（见 docs/指南/请求签名验证设计.md）')
      throw new Error('签名密钥缺失：SIGNATURE_ENABLED=true 时必须配置 SIGNATURE_SECRET')
    }
  }
}
