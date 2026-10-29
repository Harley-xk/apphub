import { describe, expect, it } from '@jest/globals'

import { collectPackageTargets } from './package-targets.util'

describe('collectPackageTargets', () => {
  it('同一 (platform, arch) 重复出现只保留一项（应用级跨版本聚合依赖去重）', () => {
    const targets = collectPackageTargets([
      { platform: 'windows', arch: 'x64' },
      { platform: 'windows', arch: 'x64' },
      { platform: 'windows', arch: 'arm64' },
    ])
    expect(targets).toEqual([
      { platform: 'windows', arch: 'x64' },
      { platform: 'windows', arch: 'arm64' },
    ])
  })

  it('平台按固定顺序、架构按固定顺序稳定输出（主张 A7）', () => {
    const targets = collectPackageTargets([
      { platform: 'linux', arch: 'arm64' },
      { platform: 'android', arch: null },
      { platform: 'macos', arch: 'universal' },
      { platform: 'windows', arch: 'universal' },
      { platform: 'windows', arch: 'arm64' },
      { platform: 'windows', arch: 'x64' },
    ])
    expect(targets).toEqual([
      { platform: 'windows', arch: 'x64' },
      { platform: 'windows', arch: 'arm64' },
      { platform: 'windows', arch: 'universal' },
      { platform: 'macos', arch: 'universal' },
      { platform: 'linux', arch: 'arm64' },
      { platform: 'android', arch: null },
    ])
  })

  it('无架构平台的 null 排在具名架构之后', () => {
    const targets = collectPackageTargets([
      { platform: 'android', arch: null },
      { platform: 'android', arch: 'arm64' },
    ])
    expect(targets).toEqual([
      { platform: 'android', arch: 'arm64' },
      { platform: 'android', arch: null },
    ])
  })

  it('未识别平台 / 架构排在末尾且多次调用顺序一致', () => {
    const input = [
      { platform: 'solaris', arch: 'sparc' },
      { platform: 'windows', arch: 'x64' },
      { platform: 'zodiac', arch: 'a1' },
      { platform: 'solaris', arch: 'mips' },
    ]
    const first = collectPackageTargets(input)
    expect(first).toEqual([
      { platform: 'windows', arch: 'x64' },
      { platform: 'solaris', arch: 'mips' },
      { platform: 'solaris', arch: 'sparc' },
      { platform: 'zodiac', arch: 'a1' },
    ])
    expect(collectPackageTargets([...input].reverse())).toEqual(first)
  })

  it('无包记录返回空数组', () => {
    expect(collectPackageTargets([])).toEqual([])
  })
})
