// 全链路用例：应用中心分组、应用注册凭证与列表点击查看、通道抽屉（stable 保护）、
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

  test('注册应用：凭证展示与列表点击查看 → 通道抽屉 stable 保护与增删 → 编辑 → 删除闭环', async ({ page }) => {
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

    // 凭证弹窗：AppKey ah_ 前缀 + AppSecret 32 位
    const credentialDialog = page.locator('.el-dialog').filter({ hasText: '请立即保存' })
    await expect(credentialDialog).toBeVisible()
    const codes = credentialDialog.locator('code')
    await expect(codes.nth(0)).toHaveText(/^ah_[a-z0-9]{16}$/)
    await expect(codes.nth(1)).toHaveText(/^[a-z0-9]{32}$/)
    const appSecret = await codes.nth(1).textContent()
    await credentialDialog.getByRole('button', { name: '我已妥善保存' }).click()

    // 行出现：公开客户端标签 + Electron 框架
    const row = page.locator('.vxe-body--row').filter({ hasText: name }).first()
    await expect(row).toBeVisible()
    await expect(row.locator('.el-tag--warning')).toHaveText('公开客户端')
    // 技术框架以官方 logo 图标展示（而非文字），悬停浮出全称
    await expect(row.locator('.framework-icon[data-framework="electron"]')).toBeVisible()

    // AppSecret 列恒为掩码，点击后按需拉取完整值弹窗展示（与注册时一致）
    await expect(row.locator('.secret-mask')).toHaveText('****')
    await row.locator('.secret-mask').click()
    const viewDialog = page.locator('.el-dialog').filter({ hasText: '凭证属于敏感信息' })
    await expect(viewDialog).toBeVisible()
    await expect(viewDialog.locator('code').nth(1)).toHaveText(appSecret ?? '')
    await viewDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(viewDialog).toBeHidden()

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

  test('注册应用：图标选图即直传 OSS，提交表单自动携带对象键', async ({ page }) => {
    // 直传数据面 mock：真桶依赖 STS_ROLE_ARN 与 RAM 角色 icons/* 授权，当前环境未配
    const objectKey = 'icons/20261023/e2e-icon.png'
    await page.route('**/api/appcenter/app/icon/upload-token', async (route) => {
      await route.fulfill({
        json: okBody({
          region: 'oss-cn-hangzhou',
          bucket: 'e2e-mock-bucket',
          objectKey,
          accessKeyId: 'sts-ak',
          accessKeySecret: 'sts-sk',
          securityToken: 'sts-token',
          expiration: new Date(Date.now() + 3600_000).toISOString(),
        }),
      })
    })
    await page.route('**aliyuncs.com/**', async (route) => {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'PUT, GET, OPTIONS',
        'access-control-allow-headers': '*',
      }
      if (route.request().method() === 'OPTIONS')
        await route.fulfill({ status: 200, headers: cors, body: '' })
      else
        await route.fulfill({ status: 200, headers: { ...cors, etag: '"e2e-icon-etag"' }, body: '' })
    })
    // 保存请求只观测不落库：后端保存会对对象键做 HeadObject 校验，mock 直传并未真的写桶
    let submitted: Record<string, unknown> | null = null
    await page.route('**/api/appcenter/app', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      submitted = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        json: okBody({
          id: '00000000-0000-4000-8000-0000000000e2',
          appKey: 'ah_e2eicon00000000',
          appSecret: 'a'.repeat(32),
        }),
      })
    })

    await page.goto('/appcenter/app')
    await page.getByRole('button', { name: '注册应用' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
    await dialog.getByPlaceholder('应用名称').fill(`图标应用${Date.now() % 100000}`)
    await dialog.getByText('桌面应用', { exact: true }).click()

    // 选择图片即触发上传，本地 objectURL 即时预览（不依赖列表刷新）
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'icon.png',
      mimeType: 'image/png',
      // 1×1 透明 PNG
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
    await expect(dialog.locator('.icon-image')).toBeVisible()
    await expect(page.locator('.el-message').getByText('图标上传成功')).toBeVisible()

    await dialog.getByRole('button', { name: '确定' }).click()
    await expect.poll(() => submitted?.iconUrl).toBe(objectKey)
  })

  test('注册应用：拖拽图片到图标区与选图走同一上传链路', async ({ page }) => {
    const objectKey = 'icons/20261025/e2e-drop.png'
    let tokenFileName = ''
    await page.route('**/api/appcenter/app/icon/upload-token', async (route) => {
      tokenFileName = (route.request().postDataJSON() as { fileName: string }).fileName
      await route.fulfill({
        json: okBody({
          region: 'oss-cn-hangzhou',
          bucket: 'e2e-mock-bucket',
          objectKey,
          accessKeyId: 'sts-ak',
          accessKeySecret: 'sts-sk',
          securityToken: 'sts-token',
          expiration: new Date(Date.now() + 3600_000).toISOString(),
        }),
      })
    })
    await page.route('**aliyuncs.com/**', async (route) => {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'PUT, GET, OPTIONS',
        'access-control-allow-headers': '*',
      }
      if (route.request().method() === 'OPTIONS')
        await route.fulfill({ status: 200, headers: cors, body: '' })
      else
        await route.fulfill({ status: 200, headers: { ...cors, etag: '"e2e-drop-etag"' }, body: '' })
    })

    await page.goto('/appcenter/app')
    await page.getByRole('button', { name: '注册应用' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '注册应用' })
    await dialog.getByPlaceholder('应用名称').fill(`拖拽图标应用${Date.now() % 100000}`)

    // 构造带文件项的 DataTransfer 并派发 drop（浏览器内真实拖拽事件语义）
    const dataTransfer = await page.evaluateHandle((base64: string) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'drop-icon.png', { type: 'image/png' }))
      return transfer
    }, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
    await dialog.locator('.icon-upload').dispatchEvent('drop', { dataTransfer })

    // 拖拽落地后与选图同链路：申请凭证（文件名来自拖入文件）→ 直传 → 本地即时预览
    await expect.poll(() => tokenFileName).toBe('drop-icon.png')
    await expect(dialog.locator('.icon-image')).toBeVisible()
    await expect(page.locator('.el-message').getByText('图标上传成功')).toBeVisible()

    await dialog.getByRole('button', { name: '取消' }).click()
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

    // 下载动作：签发签名 URL（mock）→ 浏览器按原始文件名下载（草稿 / 已发布 / 已下线均可下载）
    await page.route('**/api/appcenter/version/*/package/*/download-url', async (route) => {
      await route.fulfill({
        json: okBody({
          url: `https://oss-download-mock.example.com/${fileName}?Signature=e2e`,
          fileName,
          expiresIn: 7200,
        }),
      })
    })
    await page.route('**/oss-download-mock.example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-disposition': `attachment; filename="${fileName}"` },
        body: 'e2e-mock-package-body',
      })
    })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      clickRowAction(page, pkgRow, '下载'),
    ])
    expect(download.suggestedFilename()).toBe(fileName)

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

  test('已发布版本：包可补传 / 替换 / 删除，替换弹窗锁定槽位并提示不影响存量客户端', async ({ page }) => {
    // 页面级 mock 上下文：真后端无法在没有真实包记录的情况下发布，故整页以已发布版本数据驱动
    const now = Date.now()
    await page.route('**/api/appcenter/app/mock-app', async (route) => {
      await route.fulfill({
        json: okBody({
          id: 'mock-app', appKey: 'ah_mockapp', name: '已发布应用', appType: ['desktop'], clientType: 'public',
          framework: 'electron', iconUrl: null, description: null, status: 'enabled', sort: 0, createTime: now,
        }),
      })
    })
    await page.route('**/api/appcenter/app/mock-app/channel', async (route) => {
      await route.fulfill({
        json: okBody([{ id: 'mock-ch', appId: 'mock-app', code: 'stable', name: '稳定版', status: 'enabled', sort: 0, createTime: now }]),
      })
    })
    await page.route('**/api/appcenter/app/mock-app/version**', async (route) => {
      await route.fulfill({
        json: okBody({
          list: [{
            id: 'mock-v1', appId: 'mock-app', channelId: 'mock-ch', channelCode: 'stable', channelName: '稳定版',
            version: '1.0.1', title: '已发布版本', notes: null, forceUpdate: false,
            status: 'published', publishedAt: now, createTime: now,
          }],
          total: 1,
        }),
      })
    })
    await page.route('**/api/appcenter/version/mock-v1/package', async (route) => {
      await route.fulfill({
        json: okBody([{
          id: 'mock-pkg', versionId: 'mock-v1', platform: 'windows', arch: 'x64', fileName: 'app-setup-1.0.1.exe',
          fileSize: 1048576, sha256: 'a'.repeat(64), sha512: 'c2hhNTEyLW1vY2s=', minisignSignature: null,
          ossObjectKey: 'packages/ah_mockapp/stable/1.0.1/windows-x64/app-setup-1.0.1.exe',
          blockmapObjectKey: null, blockmapSha512: null, blockmapFileSize: null, createTime: now,
        }]),
      })
    })

    await page.goto('/appcenter/version?appId=mock-app')
    const versionRow = page.locator('.vxe-body--row').filter({ hasText: '1.0.1' }).first()
    await expect(versionRow.locator('.el-tag--success')).toHaveText('已发布')

    // 包抽屉：已发布版本仍显示上传入口，行内提供替换 / 删除
    await clickRowAction(page, versionRow, '安装包')
    const pkgDrawer = page.locator('.el-drawer').filter({ hasText: '安装包' })
    await expect(pkgDrawer.getByRole('button', { name: '上传安装包' })).toBeVisible()
    const pkgRow = pkgDrawer.locator('.vxe-body--row').filter({ hasText: 'app-setup-1.0.1.exe' }).first()
    await expect(pkgRow.getByRole('button', { name: '替换' })).toBeVisible()
    await expect(pkgRow.getByRole('button', { name: '删除' })).toBeVisible()

    // 替换弹窗：锁定平台 / 架构 + 明示「不影响已安装客户端」
    await clickRowAction(page, pkgRow, '替换')
    const replaceDialog = pkgDrawer.locator('.el-dialog').filter({ hasText: '替换安装包' })
    await expect(replaceDialog).toBeVisible()
    await expect(replaceDialog.getByText(/替换只影响之后的新下载/)).toBeVisible()
    await expect(replaceDialog.locator('.el-radio-button.is-disabled')).toHaveCount(5)
    await expect(replaceDialog.locator('.el-radio-button.is-active')).toContainText('Windows')
  })
})
