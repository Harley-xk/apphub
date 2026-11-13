// 纯前端链路用例：验证活跃度页面的筛选联动、指标 / 趋势 / 分布渲染与无权直链 404。
// 认证态与两个查询接口均 mock，不依赖后端；口径与数据范围由 server 单测 / e2e 守护
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { mockAuthState } from './support/auth'

const DAY_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function todayKey(): string {
  return new Date(Date.now() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

function addDays(dateKey: string, delta: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

function createSummary(days: number) {
  const today = todayKey()
  const start = addDays(today, -(days - 1))
  return {
    deviceDau: 5,
    memberDau: 2,
    deviceActive: 16,
    memberActive: 6,
    newDevices: 3,
    trend: Array.from({ length: days }, (_, index) => ({
      date: addDays(start, index),
      deviceDau: index + 1,
      memberDau: index,
    })),
  }
}

const DISTRIBUTION = [
  { key: 'windows', deviceCount: 8, memberCount: 3 },
  { key: 'macos', deviceCount: 5, memberCount: 2 },
  { key: 'linux', deviceCount: 3, memberCount: 1 },
]

interface QueryState {
  summary: URLSearchParams[]
  distribution: URLSearchParams[]
}

async function mockAnalyticsApi(page: Page, state: QueryState): Promise<void> {
  await page.route(
    url => url.pathname === '/api/appcenter/app/options',
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: [
          { id: 'app-1', appKey: 'ah_demo0000000001', name: '示例应用' },
        ],
      }),
    }),
  )
  await page.route(
    url => url.pathname === '/api/analytics/activity/summary',
    (route) => {
      const params = new URL(route.request().url()).searchParams
      state.summary.push(params)
      const start = params.get('startDate') ?? todayKey()
      const end = params.get('endDate') ?? todayKey()
      const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: createSummary(days) }),
      })
    },
  )
  await page.route(
    url => url.pathname === '/api/analytics/activity/distribution',
    (route) => {
      state.distribution.push(new URL(route.request().url()).searchParams)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: DISTRIBUTION }),
      })
    },
  )
}

test.describe('应用活跃度', () => {
  test('默认近 7 天：五张指标卡、双图表与口径说明渲染，并携带区间参数', async ({ page }) => {
    const state: QueryState = { summary: [], distribution: [] }
    await mockAuthState(page, ['analytics:activity:query', 'appcenter:app:query'])
    await mockAnalyticsApi(page, state)
    await page.goto('/analytics/activity')

    for (const label of ['设备 DAU', '会员 DAU', '区间活跃设备', '区间活跃会员', '新增设备'])
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    await expect(page.getByText('会员口径 = 登录态活跃，未登录使用不计入')).toBeVisible()
    await expect(page.getByText('活跃趋势')).toBeVisible()
    await expect(page.getByText('维度分布')).toBeVisible()
    // 趋势图 + 分布图两个 canvas
    await expect(page.locator('canvas')).toHaveCount(2)

    await expect.poll(() => state.summary.length).toBe(1)
    const params = state.summary[0]
    expect(params.get('startDate')).toBe(addDays(todayKey(), -6))
    expect(params.get('endDate')).toBe(todayKey())
    expect(params.get('appId')).toBeNull()
    expect(state.distribution[0].get('dimension')).toBe('platform')
  })

  test('切换近 30 天与分布维度应重新请求并透传参数', async ({ page }) => {
    const state: QueryState = { summary: [], distribution: [] }
    await mockAuthState(page, ['analytics:activity:query', 'appcenter:app:query'])
    await mockAnalyticsApi(page, state)
    await page.goto('/analytics/activity')
    await expect.poll(() => state.summary.length).toBe(1)

    await page.locator('.el-radio-button').filter({ hasText: '近 30 天' }).click()
    await expect.poll(() => state.summary.length).toBe(2)
    expect(state.summary[1].get('startDate')).toBe(addDays(todayKey(), -29))
    // 区间切换同时刷新分布
    await expect.poll(() => state.distribution.length).toBe(2)

    // 分布维度切换：版本
    await page.locator('.chart-card').filter({ hasText: '维度分布' })
      .locator('.el-radio-button')
      .filter({ hasText: '版本' })
      .click()
    await expect.poll(() => state.distribution.length).toBe(3)
    expect(state.distribution[2].get('dimension')).toBe('version')
  })

  test('应用筛选应透传 appId 并同时刷新概览与分布', async ({ page }) => {
    const state: QueryState = { summary: [], distribution: [] }
    await mockAuthState(page, ['analytics:activity:query', 'appcenter:app:query'])
    await mockAnalyticsApi(page, state)
    await page.goto('/analytics/activity')
    await expect.poll(() => state.summary.length).toBe(1)

    await page.locator('.el-select').first().click()
    await page.getByRole('option', { name: '示例应用' }).click()
    await expect.poll(() => state.summary.length).toBe(2)
    expect(state.summary[1].get('appId')).toBe('app-1')
    await expect.poll(() => state.distribution.length).toBe(2)
    expect(state.distribution[1].get('appId')).toBe('app-1')
  })

  test('无 analytics:activity:query 权限时直链应落 404', async ({ page }) => {
    await mockAuthState(page, ['appcenter:app:query'])
    await page.goto('/analytics/activity')
    await expect(page.getByText('404')).toBeVisible()
  })
})
