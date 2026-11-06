<!--
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 运营工作台首页：待办 → 指标 → 最近动态，单聚合端点取数，按后端字段级裁剪决定块是否渲染
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { getDashboardOverview } from '@/api/dashboard'
import type { DashboardOverviewVO, DashboardRange } from '@/api/dashboard'
import { orderChannelText, orderStatusText } from '@/api/subscription/order'

import RecentList from './components/RecentList.vue'
import type { RecentItem } from './components/RecentList.vue'
import StatCard from './components/StatCard.vue'
import TodoCard from './components/TodoCard.vue'

defineOptions({ name: 'Home' })

const RANGE_OPTIONS = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
] as const

const VERSION_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
}

const range = ref<DashboardRange>('7d')
const overview = ref<DashboardOverviewVO | null>(null)
const loading = ref(false)
const failed = ref(false)

const rangeText = computed(() => (range.value === '30d' ? '近 30 天' : '近 7 天'))

const updatedText = computed(() => {
  if (!overview.value) {
    return ''
  }
  return new Date(overview.value.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })
})

/** 是否至少有一个块可见（全部 null 时显示「暂无可查看的数据」） */
const hasVisibleBlock = computed(() => {
  const data = overview.value
  if (!data) {
    return false
  }
  return Object.values(data.todos).some(value => value !== null)
    || Object.values(data.metrics).some(value => value !== null)
    || Object.values(data.latest).some(value => value !== null)
})

const numberFormatter = new Intl.NumberFormat('zh-CN')
const amountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

function formatAmount(cent: number): string {
  return amountFormatter.format(cent / 100)
}

const orderItems = computed<RecentItem[]>(() =>
  (overview.value?.latest.orders ?? []).map(order => ({
    key: order.id,
    title: order.orderNo,
    subtitle: `${order.memberNickname} · ${order.appName} · ${orderChannelText(order.channel)} · ${orderStatusText(order.status)}`,
    meta: `¥${formatAmount(order.amount)}`,
    time: order.createTime,
  })),
)

const memberItems = computed<RecentItem[]>(() =>
  (overview.value?.latest.members ?? []).map(member => ({
    key: member.id,
    title: member.nickname,
    subtitle: member.registeredAppName ?? '未知来源',
    time: member.createTime,
  })),
)

const versionItems = computed<RecentItem[]>(() =>
  (overview.value?.latest.versions ?? []).map(version => ({
    key: version.id,
    title: `${version.appName} ${version.version}`,
    subtitle: VERSION_STATUS_TEXT[version.status] ?? version.status,
    time: version.createTime,
  })),
)

