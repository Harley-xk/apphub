// 全链路用例：应用管理员与数据范围（应用管理员与数据范围设计 §12）——
// 管理员在用户管理页创建账户 → 分配「应用管理员」角色 → 授权应用 →
// 以该账户登录后应用列表只含授权应用、无注册入口、订阅页应用筛选同源收窄。
// 依赖后端与 PostgreSQL 就绪且已执行 1792310400000 迁移（app_admin 种子角色）；
// 探测失败时整组自动跳过。写操作为「创建 → 验证 → 清理」闭环，不污染种子数据
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

import { clickRowAction } from './support/row-actions'

// 应用页列多，加宽视口消除横向滚动（fixed 操作列拆分的既有前提，见应用管理用例）
test.use({ viewport: { width: 1600, height: 900 } })

const BACKEND = 'http://localhost:3000/api'

test.beforeEach(async ({ page, request }) => {
  const health = await request.get('http://localhost:3000/api/health').catch(() => null)
  test.skip(!health?.ok(), '后端服务未启动或数据库未就绪（需先配置 server/.env 并启动 pnpm dev:server）')
  // 管理员登录态用 evaluate 注入而非 addInitScript：本用例需中途切换身份，
  // initScript 会在每次导航时把 token 覆盖回管理员（身份切换失效）
  const adminToken = await loginToken(request, 'admin')
  await page.goto('/login')
  await page.evaluate(value => localStorage.setItem('APPHUB_TOKEN', value), adminToken)
})

/** 经登录接口取 token（登录接口双豁免，不参与请求签名） */
async function loginToken(request: APIRequestContext, username: string): Promise<string> {
  const response = await request.post(`${BACKEND}/system/auth/login`, {
    data: { username, password: 'admin123' },
  })
  expect(response.ok(), `账号 ${username} 登录应成功`).toBe(true)
  const { data } = await response.json() as { data: { token: string } }
  return data.token
}

/** 切换页面登录身份：写入 token 后整页导航（重建 store 与权限信息） */
async function useToken(page: Page, token: string, path: string): Promise<void> {
  await page.evaluate(value => localStorage.setItem('APPHUB_TOKEN', value), token)
  await page.goto(path)
}

/** 注册应用（UI）：返回应用名 */
async function createApp(page: Page, name: string): Promise<void> {
  await page.goto('/appcenter/app')
  await page.getByRole('button', { name: '注册应用' }).click()
  const dialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
  await dialog.getByPlaceholder('应用名称').fill(name)
  await dialog.getByText('桌面应用', { exact: true }).click()
  await dialog.getByText(/公开客户端（直连/).click()
  await dialog.getByRole('button', { name: '确定' }).click()
  const credentialDialog = page.locator('.el-dialog').filter({ hasText: '请立即保存' })
  await credentialDialog.getByRole('button', { name: '我已妥善保存' }).click()
  await expect(page.locator('.vxe-body--row').filter({ hasText: name }).first()).toBeVisible()
}

/** 删除应用（UI 闭环清理） */
async function deleteApp(page: Page, name: string): Promise<void> {
  await page.goto('/appcenter/app')
  const row = page.locator('.vxe-body--row').filter({ hasText: name }).first()
  await row.getByRole('button', { name: '更多' }).click()
  await page.getByRole('menuitem', { name: '删除应用' }).click()
  await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
  await expect(page.locator('.vxe-body--row').filter({ hasText: name })).toHaveCount(0)
}

test.describe('应用管理员与数据范围', () => {
  test('仅可见被授权应用：列表收窄、无注册入口、订阅筛选项一致', async ({ page, request }) => {
    const suffix = Date.now() % 100000
    // 两个应用名不得互为子串（hasText 为包含匹配，避免清理定位串行误伤）
    const appName = `专属应用${suffix}`
    const otherAppName = `旁路应用${suffix}`
    const username = `e2e_appadmin_${suffix}`
    const nickname = `应用管理员${suffix}`

    // 前置数据：两个应用 + 一个待授权账户
    await createApp(page, appName)
    await createApp(page, otherAppName)

    await page.goto('/system/user')
    await page.getByRole('button', { name: '新增用户' }).click()
    const userDialog = page.locator('.el-dialog').filter({ hasText: '新增用户' })
    await userDialog.getByPlaceholder('登录账号（创建后不可修改）').fill(username)
    await userDialog.getByPlaceholder('用户昵称').fill(nickname)
    await userDialog.getByRole('button', { name: '确定' }).click()
    const userRow = page.locator('.vxe-body--row').filter({ hasText: nickname }).first()
    await expect(userRow).toBeVisible()

    // 分配「应用管理员」角色（数据范围 = 按应用）
    await clickRowAction(page, userRow, '分配角色')
    const roleDialog = page.locator('.el-dialog').filter({ hasText: '分配角色' })
    // el-checkbox 原生 input 为隐藏元素：点击 label 文本完成勾选（同系统管理用例约定）
    await roleDialog.getByText('应用管理员（app_admin）').click()
    await expect(roleDialog.getByRole('checkbox', { name: '应用管理员' })).toBeChecked()
    await roleDialog.getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('分配成功')).toBeVisible()

    // 授权：仅勾选第一个应用（远程搜索回显）
    await clickRowAction(page, userRow, '应用授权')
    const scopeDialog = page.locator('.el-dialog').filter({ hasText: '应用授权' })
    // 多选 + 远程搜索：点开即聚焦筛选输入框，直接键盘输入触发 remote-method
    // （el-select 的 placeholder 不在 input 属性上，定位走交互而非占位符）
    await scopeDialog.locator('.el-select').click()
    await page.keyboard.type(appName)
    // 名称前缀收窄（授权弹窗选项的可访问名 = 名称 + AppKey）
    await page.getByRole('option', { name: new RegExp(`^${appName} `) }).click()
    // 点弹窗标题收起下拉（Escape 在弹层内不一定关 popper），避免下拉层挡住底部按钮
    await scopeDialog.locator('.el-dialog__header').click()
    await expect(page.getByRole('option', { name: new RegExp(`^${appName} `) })).toBeHidden()
    await scopeDialog.getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('授权已保存')).toBeVisible()

    // 以应用管理员身份登录：应用列表只剩授权应用，且无注册入口（无 app:create）
    const scopedToken = await loginToken(request, username)
    await useToken(page, scopedToken, '/appcenter/app')
    await expect(page.locator('.vxe-body--row').filter({ hasText: appName }).first()).toBeVisible()
    await expect(page.locator('.vxe-body--row').filter({ hasText: otherAppName })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '注册应用' })).toHaveCount(0)

    // 订阅计划页应用筛选同源（/appcenter/app/options）收窄
    await page.goto('/subscription/plan')
    const appFilter = page.locator('.el-form-item').filter({ hasText: '所属应用' }).locator('.el-select')
    await appFilter.click()
    // 订阅页选项仅以 label 渲染（无 AppKey 提示），可访问名即应用名
    await expect(page.getByRole('option', { name: appName, exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: otherAppName, exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // 清理：切回管理员，删除账户与应用（无已发布版本可删）
    const adminToken = await loginToken(request, 'admin')
    await useToken(page, adminToken, '/system/user')
    const cleanupRow = page.locator('.vxe-body--row').filter({ hasText: nickname }).first()
    await clickRowAction(page, cleanupRow, '删除')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.vxe-body--row').filter({ hasText: nickname })).toHaveCount(0)
    await deleteApp(page, appName)
    await deleteApp(page, otherAppName)
  })
})
