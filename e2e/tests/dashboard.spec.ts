// 纯前端链路用例：验证工作台的待办 / 指标 / 动态渲染、字段级裁剪（null 不渲染）与刷新 / 区间切换请求。
// 认证态与聚合接口均 mock，不依赖后端；后端权限裁剪与数据范围由 server 单测 / e2e 守护
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { mockAuthState } from './support/auth'

interface OverviewFixture {
  generatedAt: number
  range: '7d' | '30d'
  todos: {
    expiringSubscriptions: number | null
    pendingOrders: number | null
    lockedMembers: number | null
  }
  metrics: {
    appTotal: number | null
    appEnabled: number | null
    versionTotal: number | null
    versionPublished: number | null
    memberTotal: number | null
    memberNewInRange: number | null
    subscriptionActive: number | null
    subscriptionExpiringSoon: number | null
    revenueInRange: number | null
  }
  sparkline: {
    memberDaily: Array<{ date: string, count: number }> | null
    revenueDaily: Array<{ date: string, amount: number }> | null
  }
  latest: {
    orders: Array<Record<string, unknown>> | null
    members: Array<Record<string, unknown>> | null
    versions: Array<Record<string, unknown>> | null
  }
}

/** 全量可见视角（super_admin）：所有块都有数据 */
function createOverview(): OverviewFixture {
  const now = Date.now()
  const memberDaily = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-11-0${index + 1}`,
    count: index,
  }))
  const revenueDaily = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-11-0${index + 1}`,
    amount: index * 100,
  }))
  return {
    generatedAt: now,
    range: '7d',
    todos: { expiringSubscriptions: 2, pendingOrders: 1, lockedMembers: 3 },
    metrics: {
      appTotal: 5,
      appEnabled: 4,
      versionTotal: 8,
      versionPublished: 6,
      memberTotal: 120,
      memberNewInRange: 7,
      subscriptionActive: 30,
      subscriptionExpiringSoon: 2,
      revenueInRange: 123400,
    },
    sparkline: { memberDaily, revenueDaily },
    latest: {
      orders: [{
        id: 'order-1',
        orderNo: 'AH202611060001',
        memberNickname: '小明',
        appName: '应用 A',
        amount: 1500,
        channel: 'offline',
        status: 'paid',
        createTime: now,
      }],
      members: [{
        id: 'member-1',
        nickname: '小红',
        registeredAppName: '应用 A',
        createTime: now,
      }],
      versions: [{
        id: 'version-1',
        appName: '应用 A',
        version: '1.0.0',
        status: 'published',
        createTime: now,
      }],
    },
  }
}

/** 应用管理员视角：会员相关块全部为 null（后端按权限裁剪），前端不应渲染 */
function hideMemberBlocks(overview: OverviewFixture): OverviewFixture {
  return {
    ...overview,
    todos: { ...overview.todos, lockedMembers: null },
    metrics: { ...overview.metrics, memberTotal: null, memberNewInRange: null },
    sparkline: { ...overview.sparkline, memberDaily: null },
    latest: { ...overview.latest, members: null },
  }
}

/** 聚合接口 mock：记录每次 range 参数，按当前 fixture 返回 */
async function mockOverviewApi(page: Page, state: { fixture: OverviewFixture, ranges: string[] }): Promise<void> {
  await page.route(
    url => url.pathname === '/api/dashboard/overview',
    (route) => {
      state.ranges.push(new URL(route.request().url()).searchParams.get('range') ?? '')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: state.fixture }),
      })
    },
  )
}

test.beforeEach(async ({ page }) => {
  await mockAuthState(page)
})

test.describe('工作台', () => {
  test('全量可见视角：三张待办卡、五张 KPI 卡与三个动态块均渲染', async ({ page }) => {
    const state = { fixture: createOverview(), ranges: [] as string[] }
    await mockOverviewApi(page, state)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
    // 待办
    for (const label of ['7 天内到期订阅', '待支付订单', '被锁定会员'])
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    // 指标
    for (const label of ['应用总数', '版本总数', '会员总数', '有效订阅', '区间收入'])
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    // 动态
    for (const label of ['最新订单', '最近注册会员', '最近创建版本'])
      await expect(page.getByText(label, { exact: true })).toBeVisible()

    await expect(page.getByText('AH202611060001')).toBeVisible()
    await expect(page.getByText('¥1,234.00')).toBeVisible()
    expect(state.ranges).toEqual(['7d'])
  })

  test('字段级裁剪：会员块返回 null 时不渲染（应用 / 订阅块仍可见）', async ({ page }) => {
    const state = { fixture: hideMemberBlocks(createOverview()), ranges: [] as string[] }
    await mockOverviewApi(page, state)
    await page.goto('/')

    await expect(page.getByText('应用总数', { exact: true })).toBeVisible()
    await expect(page.getByText('有效订阅', { exact: true })).toBeVisible()
    await expect(page.getByText('最新订单', { exact: true })).toBeVisible()

    await expect(page.getByText('会员总数', { exact: true })).toHaveCount(0)
    await expect(page.getByText('最近注册会员', { exact: true })).toHaveCount(0)
    await expect(page.getByText('被锁定会员', { exact: true })).toHaveCount(0)
  })

  test('刷新按钮与区间切换都会重新请求聚合接口', async ({ page }) => {
    const state = { fixture: createOverview(), ranges: [] as string[] }
    await mockOverviewApi(page, state)
    await page.goto('/')
    await expect(page.getByText('应用总数', { exact: true })).toBeVisible()
    expect(state.ranges).toEqual(['7d'])

    await page.getByRole('button', { name: '刷新' }).click()
    await expect.poll(() => state.ranges.length).toBe(2)
    expect(state.ranges[1]).toBe('7d')

    state.fixture = { ...createOverview(), range: '30d' }
    await page.locator('.el-radio-button').filter({ hasText: '近 30 天' }).click()
    await expect.poll(() => state.ranges.length).toBe(3)
    expect(state.ranges[2]).toBe('30d')
  })
})
