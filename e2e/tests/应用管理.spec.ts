// 全链路用例：应用中心分组、应用注册凭证（仅此一次展示）、通道抽屉（stable 保护）、
// 版本下钻页与安装包直传（页面级 mock：upload-token / 登记 / OSS 域名 PUT——真实链路依赖
// STS_ROLE_ARN 与真桶，当前环境未配 STS，故直传数据面 mock、管理面走真后端闭环）。
// 发布 / 下线状态机语义已由 server e2e 覆盖，此处不做真发布（真后端无包记录会触发前置校验拒绝）。
// 选择器约定同系统管理：表格行 .vxe-body--row；el-select 走表单项容器定位；名称带随机后缀不污染种子
import { expect, test } from '@playwright/test'

import { loginViaApi } from './support/auth'
import { clickRowAction, rowActionButton } from './support/row-actions'

// 应用管理页列多（约 1150px），默认 1280 视口下出现横向滚动时 vxe 会把 fixed 操作列拆到
// 独立 fixed wrapper（行内定位不到操作按钮）；加宽视口消除滚动，操作列与数据行合并渲染
test.use({ viewport: { width: 1600, height: 900 } })

test.beforeEach(async ({ page, request }) => {
  const health = await request.get('http://localhost:3000/api/health').catch(() => null)
  test.skip(!health?.ok(), '后端服务未启动或数据库未就绪（需先配置 server/.env 并启动 pnpm dev:server）')
  await loginViaApi(page, request)
})

/** 统一成功响应包裹（与后端 TransformInterceptor 同构） */
function okBody<T>(data: T) {
  return { code: 0, message: 'success', data }
}

