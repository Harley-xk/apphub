// 全链路用例：会员中心分组、会员管理页闭环（列表 / 详情抽屉凭证清单 / 解绑 / 重置密码 / 启停 / 删除）。
// 会员由开放 API 注册产生（管理端无新增入口）：先经 UI 注册应用读取 AppKey/AppSecret（仅此一次），
// 再以应用级 HMAC 签名（app 方案，签名串构造与两端契约一致）直调注册 / 绑定接口造真数据，
// 页面验收走真后端闭环；收尾删除会员与应用不污染种子。
// 选择器约定同系统管理：表格行 .vxe-body--row；抽屉内表格行同样定位
import { createHmac, randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { loginViaApi } from './support/auth'
import { clickRowAction } from './support/row-actions'

// 会员列表列多（约 1120px），默认 1280 视口下出现横向滚动时 vxe 会把 fixed 操作列拆到
// 独立 fixed wrapper（行内定位不到操作按钮）；加宽视口消除滚动，操作列与数据行合并渲染
test.use({ viewport: { width: 1600, height: 900 } })

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

test.describe('会员中心', () => {
  test('侧栏会员中心分组展开会员管理子项', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('menuitem', { name: '会员中心' }).click()
    await expect(page.getByRole('menuitem', { name: '会员管理' })).toBeVisible()
  })

  test('开放 API 注册会员 → 列表检索 → 详情抽屉（凭证 / 重置密码 / 解绑）→ 启停 → 删除闭环', async ({ page, request }) => {
    const suffix = Date.now() % 100000

    // 前置：UI 注册应用并读取仅此一次的凭证（AppKey + AppSecret）
    await page.goto('/appcenter/app')
    await page.getByRole('button', { name: '注册应用' }).click()
    const appDialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
    await appDialog.getByPlaceholder('应用名称').fill(`会员e2e应用${suffix}`)
    await appDialog.getByText('桌面应用', { exact: true }).click()
    await appDialog.getByText(/机密客户端/).click()
    await appDialog.getByRole('button', { name: '确定' }).click()
    const credentialDialog = page.locator('.el-dialog').filter({ hasText: '请立即保存' })
    await expect(credentialDialog).toBeVisible()
    const appKey = await credentialDialog.locator('code').nth(0).textContent()
    const appSecret = await credentialDialog.locator('code').nth(1).textContent()
    await credentialDialog.getByRole('button', { name: '我已妥善保存' }).click()
    expect(appKey).toMatch(/^ah_[a-z0-9]{16}$/)

    // 开放 API 注册会员（注册即登录，返回令牌对）并绑定第二条密码凭证
    const nickname = `端到端会员${suffix}`
    const registerPath = '/api/open/member/auth/register'
    const registerBody = JSON.stringify({
      type: 'password',
      identifier: `e2emember${suffix}`,
      credential: 'pass1234',
      nickname,
    })
    const registerRes = await request.post(`http://localhost:3000${registerPath}`, {
      headers: appSignHeaders(appKey!, appSecret!, 'POST', registerPath, registerBody),
      data: registerBody,
    })
    const registerJson = (await registerRes.json()) as { code: number, data?: { accessToken: string } }
    expect(registerJson.code).toBe(0)

    const bindPath = '/api/open/member/auth/bind'
    const bindBody = JSON.stringify({
      type: 'password',
      identifier: `e2ebind${suffix}`,
      credential: 'bind1234',
    })
    const bindRes = await request.post(`http://localhost:3000${bindPath}`, {
      headers: {
        ...appSignHeaders(appKey!, appSecret!, 'POST', bindPath, bindBody),
        Authorization: `Bearer ${registerJson.data!.accessToken}`,
      },
      data: bindBody,
    })
    expect(((await bindRes.json()) as { code: number }).code).toBe(0)

    // 列表检索：昵称关键字命中，状态为正常
    await page.goto('/member/list')
    await page.getByPlaceholder('昵称 / 手机 / 邮箱模糊匹配').fill(nickname)
    await page.getByRole('button', { name: '查询' }).click()
    const row = page.locator('.vxe-body--row').filter({ hasText: nickname }).first()
    await expect(row).toBeVisible()
    await expect(row.locator('.el-tag--success')).toHaveText('正常')

    // 详情抽屉：描述信息 + 凭证清单两条（主密码 + 绑定密码，password 标识原样展示）
    await clickRowAction(page, row, '详情')
    const drawer = page.locator('.el-drawer').filter({ hasText: '会员详情' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText(nickname).first()).toBeVisible()
    const mainCredentialRow = drawer.locator('.vxe-body--row').filter({ hasText: `e2emember${suffix}` })
    await expect(mainCredentialRow).toBeVisible()
    const bindCredentialRow = drawer.locator('.vxe-body--row').filter({ hasText: `e2ebind${suffix}` })
    await expect(bindCredentialRow).toBeVisible()

    // 重置密码：新密码 12 位字母数字（仅此一次展示）
    await drawer.getByRole('button', { name: '重置密码' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    const passwordDialog = page.locator('.el-dialog').filter({ hasText: '请立即保存' })
    await expect(passwordDialog).toBeVisible()
    await expect(passwordDialog.locator('code')).toHaveText(/^[A-Za-z0-9]{12}$/)
    await passwordDialog.getByRole('button', { name: '我已妥善保存' }).click()

    // 解绑第二条凭证：列表剩一条（最后一条密码凭证后端拒绝解绑，不触达）
    await clickRowAction(page, bindCredentialRow, '解绑')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('已解绑')).toBeVisible()
    await expect(drawer.locator('.vxe-body--row').filter({ hasText: `e2ebind${suffix}` })).toHaveCount(0)
    await drawer.locator('.el-drawer__close-btn').click()

    // 启停：禁用后标签翻转，再启用恢复
    await clickRowAction(page, row, '禁用')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('已禁用')).toBeVisible()
    await expect(row.locator('.el-tag--info')).toHaveText('已禁用')
    await clickRowAction(page, row, '启用')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('已启用')).toBeVisible()
    await expect(row.locator('.el-tag--success')).toHaveText('正常')

    // 删除会员闭环 + 删除应用收尾
    await clickRowAction(page, row, '删除')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()
    await expect(page.locator('.vxe-body--row').filter({ hasText: nickname })).toHaveCount(0)

    await page.goto('/appcenter/app')
    const appRow = page.locator('.vxe-body--row').filter({ hasText: `会员e2e应用${suffix}` }).first()
    await clickRowAction(page, appRow, '删除应用')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()
    await expect(page.locator('.vxe-body--row').filter({ hasText: `会员e2e应用${suffix}` })).toHaveCount(0)
  })

  test('扫码登录（微信）自动注册 → 绑定支付宝 → 凭证类型标签展示（M4）', async ({ page, request }) => {
    const suffix = Date.now() % 100000

    // 前置：UI 注册应用并读取仅此一次的凭证（同闭环用例模式）
    await page.goto('/appcenter/app')
    await page.getByRole('button', { name: '注册应用' }).click()
    const appDialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
    await appDialog.getByPlaceholder('应用名称').fill(`扫码e2e应用${suffix}`)
    await appDialog.getByText('桌面应用', { exact: true }).click()
    await appDialog.getByText(/机密客户端/).click()
    await appDialog.getByRole('button', { name: '确定' }).click()
    const credentialDialog = page.locator('.el-dialog').filter({ hasText: '请立即保存' })
    await expect(credentialDialog).toBeVisible()
    const appKey = await credentialDialog.locator('code').nth(0).textContent()
    const appSecret = await credentialDialog.locator('code').nth(1).textContent()
    await credentialDialog.getByRole('button', { name: '我已妥善保存' }).click()

    // 微信扫码登录：应用侧 OAuth 换取 unionid 后走统一 login（type=wechat，credential 占位不校验 C4），
    // 查无凭证自动注册新会员（C5 登录即注册，携昵称）——验证码类凭证依赖短信 / 邮件通道，页面用例不可取码，
    // 以扫码路径覆盖「登录即注册 + 新类型凭证展示」
    const nickname = `扫码会员${suffix}`
    const loginPath = '/api/open/member/auth/login'
    const loginBody = JSON.stringify({
      type: 'wechat',
      identifier: `oE2eUnion${suffix}`,
      credential: 'oauth',
      nickname,
    })
    const loginRes = await request.post(`http://localhost:3000${loginPath}`, {
      headers: appSignHeaders(appKey!, appSecret!, 'POST', loginPath, loginBody),
      data: loginBody,
    })
    const loginJson = (await loginRes.json()) as { code: number, data?: { accessToken: string } }
    expect(loginJson.code).toBe(0)

    // 绑定支付宝凭证（扫码类型无验证码环节，携 access token 直接追加）
    const bindPath = '/api/open/member/auth/bind'
    const bindBody = JSON.stringify({
      type: 'alipay',
      identifier: `20880000${suffix}`,
      credential: 'oauth',
    })
    const bindRes = await request.post(`http://localhost:3000${bindPath}`, {
      headers: {
        ...appSignHeaders(appKey!, appSecret!, 'POST', bindPath, bindBody),
        Authorization: `Bearer ${loginJson.data!.accessToken}`,
      },
      data: bindBody,
    })
    expect(((await bindRes.json()) as { code: number }).code).toBe(0)

    // 列表检索 → 详情抽屉：凭证清单两条，扫码标识脱敏（保留前 6 后 4），以片段定位行
    await page.goto('/member/list')
    await page.getByPlaceholder('昵称 / 手机 / 邮箱模糊匹配').fill(nickname)
    await page.getByRole('button', { name: '查询' }).click()
    const row = page.locator('.vxe-body--row').filter({ hasText: nickname }).first()
    await expect(row).toBeVisible()
    await clickRowAction(page, row, '详情')
    const drawer = page.locator('.el-drawer').filter({ hasText: '会员详情' })
    await expect(drawer).toBeVisible()

    // 类型标签映射（M4 五类型展示）：微信 / 支付宝，验证状态恒「已验证」
    const wechatRow = drawer.locator('.vxe-body--row').filter({ hasText: 'oE2eUn' })
    await expect(wechatRow).toBeVisible()
    await expect(wechatRow.locator('.el-tag').first()).toHaveText('微信')
    await expect(wechatRow.locator('.el-tag').nth(1)).toHaveText('已验证')
    const alipayRow = drawer.locator('.vxe-body--row').filter({ hasText: '208800' })
    await expect(alipayRow).toBeVisible()
    await expect(alipayRow.locator('.el-tag').first()).toHaveText('支付宝')
    await drawer.locator('.el-drawer__close-btn').click()

    // 收尾：删除会员与应用，不污染种子
    await clickRowAction(page, row, '删除')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()

    await page.goto('/appcenter/app')
    const appRow = page.locator('.vxe-body--row').filter({ hasText: `扫码e2e应用${suffix}` }).first()
    await clickRowAction(page, appRow, '删除应用')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()
  })
})
