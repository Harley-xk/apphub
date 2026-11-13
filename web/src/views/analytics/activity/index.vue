<!--
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 应用活跃度统计页：应用 / 时间 / 平台架构版本筛选 + 指标卡 + 双折线趋势 + 维度分布（设计 §8）
-->
<template>
  <div class="page-container analytics-activity">
    <el-card class="filter-card">
      <el-form class="search-bar" inline :model="filters" @submit.prevent>
        <el-form-item label="应用">
          <el-select
            v-model="filters.appId"
            placeholder="全部应用"
            clearable
            style="width: 200px"
            @change="handleQuery"
          >
            <el-option
              v-for="item in appOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="时间">
          <el-radio-group v-model="rangeType" @change="handleRangeTypeChange">
            <el-radio-button value="today">
              今日
            </el-radio-button>
            <el-radio-button value="7d">
              近 7 天
            </el-radio-button>
            <el-radio-button value="30d">
              近 30 天
            </el-radio-button>
            <el-radio-button value="custom">
              自定义
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="rangeType === 'custom'" label="区间">
          <el-date-picker
            v-model="customRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            :disabled-date="disabledDate"
            style="width: 260px"
            @change="handleCustomRangeChange"
          />
        </el-form-item>
        <el-form-item label="平台">
          <el-select
            v-model="filters.platform"
            placeholder="全部平台"
            clearable
            style="width: 140px"
            @change="handleQuery"
          >
            <el-option
              v-for="item in PLATFORM_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="架构">
          <el-select
            v-model="filters.arch"
            placeholder="全部架构"
            clearable
            style="width: 130px"
            @change="handleQuery"
          >
            <el-option
              v-for="item in ARCH_OPTIONS"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="版本">
          <el-input
            v-model="filters.version"
            placeholder="全部版本"
            clearable
            style="width: 140px"
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">
            查询
          </el-button>
          <el-button @click="handleReset">
            重置
          </el-button>
        </el-form-item>
      </el-form>
      <p class="filter-card__tip">
        统计区间：{{ dateRange[0] }} ~ {{ dateRange[1] }}（Asia/Shanghai 自然日，最长 180 天）；
        会员口径 = 登录态活跃，未登录使用不计入；数据自上报版本上线起统计。
      </p>
    </el-card>

    <div v-loading="loading" class="analytics-activity__body">
      <div class="kpi-grid">
        <div v-for="card in kpiCards" :key="card.key" class="kpi-card">
          <span class="kpi-card__label">{{ card.label }}</span>
          <span class="kpi-card__value">{{ formatNumber(card.value) }}</span>
          <span class="kpi-card__hint">{{ card.hint }}</span>
        </div>
      </div>

      <el-card class="chart-card">
        <template #header>
          <div class="chart-card__header">
            <span>活跃趋势</span>
            <span class="chart-card__subtitle">设备 DAU 与会员 DAU（会员 = 登录态活跃）</span>
          </div>
        </template>
        <ApphubChart :option="trendOption" height="320px" />
      </el-card>

      <el-card v-loading="distributionLoading" class="chart-card">
        <template #header>
          <div class="chart-card__header">
            <span>维度分布</span>
            <el-radio-group v-model="dimension" size="small" @change="handleDimensionChange">
              <el-radio-button value="platform">
                平台
              </el-radio-button>
              <el-radio-button value="arch">
                架构
              </el-radio-button>
              <el-radio-button value="version">
                版本
              </el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <ApphubChart
          v-if="distribution.length > 0"
          :option="distributionOption"
          height="300px"
        />
        <el-empty v-else description="当前区间暂无活跃数据" :image-size="80" />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'

import { getActivityDistribution, getActivitySummary } from '@/api/analytics/activity'
import type {
  ActivityDimension,
  ActivityDistributionItemVO,
  ActivityQueryParam,
  ActivitySummaryVO,
} from '@/api/analytics/activity'
import { getAppOptions } from '@/api/appcenter/app'
import { useAppStore } from '@/stores/app'

import ApphubChart from './components/ApphubChart.vue'

