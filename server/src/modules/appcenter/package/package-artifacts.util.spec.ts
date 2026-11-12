import { describe, expect, it } from '@jest/globals'

import { assertFrameworkArtifacts } from './package-artifacts.util'
import { AppcenterErrorCode } from '../error-codes'

/** 断言抛出框架产物缺失（003004003） */
function expectArtifactMissing(run: () => void, messagePart: string): void {
  try {
    run()
  }
  catch (error) {
    expect((error as { code?: number }).code).toBe(AppcenterErrorCode.FRAMEWORK_ARTIFACT_MISSING.code)
    expect((error as Error).message).toContain(messagePart)
    return
  }
  throw new Error('应当抛出框架产物缺失')
}

const MAC_ZIP = {
  platform: 'macos',
  arch: 'universal',
  fileName: 'app-1.0.0-mac.zip',
  sha512: 'c2hhNTEy',
}

describe('assertFrameworkArtifacts —— electron macOS 产物约束（主张 B8）', () => {
  it('macos 包非 zip 应拦截（更新链路只认 zip）', () => {
    expectArtifactMissing(
      () => assertFrameworkArtifacts('electron', [{ ...MAC_ZIP, fileName: 'app-1.0.0.dmg' }]),
      '须为 zip',
    )
  })

  it('arm64 包文件名缺 arm64 标记应拦截（会被客户端当成 x64）', () => {
    expectArtifactMissing(
      () => assertFrameworkArtifacts('electron', [{ ...MAC_ZIP, arch: 'arm64' }]),
      '架构标记须与登记架构一致',
    )
  })

  it('x64 / universal 包文件名带 arm64 标记应拦截（x64 机器会直接排除）', () => {
    expectArtifactMissing(
      () => assertFrameworkArtifacts('electron', [{ ...MAC_ZIP, arch: 'x64', fileName: 'app-1.0.0-arm64-mac.zip' }]),
      '架构标记须与登记架构一致',
    )
    expectArtifactMissing(
      () => assertFrameworkArtifacts('electron', [{ ...MAC_ZIP, fileName: 'app-1.0.0-arm64-mac.zip' }]),
      '架构标记须与登记架构一致',
    )
  })

  it('arm64 zip 且文件名含 arm64 应通过', () => {
    expect(() => assertFrameworkArtifacts('electron', [
      { platform: 'macos', arch: 'arm64', fileName: 'app-1.0.0-arm64-mac.zip', sha512: 'c2hhNTEy' },
    ])).not.toThrow()
  })

  it('大小写不敏感：ARM64 标记同样识别', () => {
    expect(() => assertFrameworkArtifacts('electron', [
      { platform: 'macos', arch: 'arm64', fileName: 'App-1.0.0-ARM64-mac.ZIP', sha512: 'c2hhNTEy' },
    ])).not.toThrow()
  })

  it('非 macos 平台与 tauri 应用不受 zip / 架构标记约束', () => {
    expect(() => assertFrameworkArtifacts('electron', [
      { platform: 'windows', arch: 'x64', fileName: 'app-1.0.0.exe', sha512: 'c2hhNTEy' },
    ])).not.toThrow()
    expect(() => assertFrameworkArtifacts('tauri', [
      { platform: 'macos', arch: 'arm64', fileName: 'app.app.tar.gz', minisignSignature: 'sig' },
    ])).not.toThrow()
  })

  it('electron macos 包缺 sha512 仍按原规则拦截', () => {
    expectArtifactMissing(
      () => assertFrameworkArtifacts('electron', [{ ...MAC_ZIP, sha512: null }]),
      '缺少 sha512',
    )
  })

  it('framework 为 null / custom 时不强制（草稿兼容）', () => {
    expect(() => assertFrameworkArtifacts(null, [{ platform: 'macos', fileName: 'app.dmg' }])).not.toThrow()
    expect(() => assertFrameworkArtifacts('custom', [{ platform: 'macos', fileName: 'app.dmg' }])).not.toThrow()
  })
})