test.describe('应用中心', () => {
  test('侧栏应用中心分组展开应用管理子项', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('menuitem', { name: '应用中心' }).click()
    await expect(page.getByRole('menuitem', { name: '应用管理' })).toBeVisible()
  })

  test('注册应用：凭证仅此一次展示 → 通道抽屉 stable 保护与增删 → 编辑 → 删除闭环', async ({ page }) => {
    await page.goto('/appcenter/app')

    // 注册：名称随机后缀 + 桌面形态 + 公开客户端 + Electron 框架
    const name = `端到端应用${Date.now() % 100000}`
    await page.getByRole('button', { name: '注册应用' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder('应用名称').fill(name)
    await dialog.getByText('桌面应用', { exact: true }).click()
    await dialog.getByText(/公开客户端（直连/).click()
    const frameworkItem = dialog.locator('.el-form-item').filter({ hasText: '技术框架' })
    await frameworkItem.locator('.el-select').click()
    await page.getByRole('option', { name: 'Electron' }).click()
    await dialog.getByRole('button', { name: '确定' }).click()

    // 凭证弹窗：AppKey ah_ 前缀 + AppSecret 32 位（仅此一次）
    const credentialDialog = page.locator('.el-dialog').filter({ hasText: '请立即保存' })
    await expect(credentialDialog).toBeVisible()
    const codes = credentialDialog.locator('code')
    await expect(codes.nth(0)).toHaveText(/^ah_[a-z0-9]{16}$/)
    await expect(codes.nth(1)).toHaveText(/^[a-z0-9]{32}$/)
    await credentialDialog.getByRole('button', { name: '我已妥善保存' }).click()

    // 行出现：公开客户端标签 + Electron 框架
    const row = page.locator('.vxe-body--row').filter({ hasText: name }).first()
    await expect(row).toBeVisible()
    await expect(row.locator('.el-tag--warning')).toHaveText('公开客户端')
    await expect(row.getByText('Electron')).toBeVisible()

    // 通道抽屉：默认列宽下「更新通道」为一级可见动作（不再藏进下拉），stable 预置且删除禁用
    await expect(row.getByRole('button', { name: '更新通道', exact: true })).toBeVisible()
    await clickRowAction(page, row, '更新通道')
    const drawer = page.locator('.el-drawer').filter({ hasText: '更新通道' })
    await expect(drawer).toBeVisible()
    const stableRow = drawer.locator('.vxe-body--row').filter({ hasText: 'stable' })
    await expect(stableRow).toBeVisible()
    // 通道抽屉 110px 列宽装不下「编辑 + 删除」，删除被收纳进「更多操作」popover——先展开再断言禁用态
    await expect(await rowActionButton(page, stableRow, '删除')).toBeDisabled()

    await drawer.getByRole('button', { name: '新增通道' }).click()
    const channelDialog = drawer.locator('.el-dialog').filter({ hasText: '新增通道' })
    await channelDialog.getByPlaceholder(/beta/).fill('beta')
    await channelDialog.getByPlaceholder(/公测版/).fill('公测版')
    await channelDialog.getByRole('button', { name: '确定' }).click()
    const betaRow = drawer.locator('.vxe-body--row').filter({ hasText: 'beta' })
    await expect(betaRow).toBeVisible()
    await clickRowAction(page, betaRow, '删除')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(drawer.locator('.vxe-body--row').filter({ hasText: 'beta' })).toHaveCount(0)
    await drawer.locator('.el-drawer__close-btn').click()

    // 编辑改名（调用方类型不可改）
    await clickRowAction(page, row, '编辑')
    const editDialog = page.locator('.el-dialog').filter({ hasText: '编辑应用' })
    await expect(editDialog.getByRole('radio', { name: /公开客户端/ })).toBeDisabled()
    await editDialog.getByPlaceholder('应用名称').fill(`${name}改`)
    await editDialog.getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('修改成功')).toBeVisible()

    // 删除闭环（无已发布版本允许删）
    const renamed = page.locator('.vxe-body--row').filter({ hasText: `${name}改` }).first()
    await clickRowAction(page, renamed, '删除应用')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()
    await expect(page.locator('.vxe-body--row').filter({ hasText: `${name}改` })).toHaveCount(0)
  })

  test('版本下钻页：新增草稿 → 安装包直传（mock）→ 包记录呈现 → 清理闭环', async ({ page }) => {
    // 直传数据面页面级 mock：STS 凭证签发 / OSS PUT / 登记回调 / 包列表
    const fileName = `app-setup-${Date.now() % 100000}.exe`
    const objectKey = `packages/e2e-mock/stable/1.0.1/windows-x64/${fileName}`
    await page.route('**/api/appcenter/version/*/package/upload-token', async (route) => {
      await route.fulfill({
        json: okBody({
          region: 'oss-cn-hangzhou',
          bucket: 'e2e-mock-bucket',
          objectKey,
          blockmapObjectKey: `${objectKey}.blockmap`,
          accessKeyId: 'sts-ak',
          accessKeySecret: 'sts-sk',
          securityToken: 'sts-token',
          expiration: new Date(Date.now() + 3600_000).toISOString(),
        }),
      })
    })
    // ali-oss 浏览器端 XHR 跨域直传 mock：glob 须用 **aliyuncs.com/**（子域是点分隔，
    // **/aliyuncs.com/** 只匹配路径式不匹配子域名）；真桶需在 OSS 控制台配 CORS 允许 PUT
    await page.route('**aliyuncs.com/**', async (route) => {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'PUT, GET, OPTIONS',
        'access-control-allow-headers': '*',
      }
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: cors, body: '' })
      }
      else {
        await route.fulfill({ status: 200, headers: { ...cors, etag: '"e2e-mock-etag"' }, body: '' })
      }
    })
    await page.route('**/api/appcenter/version/*/package', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ json: okBody('00000000-0000-4000-8000-0000000000e1') })
      }
      else {
        await route.fulfill({
          json: okBody([
            {
              id: '00000000-0000-4000-8000-0000000000e1',
              versionId: 'mock',
              platform: 'windows',
              arch: 'x64',
              fileName,
              fileSize: 1048576,
              sha256: 'a'.repeat(64),
              sha512: 'c2hhNTEyLW1vY2s=',
              minisignSignature: null,
              ossObjectKey: objectKey,
              blockmapObjectKey: null,
              blockmapSha512: null,
              blockmapFileSize: null,
              createTime: Date.now(),
            },
          ]),
        })
      }
    })

    // 前置：注册一个应用并进入版本下钻页
    const name = `版本应用${Date.now() % 100000}`
    await page.goto('/appcenter/app')
    await page.getByRole('button', { name: '注册应用' }).click()
    const appDialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
    await appDialog.getByPlaceholder('应用名称').fill(name)
    await appDialog.getByText('桌面应用', { exact: true }).click()
    await appDialog.getByText(/公开客户端（直连/).click()
    await appDialog.getByRole('button', { name: '确定' }).click()
    await page.locator('.el-dialog').filter({ hasText: '请立即保存' }).getByRole('button', { name: '我已妥善保存' }).click()
    const appRow = page.locator('.vxe-body--row').filter({ hasText: name }).first()
    await expect(appRow).toBeVisible()
    await clickRowAction(page, appRow, '版本')

    // 下钻页：头部应用上下文 + URL 携带 appId
    await expect(page).toHaveURL(/\/appcenter\/version\?appId=/)
    await expect(page.getByText(name).first()).toBeVisible()

    // 新增草稿版本：stable 通道 + 1.0.1
    await page.getByRole('button', { name: '新增版本' }).click()
    const versionDialog = page.locator('.el-dialog').filter({ hasText: '新增版本' })
    await expect(versionDialog).toBeVisible()
    const channelItem = versionDialog.locator('.el-form-item').filter({ hasText: '所属通道' })
    await channelItem.locator('.el-select').click()
    await page.getByRole('option', { name: /stable/ }).click()
    await versionDialog.getByPlaceholder(/semver/).fill('1.0.1')
    await versionDialog.getByPlaceholder(/性能优化版/).fill('端到端验证版')
    await versionDialog.getByRole('button', { name: '确定' }).click()
    const versionRow = page.locator('.vxe-body--row').filter({ hasText: '1.0.1' })
    await expect(versionRow).toBeVisible()
    await expect(versionRow.locator('.el-tag--warning')).toHaveText('草稿')

    // 安装包抽屉：上传安装包（选择文件即触发流式哈希；提交走 mock 直传链路）
    await clickRowAction(page, versionRow, '安装包')
    const pkgDrawer = page.locator('.el-drawer').filter({ hasText: '安装包' })
    await expect(pkgDrawer).toBeVisible()
    await pkgDrawer.getByRole('button', { name: '上传安装包' }).click()
    const uploadDialog = pkgDrawer.locator('.el-dialog').filter({ hasText: '上传安装包' })
    await expect(uploadDialog).toBeVisible()
    await uploadDialog.locator('input[type="file"]').first().setInputFiles({
      name: fileName,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('e2e-mock-package-body'),
    })
    // 哈希自动计算完成后可见（sha256 十六进制 64 位）
    await expect(uploadDialog.getByText(/^[0-9a-f]{64}$/)).toBeVisible()
    await uploadDialog.getByRole('button', { name: '上传并登记' }).click()
    await expect(page.locator('.el-message').getByText('上传并登记成功')).toBeVisible()

    // 包列表经 mock 回显：平台 Windows·x64 + 文件名 + 框架产物 sha512 已登记
    const pkgRow = pkgDrawer.locator('.vxe-body--row').filter({ hasText: fileName }).first()
    await expect(pkgRow).toBeVisible()
    await expect(pkgRow.getByText('Windows')).toBeVisible()
    await expect(pkgRow.locator('.el-tag--success').filter({ hasText: 'sha512' })).toBeVisible()
    await pkgDrawer.locator('.el-drawer__close-btn').click()

    // 清理闭环：删除草稿版本 → 返回删除应用
    await clickRowAction(page, versionRow, '删除')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message').getByText('删除成功')).toBeVisible()
    await page.getByRole('button', { name: '← 返回应用列表' }).click()
    await expect(page).toHaveURL(/\/appcenter\/app$/)
    const cleanupRow = page.locator('.vxe-body--row').filter({ hasText: name }).first()
    await clickRowAction(page, cleanupRow, '删除应用')
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.vxe-body--row').filter({ hasText: name })).toHaveCount(0)
  })
})
