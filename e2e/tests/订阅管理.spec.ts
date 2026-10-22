// 全链路用例：订阅管理分组 + 三页闭环（计划新增 / 上下架 → 线下备案 → 订单已支付 → 订阅实例生效中 → 删除计划）。
// 前置数据沿会员管理用例同款手法：UI 注册应用读取仅此一次凭证、开放 API 签名直调注册会员，
// 备案闭环（备案即 paid、订阅即时顺延）走真后端；收尾删除会员与应用不污染种子。
// 选择器约定同系统管理：表格行 .vxe-body--row；下拉浮层挂 body 下 .el-select-dropdown__item
import { createHmac, randomBytes } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { loginViaApi } from './support/auth'
import { clickRowAction } from './support/row-actions'

// 订单页列多（12 列合计约 1750px），加宽视口避免横向滚动拆 fixed 操作列（同会员页约定）
test.use({ viewport: { width: 2000, height: 900 } })

test.beforeEach(async ({ page, request }) => {
  const health = await request.get('http://localhost:3000/api/health').catch(() => null)
  test.skip(!health?.ok(), '后端服务未启动或数据库未就绪（需先配置 server/.env 并启动 pnpm dev:server）')
  await loginViaApi(page, request)
})

/** 应用级签名请求头三件套（app 方案：签名串 [method, path, body, timestamp, nonce] 以应用 AppSecret 计算） */
function appSignHeaders(appKey: string, appSecret: string, method: string, path: string, body: string) {
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('hex')
  const sign = createHmac('sha256', appSecret)
    .update([method.toUpperCase(), path, body, timestamp, nonce].join('\n'), 'utf8')
    .digest('hex')
  return {
    'x-app-key': appKey,
    sign,
    timestamp,
    noncestr: nonce,
    'Content-Type': 'application/json',
  }
}

/** 点击 el-select 展开下拉：占位文案是内部 span（.el-select__placeholder）而非 input placeholder 属性；按全等匹配防「先选择应用」类子串误命中 */
function clickSelectPlaceholder(scope: Locator, text: string): Promise<void> {
  return scope.locator('.el-select__placeholder').filter({ hasText: new RegExp(`^${text}$`) }).click()
}

/** 在当前展开的可见下拉中点选项（el-tooltip persistent 使隐藏下拉常驻 DOM，须限定可见域再选） */
async function clickSelectOption(page: Page, text: string): Promise<void> {
  const option = page.locator('.el-select-dropdown:visible')
    .locator('.el-select-dropdown__item')
    .filter({ hasText: text })
    .first()
  await expect(option).toBeVisible()
  await option.click()
}