/** 拉取聚合概览：每次进入与切换区间都重新请求（页面不开启 keep-alive，设计 W8） */
async function load(): Promise<void> {
  loading.value = true
  failed.value = false
  try {
    overview.value = await getDashboardOverview(range.value)
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

watch(range, () => {
  void load()
})
</script>

<template>
  <div class="page-container dashboard">
    <header class="dashboard__header">
      <div>
        <h1 class="dashboard__title">
          工作台
        </h1>
        <p class="dashboard__subtitle">
          今天要处理什么，其次是平台核心指标与最近动态
        </p>
      </div>
      <div class="dashboard__actions">
        <span
          v-if="updatedText"
          class="dashboard__updated"
        >数据更新于 {{ updatedText }}</span>
        <el-button
          :loading="loading"
          @click="load"
        >
          刷新
        </el-button>
      </div>
    </header>

    <div class="dashboard__range">
      <el-radio-group v-model="range" size="small">
        <el-radio-button
          v-for="option in RANGE_OPTIONS"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
      <span class="dashboard__range-hint">区间影响新增 / 收入与趋势，到期窗口固定 7 天</span>
    </div>

    <el-skeleton
      v-if="loading && !overview"
      class="dashboard__skeleton"
      :rows="8"
      animated
    />

    <div
      v-else-if="failed"
      class="dashboard__error"
    >
      <span>加载失败</span>
      <el-button
        type="primary"
        size="small"
        @click="load"
      >
        重试
      </el-button>
    </div>

    <template v-else-if="overview">
      <div
        v-if="!hasVisibleBlock"
        class="dashboard__empty"
      >
        暂无可查看的数据
      </div>

      <template v-else>
        <section class="dashboard__section">
          <h2 class="dashboard__section-title">
            待办
          </h2>
          <el-row
            class="dashboard__grid"
            :gutter="12"
          >
            <el-col
              v-if="overview.todos.expiringSubscriptions !== null"
              :xs="24"
              :sm="12"
              :lg="8"
            >
              <TodoCard
                label="7 天内到期订阅"
                :count="overview.todos.expiringSubscriptions"
                hint="含今天起 7 个自然日内到期"
                to="/subscription/sub"
                link-text="去处理"
              />
            </el-col>
            <el-col
              v-if="overview.todos.pendingOrders !== null"
              :xs="24"
              :sm="12"
              :lg="8"
            >
              <TodoCard
                label="待支付订单"
                :count="overview.todos.pendingOrders"
                hint="待支付且未超过关单时间"
                to="/subscription/order"
                link-text="去处理"
              />
            </el-col>
            <el-col
              v-if="overview.todos.lockedMembers !== null"
              :xs="24"
              :sm="12"
              :lg="8"
            >
              <TodoCard
                label="被锁定会员"
                :count="overview.todos.lockedMembers"
                hint="连续登录失败触发锁定且尚未解锁"
                to="/member/member"
                link-text="去处理"
              />
            </el-col>
          </el-row>
        </section>

        <section class="dashboard__section">
          <h2 class="dashboard__section-title">
            平台指标
          </h2>
          <el-row
            class="dashboard__grid"
            :gutter="12"
          >
            <el-col
              v-if="overview.metrics.appTotal !== null && overview.metrics.appEnabled !== null"
              :xs="24"
              :sm="12"
              :lg="8"
              :xl="6"
            >
              <StatCard
                label="应用总数"
                :value="formatNumber(overview.metrics.appTotal)"
                :hint="`启用 ${formatNumber(overview.metrics.appEnabled)}`"
              />
            </el-col>
            <el-col
              v-if="overview.metrics.versionTotal !== null && overview.metrics.versionPublished !== null"
              :xs="24"
              :sm="12"
              :lg="8"
              :xl="6"
            >
              <StatCard
                label="版本总数"
                :value="formatNumber(overview.metrics.versionTotal)"
                :hint="`已发布 ${formatNumber(overview.metrics.versionPublished)}`"
              />
            </el-col>
            <el-col
              v-if="overview.metrics.memberTotal !== null && overview.metrics.memberNewInRange !== null"
              :xs="24"
              :sm="12"
              :lg="8"
              :xl="6"
            >
              <StatCard
                label="会员总数"
                :value="formatNumber(overview.metrics.memberTotal)"
                :hint="`${rangeText}新增 ${formatNumber(overview.metrics.memberNewInRange)}`"
                :sparkline="overview.sparkline.memberDaily?.map(point => point.count)"
                :sparkline-label="`${rangeText}会员新增趋势`"
              />
            </el-col>
            <el-col
              v-if="overview.metrics.subscriptionActive !== null && overview.metrics.subscriptionExpiringSoon !== null"
              :xs="24"
              :sm="12"
              :lg="8"
              :xl="6"
            >
              <StatCard
                label="有效订阅"
                :value="formatNumber(overview.metrics.subscriptionActive)"
                :hint="`7 天内到期 ${formatNumber(overview.metrics.subscriptionExpiringSoon)}`"
              />
            </el-col>
            <el-col
              v-if="overview.metrics.revenueInRange !== null"
              :xs="24"
              :sm="12"
              :lg="8"
              :xl="6"
            >
              <StatCard
                label="区间收入"
                :value="`¥${formatAmount(overview.metrics.revenueInRange)}`"
                :hint="`${rangeText}已支付订单合计`"
                :sparkline="overview.sparkline.revenueDaily?.map(point => point.amount)"
                :sparkline-label="`${rangeText}收入趋势`"
              />
            </el-col>
          </el-row>
        </section>

        <section class="dashboard__section">
          <h2 class="dashboard__section-title">
            最近动态
          </h2>
          <el-row
            class="dashboard__grid"
            :gutter="12"
          >
            <el-col
              v-if="overview.latest.orders !== null"
              :xs="24"
              :lg="8"
            >
              <RecentList
                title="最新订单"
                :items="orderItems"
                empty-text="暂无订单"
              />
            </el-col>
            <el-col
              v-if="overview.latest.members !== null"
              :xs="24"
              :lg="8"
            >
              <RecentList
                title="最近注册会员"
                :items="memberItems"
                empty-text="暂无会员"
              />
            </el-col>
            <el-col
              v-if="overview.latest.versions !== null"
              :xs="24"
              :lg="8"
            >
              <RecentList
                title="最近创建版本"
                :items="versionItems"
                empty-text="暂无版本"
              />
            </el-col>
          </el-row>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.dashboard__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.dashboard__title {
  margin: 0;
  color: var(--apphub-text-1);
  font-size: 22px;
}

.dashboard__subtitle {
  margin: 6px 0 0;
  color: var(--apphub-text-3);
  font-size: 13px;
}

.dashboard__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dashboard__updated {
  color: var(--apphub-text-3);
  font-size: 12px;
}

.dashboard__range {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.dashboard__range-hint {
  color: var(--apphub-text-3);
  font-size: 12px;
}

.dashboard__section {
  margin-bottom: 18px;
}

.dashboard__section-title {
  margin: 0 0 8px;
  color: var(--apphub-text-1);
  font-size: 15px;
  font-weight: 600;
}

.dashboard__grid {
  row-gap: 12px;
}

.dashboard__skeleton {
  padding: 16px;
}

.dashboard__error,
.dashboard__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 16px;
  border: 1px dashed var(--apphub-border);
  border-radius: var(--apphub-radius);
  color: var(--apphub-text-3);
  font-size: 14px;
}
</style>
