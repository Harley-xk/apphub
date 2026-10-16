/**
 * ali-oss 内置 STS 客户端（lib/sts）的类型声明——@types/ali-oss 仅覆盖主模块。
 * assumeRole 签发 AssumeRole 临时凭证（HMAC-SHA1 RPC 签名，无需额外 SDK）。
 */
declare module 'ali-oss/lib/sts' {
  interface StsCredentials {
    AccessKeyId: string
    AccessKeySecret: string
    SecurityToken: string
    /** ISO 时刻（UTC），如 2026-10-16T12:00:00Z */
    Expiration: string
  }

  interface StsClient {
    assumeRole(
      roleArn: string,
      policy?: unknown,
      expiration?: number,
      sessionName?: string,
    ): Promise<{ credentials: StsCredentials }>
  }

  const STS: new (options: { accessKeyId: string, accessKeySecret: string, endpoint?: string }) => StsClient

  export = STS
}
