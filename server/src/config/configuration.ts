/*
 * 作者: Harley-xk
 * 创建: 2026-09-10
 *
 * 描述: 环境配置工厂：统一从环境变量读取配置项，未设置时使用默认值，供 ConfigModule 加载
 */

import type { DataSourceOptions } from 'typeorm'

/** JWT 开发默认密钥：本地零配置可跑；生产沿用该值时 SystemModule 启动 fail-fast（见 system.module.ts） */
export const DEFAULT_JWT_SECRET = 'dev-jwt-secret-change-me'

export default () => ({
  // 运行环境：development / test / production（DB_SYNC 收紧等安全开关按此判断）
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  jwt: {
    // 签名密钥：默认开发值仅供本地；生产必须配置独立 JWT_SECRET（SystemModule 启动校验）
    secret: process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET,
    // token 有效期（ADR-003 实施定稿：8 小时；无刷新 token，过期重新登录）
    expiresIn: process.env.JWT_EXPIRES ?? '8h',
  },
  user: {
    // 新建用户初始口令：不传口令创建时使用（批次五迁入参数表驱动）
    initPassword: process.env.USER_INIT_PASSWORD ?? 'admin123',
  },
  signature: {
    // 写方法签名校验开关：默认关闭（存量环境零影响），.env.example 模板值为 true 引导新项目启用
    enabled: process.env.SIGNATURE_ENABLED === 'true',
    // HMAC 密钥：enabled 且为空时 SignatureModule 启动 fail-fast（安全机制不得静默失效）
    secret: process.env.SIGNATURE_SECRET ?? '',
    // 签名有效时间窗（毫秒），默认 5 分钟；同时决定 nonce 防重放窗口（2 倍时间窗）
    expireMs: parseInt(process.env.SIGNATURE_EXPIRE_MS ?? String(5 * 60 * 1000), 10),
  },
  rateLimit: {
    // 开放 API 限流：按 AppKey + IP 滑动窗口（公开客户端阈值减半由 Guard 依据 app 表 client_type 判定）
    limit: parseInt(process.env.RATE_LIMIT_LIMIT ?? '60', 10),
    // 窗口长度（毫秒），默认 1 分钟
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? String(60 * 1000), 10),
  },
  oss: {
    // 阿里云 OSS 对象存储（应用安装包分发，见 docs/应用管理平台/应用与版本管理设计.md §2.5）
    // 前四项齐备视为 OSS 已配置（未配置时服务正常启动，存储接口统一抛存储未配置错误）；
    // 后两项 STS 仅直传凭证签发用，缺失时上传凭证接口单独拒绝
    region: process.env.OSS_REGION ?? '',
    bucket: process.env.OSS_BUCKET ?? '',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? '',
    // STS 直传凭证签发用 RAM 角色与会话名（角色策略仅授 packages/* PutObject）
    stsRoleArn: process.env.STS_ROLE_ARN ?? '',
    stsSessionName: process.env.STS_SESSION_NAME ?? 'apphub-upload',
  },
  database: {
    // 数据库类型：默认 postgres（首选），经 DB_TYPE 按项目需要切换（仅承诺主流数据库，不做国产适配）
    type: (process.env.DB_TYPE ?? 'postgres') as DataSourceOptions['type'],
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_DATABASE ?? 'apphub',
    synchronize: process.env.DB_SYNC === 'true',
  },
})
