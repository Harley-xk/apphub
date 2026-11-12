import { describe, expect, it } from '@jest/globals'

import { pickMacAggregatePackages } from './package-mac-aggregate.util'

function pkgs(...archs: (string | null)[]) {
  return archs.map(arch => ({ arch, id: arch ?? 'null' }))
}

describe('pickMacAggregatePackages', () => {
  it('仅 universal 时应单条输出（存量行为不变）', () => {
    expect(pickMacAggregatePackages(pkgs('universal')).map(pkg => pkg.arch)).toEqual(['universal'])
  })

  it('x64 + arm64 时应双架构输出且 universal 不参与', () => {
    expect(pickMacAggregatePackages(pkgs('x64', 'arm64', 'universal')).map(pkg => pkg.arch))
      .toEqual(['x64', 'arm64'])
  })

  it('单架构 + universal 时应 universal 前置（arm64 机器不得先取到 x64 包）', () => {
    expect(pickMacAggregatePackages(pkgs('x64', 'universal')).map(pkg => pkg.arch))
      .toEqual(['universal', 'x64'])
    expect(pickMacAggregatePackages(pkgs('universal', 'arm64')).map(pkg => pkg.arch))
      .toEqual(['universal', 'arm64'])
  })

  it('仅有单架构包时应单条输出', () => {
    expect(pickMacAggregatePackages(pkgs('x64')).map(pkg => pkg.arch)).toEqual(['x64'])
    expect(pickMacAggregatePackages(pkgs('arm64')).map(pkg => pkg.arch)).toEqual(['arm64'])
  })

  it('无可用架构（如 arch 为空）时应返回空数组', () => {
    expect(pickMacAggregatePackages(pkgs(null))).toEqual([])
    expect(pickMacAggregatePackages([])).toEqual([])
  })
})