test.describe('订阅管理', () => {
  test('侧栏订阅管理分组展开三页子项', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('menuitem', { name: '订阅管理' }).click()
    await expect(page.getByRole('menuitem', { name: '订阅计划' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '订单管理' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '订阅实例' })).toBeVisible()
  })

  test('新增计划 → 线下备案 → 订单已支付 → 订阅实例生效中 → 上下架 → 删除闭环', async ({ page, request }) => {
    const suffix = Date.now() % 100000

    // 前置：UI 注册应用并读取仅此一次的凭证（AppKey + AppSecret）
    await page.goto('/appcenter/app')
    await page.getByRole('button', { name: '注册应用' }).click()
    const appDialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
    await appDialog.getByPlaceholder('应用名称').fill(`订阅e2e应用${suffix}`)
    await appDialog.getByText('桌面应用', { exact: true }).click()
    await appDialog.getByText(/机密客户端/).click()
    await appDialog.getByRole('button', { name: '确定' }).click()
    const credentialDialog = page.locator('.el-dialog').filter({ hasText: '请立即保存' })
    await expect(credentialDialog).toBeVisible()
    const appKey = await credentialDialog.locator('code').nth(0).textContent()
    const appSecret = await credentialDialog.locator('code').nth(1).textContent()
    await credentialDialog.getByRole('button', { name: '我已妥善保存' }).click()

    // 开放 API 注册会员（备案订单的归属主体）
    const nickname = `订阅e2e会员${suffix}`
    const registerPath = '/api/open/member/auth/register'
    const registerBody = JSON.stringify({
      type: 'password',
      identifier: `e2esub${suffix}`,
      credential: 'pass1234',
      nickname,
    })
    const registerRes = await request.post(`http://localhost:3000${registerPath}`, {
      headers: appSignHeaders(appKey!, appSecret!, 'POST', registerPath, registerBody),
      data: registerBody,
    })
    expect(((await registerRes.json()) as { code: number }).code).toBe(0)

    // 计划页：新增月付计划（应用下拉 + 档位 + 价格元录入）
    const planName = `e2e月付${suffix}`
    await page.goto('/subscription/plan')
    await page.getByPlaceholder('计划名模糊匹配').fill(planName)
    await page.getByRole('button', { name: '查询' }).click()
    // 同名计划不存在即可（库中历史 e2e 残留行不影响断言语义）
    await expect(page.locator('.vxe-body--row').filter({ hasText: planName })).toHaveCount(0)

    await page.getByRole('button', { name: '新增计划' }).click()
    const planDialog = page.locator('.el-dialog').filter({ hasText: '新增订阅计划' })
    await clickSelectPlaceholder(planDialog, '选择应用')
    await clickSelectOption(page, `订阅e2e应用${suffix}`)
    await planDialog.getByPlaceholder('如：专业版 · 年付').fill(planName)
    await clickSelectPlaceholder(planDialog, '选择档位')
    await clickSelectOption(page, '月付')
    await planDialog.locator('.el-form-item').filter({ hasText: '现价' }).locator('input').fill('15')
    await planDialog.getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('新增成功')).toBeVisible()

    const planRow = page.locator('.vxe-body--row').filter({ hasText: planName }).first()
    await expect(planRow).toBeVisible()
    await expect(planRow.locator('.el-tag--primary')).toHaveText('月付')
    await expect(planRow).toContainText('¥15.00')
    await expect(planRow.locator('.el-tag--success')).toHaveText('在售')

    // 订单页：线下收款备案（会员远程搜索 → 应用 → 在售计划联动，金额自动带出计划价）
    await page.goto('/subscription/order')
    await page.getByRole('button', { name: '线下收款备案' }).click()
    const offlineDialog = page.locator('.el-dialog').filter({ hasText: '线下收款备案' })
    // 会员远程搜索：占位是 span，聚焦后对 combobox 输入触发 remote-method
    const memberCombobox = offlineDialog.getByRole('combobox').first()
    await memberCombobox.click()
    await memberCombobox.fill(nickname)
    await clickSelectOption(page, nickname)
    await clickSelectPlaceholder(offlineDialog, '选择应用')
    await clickSelectOption(page, `订阅e2e应用${suffix}`)
    await clickSelectPlaceholder(offlineDialog, '先选择应用')
    await clickSelectOption(page, planName)
    await expect(offlineDialog.locator('.el-form-item').filter({ hasText: '实收金额' }).locator('input')).toHaveValue('15.00')
    await offlineDialog.getByRole('button', { name: '确认备案' }).click()
    await expect(page.locator('.el-message').getByText(/备案成功，订单号 AH/)).toBeVisible()

    // 订单列表：备案落为已支付（快照列回显计划名）
    const orderRow = page.locator('.vxe-body--row').filter({ hasText: nickname }).first()
    await expect(orderRow).toBeVisible()
    await expect(orderRow).toContainText(planName)
    await expect(orderRow.locator('.el-tag--success')).toHaveText('已支付')
    await expect(orderRow).toContainText('线下备案')

    // 订阅实例页：即时顺延产生生效中实例
    await page.goto('/subscription/sub')
    const subRow = page.locator('.vxe-body--row').filter({ hasText: nickname }).first()
    await expect(subRow).toBeVisible()
    await expect(subRow).toContainText(planName)
    await expect(subRow.locator('.el-tag--success')).toHaveText('生效中')

    // 计划页：下架 / 上架翻转（存量订阅不受影响）
    await page.goto('/subscription/plan')
    await page.getByPlaceholder('计划名模糊匹配').fill(planName)
    await page.getByRole('button', { name: '查询' }).click()
    await clickRowAction(page, planRow, '下架')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('已下架')).toBeVisible()
    await expect(planRow.locator('.el-tag--info')).toHaveText('下架')
    await clickRowAction(page, planRow, '上架')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('已上架')).toBeVisible()
    await expect(planRow.locator('.el-tag--success')).toHaveText('在售')

    // 收尾：删除计划（存量实例不受影响）→ 删除会员 → 删除应用
    await clickRowAction(page, planRow, '删除')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()
    await expect(page.locator('.vxe-body--row').filter({ hasText: planName })).toHaveCount(0)

    await page.goto('/member/list')
    await page.getByPlaceholder('昵称 / 手机 / 邮箱模糊匹配').fill(nickname)
    await page.getByRole('button', { name: '查询' }).click()
    const memberRow = page.locator('.vxe-body--row').filter({ hasText: nickname }).first()
    await clickRowAction(page, memberRow, '删除')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()

    await page.goto('/appcenter/app')
    const appRow = page.locator('.vxe-body--row').filter({ hasText: `订阅e2e应用${suffix}` }).first()
    await appRow.getByRole('button', { name: '更多' }).click()
    await page.getByRole('menuitem', { name: '删除应用' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()
    await expect(page.locator('.vxe-body--row').filter({ hasText: `订阅e2e应用${suffix}` })).toHaveCount(0)
  })
})
