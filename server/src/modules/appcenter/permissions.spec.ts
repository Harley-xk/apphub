import { describe, expect, it } from '@jest/globals'

import { APPCENTER_MODULE_NAME, APPCENTER_PERMISSIONS } from './permissions'
import { PermissionRegistry } from '../system/permissions'

describe('appcenter 模块权限点注册表', () => {
  it('清单自身不得有重复权限串（契约守护：防未来加行时手误）', () => {
    const codes = APPCENTER_PERMISSIONS.map(point => point.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('清单权限串应全部为三段冒号小写形态且首段为 appcenter', () => {
    for (const point of APPCENTER_PERMISSIONS) {
      expect(point.code).toMatch(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*){2}$/)
      expect(point.code.startsWith(`${APPCENTER_MODULE_NAME}:`)).toBe(true)
    }
  })

  it('权限点全集应为 16 项（app 6 + channel 4 + version 6）', () => {
    expect(APPCENTER_PERMISSIONS.length).toBe(16)
  })

  it('接入注册表应校验通过并扩容全集（与启动期同链路的冒烟）', () => {
    const registry = new PermissionRegistry()
    registry.registerModule({ module: APPCENTER_MODULE_NAME, points: APPCENTER_PERMISSIONS })
    // system 构造期 31 项 + appcenter 16 项
    expect(registry.allCodes().length).toBe(47)
    expect(registry.contains('appcenter:app:query')).toBe(true)
  })
})