// 与路由 name 对齐（keep-alive 缓存键契约）
defineOptions({ name: 'AnalyticsActivity' })

const DAY_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 180

const PLATFORM_OPTIONS = [
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
  { value: 'web', label: 'Web' },
] as const

const ARCH_OPTIONS = ['x64', 'arm64', 'universal'] as const

/** 时间快捷区间 */
type RangeType = 'today' | '7d' | '30d' | 'custom'

const appStore = useAppStore()

const rangeType = ref<RangeType>('7d')
const customRange = ref<[string, string] | null>(null)
const filters = reactive({
  appId: undefined as string | undefined,
  platform: undefined as string | undefined,
  arch: undefined as string | undefined,
  version: '',
})
const dimension = ref<ActivityDimension>('platform')

const appOptions = ref<{ id: string, name: string }[]>([])
const summary = ref<ActivitySummaryVO | null>(null)
const distribution = ref<ActivityDistributionItemVO[]>([])
const loading = ref(false)
const distributionLoading = ref(false)

const numberFormatter = new Intl.NumberFormat('zh-CN')

function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

/** 上海自然日今天（固定 UTC+8，与后端统计口径一致） */
function todayKey(): string {
  return new Date(Date.now() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

/** 日期串加减天数（按 UTC 日历日做纯日期运算） */
function addDays(dateKey: string, delta: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** 区间自然日数（含首尾） */
function rangeDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS) + 1
}

/** 当前生效区间：快捷区间按今天推算，自定义取用户选择 */
const dateRange = computed<[string, string]>(() => {
  const today = todayKey()
  if (rangeType.value === 'today')
    return [today, today]
  if (rangeType.value === '30d')
    return [addDays(today, -29), today]
  if (rangeType.value === 'custom')
    return customRange.value ?? [addDays(today, -6), today]
  return [addDays(today, -6), today]
})

const kpiCards = computed(() => [
  { key: 'deviceDau', label: '设备 DAU', value: summary.value?.deviceDau ?? 0, hint: '区间最后一天活跃设备' },
  { key: 'memberDau', label: '会员 DAU', value: summary.value?.memberDau ?? 0, hint: '登录态活跃，未登录不计入' },
  { key: 'deviceActive', label: '区间活跃设备', value: summary.value?.deviceActive ?? 0, hint: '区间去重设备数' },
  { key: 'memberActive', label: '区间活跃会员', value: summary.value?.memberActive ?? 0, hint: '区间去重会员数（登录态）' },
  { key: 'newDevices', label: '新增设备', value: summary.value?.newDevices ?? 0, hint: '首次窗口激活在区间内' },
])

/** 图表主题色：从设计 token 读取，isDark 变化时强制重算（Canvas 无法直接消费 CSS 变量） */
const chartTheme = computed(() => {
  // 建立对主题切换的依赖，确保暗色 / 浅色切换后重读 token
  void appStore.isDark
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback
  return {
    device: read('--apphub-chart-device', '#0d9488'),
    member: read('--apphub-chart-member', '#d97706'),
    text: read('--apphub-text-2', '#5b6878'),
    border: read('--apphub-border', '#e2e8f0'),
  }
})

const trendOption = computed<EChartsCoreOption>(() => {
  const theme = chartTheme.value
  const points = summary.value?.trend ?? []
  return {
    tooltip: { trigger: 'axis' },
    legend: {
      data: ['设备 DAU', '会员 DAU'],
      textStyle: { color: theme.text },
      top: 0,
    },
    grid: { left: 16, right: 24, top: 40, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map(point => point.date),
      axisLine: { lineStyle: { color: theme.border } },
      axisLabel: { color: theme.text },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.text },
    },
    series: [
      {
        name: '设备 DAU',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        data: points.map(point => point.deviceDau),
        itemStyle: { color: theme.device },
        areaStyle: { color: theme.device, opacity: 0.08 },
      },
      {
        name: '会员 DAU',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        data: points.map(point => point.memberDau),
        itemStyle: { color: theme.member },
        areaStyle: { color: theme.member, opacity: 0.08 },
      },
    ],
  }
})

