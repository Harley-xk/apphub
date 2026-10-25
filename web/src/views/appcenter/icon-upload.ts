/*
 * 作者: Harley-xk
 * 创建: 2026-10-23
 *
 * 描述: 应用图标上传的前端约束：扩展名 / 大小白名单校验（与后端 IconUploadTokenDto、ICON_MAX_BYTES 对齐）
 */

/** 图标允许的扩展名（与后端 ICON_ALLOWED_EXTENSIONS 对齐；不含 SVG） */
export const ICON_ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

/** 图标大小上限 2MB（与后端 ICON_MAX_BYTES 对齐） */
export const ICON_MAX_BYTES = 2 * 1024 * 1024

/** el-upload 的 accept 取值 */
export const ICON_ACCEPT = 'image/png,image/jpeg,image/webp'

/**
 * 校验图标文件：合法返回 null，否则返回提示文案。
 * 以扩展名为准而非 file.type——部分系统对剪贴板 / 相机来源的文件不填 MIME。
 */
export function validateIconFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  if (!ICON_ALLOWED_EXTENSIONS.includes(ext))
    return '图标仅支持 png / jpg / jpeg / webp 格式'
  if (file.size > ICON_MAX_BYTES)
    return '图标文件不能超过 2MB'
  return null
}
