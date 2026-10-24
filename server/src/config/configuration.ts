/*
 * 作者: Harley-xk
 * 创建: 2026-09-10
 *
 * 描述: 环境配置工厂：统一从环境变量读取配置项，未设置时使用默认值，供 ConfigModule 加载
 */

import type { DataSourceOptions } from 'typeorm'

/** JWT 开发默认密钥：本地零配置可跑；生产沿用该值时 SystemModule 启动 fail-fast（见 system.module.ts） */
export const DEFAULT_JWT_SECRET = 'dev-jwt-secret-change-me'

/** member 域 JWT 开发默认密钥：与 system 域相互独立（两套信任域，D18）；生产沿用时 MemberModule fail-fast */
export const DEFAULT_MEMBER_JWT_SECRET = 'dev-member-jwt-secret-change-me'

export default () => ({
  // 运行环境：development / test / production（DB_SYNC 收紧等安全开关按此判断）
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  // 通道降级开关（上线批次 DEP-5）：生产环境允许未配置的短信 / 邮件 / 支付通道降级运行
  // （短信邮件→log 通道，支付→渠道不注册下单 005200005），供资质报备未齐的上线窗口期显式豁免；
  // 默认 false 维持 fail-fast。仅豁免「全未配置」，部分填写仍属配置错误照常 fail-fast；Mock 永不进生产
  channelFallback: process.env.ALLOW_CHANNEL_FALLBACK === 'true',
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
  member: {
    // 终端用户域独立签发密钥（与 system 域 JWT_SECRET 相互独立，统一认证设计 §4.1）；
    // 生产必须配置独立 MEMBER_JWT_SECRET（MemberModule 启动校验）
    jwtSecret: process.env.MEMBER_JWT_SECRET ?? DEFAULT_MEMBER_JWT_SECRET,
    // access token 有效期（小时），默认 8h——与 system 域管理端令牌时效一致（主张 M1）
    accessExpiresHours: parseInt(process.env.MEMBER_ACCESS_EXPIRES_HOURS ?? '8', 10),
    // refresh token 有效期（天），默认 30d（统一认证设计 §2.3）
    refreshExpiresDays: parseInt(process.env.MEMBER_REFRESH_EXPIRES_DAYS ?? '30', 10),
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
  skill: {
    // 发版 skill 分发产物目录（构建时生成到 server/dist/skill/apphub-release；缺省按 dist 结构定位）
    distDir: process.env.SKILL_DIST_DIR ?? '',
  },
  aliyun: {
    // 全局阿里云 AccessKey（整个应用唯一一组 AK）：OSS 与短信通道共用同一 RAM 子账号，
    // 子账号需同时授予 OSS 相关与短信发送（sms:SendSms）权限
    accessKeyId: process.env.ALI_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.ALI_ACCESS_KEY_SECRET ?? '',
  },
  sms: {
    // 阿里云短信（M4 验证码通道，认证方式扩展设计 §3.2）：AK 复用全局 aliyun 段，
    // 本段签名 + 模板两项齐备且 aliyun AK 齐备视为已配置；生产缺配启动 fail-fast，非生产降级 log 通道
    signName: process.env.SMS_SIGN_NAME ?? '',
    templateCode: process.env.SMS_TEMPLATE_CODE ?? '',
  },
  mail: {
    // SMTP 邮件通道（M4 验证码，认证方式扩展设计 §3.2）：五项齐备视为已配置，装配与 fail-fast 规则同短信
    host: process.env.MAIL_HOST ?? '',
    port: parseInt(process.env.MAIL_PORT ?? '465', 10),
    user: process.env.MAIL_USER ?? '',
    password: process.env.MAIL_PASS ?? '',
    from: process.env.MAIL_FROM ?? '',
  },
  pay: {
    // 在线支付渠道（M5，见 docs/应用管理平台/在线支付渠道接入附录.md §7）：按渠道独立判定齐备态（P10）；
    // 生产两渠道全未配或部分填写均启动 fail-fast，非生产未配渠道降级 Mock（PY16）
    wechat: {
      appId: process.env.WECHAT_PAY_APP_ID ?? '',
      mchId: process.env.WECHAT_PAY_MCH_ID ?? '',
      // 商户 API 证书序列号与私钥（签名用；证书公钥由私钥推导，无需单独配置）
      certSerial: process.env.WECHAT_PAY_CERT_SERIAL ?? '',
      privateKeyPath: process.env.WECHAT_PAY_PRIVATE_KEY_PATH ?? '',
      // APIv3 密钥：回调解密与平台证书下载（无条件必配）
      apiv3Key: process.env.WECHAT_PAY_APIV3_KEY ?? '',
      // 公钥模式（2024 后新商户，P6）：两项配齐则回调验签用微信支付公钥（注入 SDK 证书表），
      // 不配则平台证书模式（验签时 SDK 按需自动拉取平台证书）
      publicKeySerial: process.env.WECHAT_PAY_PUBLIC_KEY_SERIAL ?? '',
      publicKeyPath: process.env.WECHAT_PAY_PUBLIC_KEY_PATH ?? '',
    },
    alipay: {
      appId: process.env.ALIPAY_APP_ID ?? '',
      // 应用私钥（签名）与支付宝公钥（异步通知验签）
      privateKeyPath: process.env.ALIPAY_PRIVATE_KEY_PATH ?? '',
      publicKeyPath: process.env.ALIPAY_PUBLIC_KEY_PATH ?? '',
      gateway: process.env.ALIPAY_GATEWAY ?? 'https://openapi.alipay.com/gateway.do',
    },
    // 回调公网地址（P7 可选）：配置则预下单显式传 notify_url；未配置不传，回落渠道控制台默认
    publicBaseUrl: process.env.PAY_PUBLIC_BASE_URL ?? '',
  },
  oss: {
    // 阿里云 OSS 对象存储（应用安装包分发，见 docs/应用管理平台/应用与版本管理设计.md §2.5）
    // AK 经顶层 aliyun 段注入（全局共用，不在本段重复配置）；
    // region + bucket + aliyun AK 齐备视为 OSS 已配置（未配置时服务正常启动，存储接口统一抛存储未配置错误）；
    // 后两项 STS 仅直传凭证签发用，缺失时上传凭证接口单独拒绝
    region: process.env.OSS_REGION ?? '',
    bucket: process.env.OSS_BUCKET ?? '',
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