const distributionOption = computed<EChartsCoreOption>(() => {
  const theme = chartTheme.value
  const items = distribution.value
  const labels = items.map(item => item.key || '（空）')
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: {
      data: ['设备数', '会员数'],
      textStyle: { color: theme.text },
      top: 0,
    },
    grid: { left: 16, right: 24, top: 40, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: theme.border } },
      axisLabel: {
        color: theme.text,
        interval: 0,
        rotate: labels.length > 8 ? 30 : 0,
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.text },
    },
    series: [
      {
        name: '设备数',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: theme.device, borderRadius: [4, 4, 0, 0] },
        data: items.map(item => item.deviceCount),
      },
      {
        name: '会员数',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: theme.member, borderRadius: [4, 4, 0, 0] },
        data: items.map(item => item.memberCount),
      },
    ],
  }
})

/** 未来日期不可选（统计只到当天） */
function disabledDate(date: Date): boolean {
  return date.getTime() > Date.now()
}

function buildParams(): ActivityQueryParam {
  const [startDate, endDate] = dateRange.value
  return {
    appId: filters.appId || undefined,
    startDate,
    endDate,
    platform: filters.platform || undefined,
    arch: filters.arch || undefined,
    version: filters.version.trim() || undefined,
  }
}

/** 区间合法性前置校验：倒序 / 超 180 天不发请求，直接提示（服务端同样兜底） */
function assertRange(): boolean {
  const [startDate, endDate] = dateRange.value
  if (!startDate || !endDate || startDate > endDate) {
    ElMessage.warning('开始日期不能晚于结束日期')
    return false
  }
  if (rangeDays(startDate, endDate) > MAX_RANGE_DAYS) {
    ElMessage.warning(`查询区间不能超过 ${MAX_RANGE_DAYS} 天`)
    return false
  }
  return true
}

async function loadSummary(): Promise<void> {
  if (!assertRange())
    return
  loading.value = true
  try {
    summary.value = await getActivitySummary(buildParams())
  }
  finally {
    loading.value = false
  }
}

async function loadDistribution(): Promise<void> {
  if (!assertRange())
    return
  distributionLoading.value = true
  try {
    distribution.value = await getActivityDistribution({
      ...buildParams(),
      dimension: dimension.value,
    })
  }
  finally {
    distributionLoading.value = false
  }
}

async function loadAll(): Promise<void> {
  if (!assertRange())
    return
  await Promise.all([loadSummary(), loadDistribution()])
}

function handleQuery(): void {
  void loadAll()
}

function handleRangeTypeChange(value: string | number | boolean | undefined): void {
  if (value === 'custom' && !customRange.value) {
    const today = todayKey()
    customRange.value = [addDays(today, -6), today]
  }
  void loadAll()
}

function handleCustomRangeChange(): void {
  void loadAll()
}

function handleDimensionChange(): void {
  void loadDistribution()
}

function handleReset(): void {
  filters.appId = undefined
  filters.platform = undefined
  filters.arch = undefined
  filters.version = ''
  rangeType.value = '7d'
  customRange.value = null
  dimension.value = 'platform'
  void loadAll()
}

async function loadApps(): Promise<void> {
  const options = await getAppOptions()
  appOptions.value = options.map(app => ({ id: app.id, name: app.name }))
}

onMounted(() => {
  void loadApps()
  void loadAll()
})
</script>

<style scoped>
.analytics-activity {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-card__tip {
  margin: 4px 0 0;
  color: var(--apphub-text-3);
  font-size: 12px;
  line-height: 1.6;
}

.analytics-activity__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  border: 1px solid var(--apphub-card-border);
  border-radius: var(--apphub-radius);
  background: var(--apphub-card-bg);
  box-shadow: var(--apphub-card-shadow);
}

.kpi-card__label {
  color: var(--apphub-text-2);
  font-size: 13px;
}

.kpi-card__value {
  color: var(--apphub-text-1);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.2;
}

.kpi-card__hint {
  color: var(--apphub-text-3);
  font-size: 12px;
}

.chart-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.chart-card__subtitle {
  color: var(--apphub-text-3);
  font-size: 12px;
}
</style>
