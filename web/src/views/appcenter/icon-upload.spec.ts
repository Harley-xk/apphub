import { describe, expect, it } from 'vitest'

import { ICON_MAX_BYTES, validateIconFile } from './icon-upload'

/** 构造指定文件名与体积的测试文件（MIME 留空：校验以扩展名为准） */
function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name)
}

describe('validateIconFile 图标文件校验', () => {
  it('白名单内的扩展名且体积合法应放行', () => {
    expect(validateIconFile(makeFile('logo.png', 1024))).toBeNull()
    expect(validateIconFile(makeFile('logo.JPG', 1024))).toBeNull()
    expect(validateIconFile(makeFile('logo.jpeg', 1024))).toBeNull()
    expect(validateIconFile(makeFile('logo.webp', 1024))).toBeNull()
  })

  it('SVG / GIF / 无扩展名应被拒（SVG 可内嵌脚本，不在白名单）', () => {
    const message = '图标仅支持 png / jpg / jpeg / webp 格式'
    expect(validateIconFile(makeFile('logo.svg', 1024))).toBe(message)
    expect(validateIconFile(makeFile('logo.gif', 1024))).toBe(message)
    expect(validateIconFile(makeFile('logo', 1024))).toBe(message)
  })

  it('恰好 2MB 应放行，超过 1 字节应拒绝（边界）', () => {
    expect(validateIconFile(makeFile('logo.png', ICON_MAX_BYTES))).toBeNull()
    expect(validateIconFile(makeFile('logo.png', ICON_MAX_BYTES + 1))).toBe('图标文件不能超过 2MB')
  })
})
