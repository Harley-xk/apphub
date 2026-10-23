<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 订阅实例管理页：应用 / 状态筛选分页，到期实时打标（生效中 / 已过期，永久档显示永久，主张 S2）
-->
<template>
  <div class="page-container">
    <el-card>
      <el-form class="search-bar" inline :model="queryParam" @submit.prevent>
        <el-form-item label="所属应用">
          <el-select v-model="queryParam.appId" placeholder="全部应用" clearable style="width: 200px">
            <el-option
              v-for="item in appOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryParam.state" placeholder="全部" clearable style="width: 130px">
            <el-option
              v-for="option in SUBSCRIPTION_STATE_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
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
    </el-card>

    <el-card class="table-card">
      <ApphubTable :columns="columns" :data="tableData" :loading="loading">
        <template #planName="{ row }">
          <div class="plan-name-cell">
            <span>{{ row.planName }}</span>
            <el-tag size="small" :type="periodTagType(row.periodType)">
              {{ periodTypeText(row.periodType) }}
            </el-tag>
          </div>
        </template>
        <template #expireAt="{ row }">
          <el-tag v-if="row.permanent" size="small" type="success">
            永久
          </el-tag>
          <span v-else>{{ formatDateTime(row.expireAt) }}</span>
        </template>
        <template #state="{ row }">
          <el-tag :type="row.state === 'active' ? 'success' : 'info'" size="small">
            {{ subscriptionStateText(row.state) }}
          </el-tag>
        </template>
      </ApphubTable>

      <el-pagination
        class="pagination-bar"
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        :current-page="queryParam.pageNo"
        :page-size="queryParam.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        @current-change="handlePageChange"
        @size-change="handleSizeChange"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { getAppOptions } from '@/api/appcenter/app'
import { periodTypeText } from '@/api/subscription/plan'
import type { SubscriptionVO } from '@/api/subscription/sub'
import {
  getSubscriptionPage,
  SUBSCRIPTION_STATE_OPTIONS,
  subscriptionStateText,
} from '@/api/subscription/sub'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter, formatDateTime } from '@/utils/format'

// 与路由 name 对齐（keep-alive 缓存键契约）
defineOptions({ name: 'SubscriptionSub' })

/** 列定义（field 即列宽 / 列序持久化标识，设计见 docs/前端/表格组件设计.md） */
const columns: ApphubTableColumn[] = [
  { field: 'memberNickname', title: '会员', minWidth: 140 },
  { field: 'appName', title: '应用', minWidth: 140 },
  { field: 'planName', title: '当前计划', minWidth: 190, slot: 'planName' },
  { field: 'startAt', title: '开始时间', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'expireAt', title: '到期时间', minWidth: 170, slot: 'expireAt' },
  { field: 'lastRenewAt', title: '最近续费', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'state', title: '状态', width: 95, slot: 'state' },
]

const loading = ref(false)
const tableData = ref<SubscriptionVO[]>([])
const total = ref(0)
/** 应用下拉数据源 */
const appOptions = ref<{ id: string, name: string }[]>([])

const queryParam = reactive({
  pageNo: 1,
  pageSize: 10,
  appId: undefined as string | undefined,
  state: undefined as string | undefined,
})

onMounted(() => {
  loadApps()
  loadTable()
})

/** 应用下拉改用精简选项接口：后端按 appcenter 域数据范围收窄，天然只含授权应用 */
async function loadApps(): Promise<void> {
  const options = await getAppOptions()
  appOptions.value = options.map(app => ({ id: app.id, name: app.name }))
}

async function loadTable(): Promise<void> {
  loading.value = true
  try {
    const page = await getSubscriptionPage({
      pageNo: queryParam.pageNo,
      pageSize: queryParam.pageSize,
      appId: queryParam.appId || undefined,
      state: queryParam.state || undefined,
    })
    tableData.value = page.list
    total.value = page.total
  }
  finally {
    loading.value = false
  }
}

function handleQuery(): void {
  queryParam.pageNo = 1
  loadTable()
}

function handleReset(): void {
  queryParam.appId = undefined
  queryParam.state = undefined
  handleQuery()
}

function handlePageChange(pageNo: number): void {
  queryParam.pageNo = pageNo
  loadTable()
}

function handleSizeChange(pageSize: number): void {
  queryParam.pageSize = pageSize
  queryParam.pageNo = 1
  loadTable()
}

/** 档位标签配色（与计划 / 订单页保持一致） */
function periodTagType(periodType: string): 'primary' | 'info' | 'warning' | 'success' {
  if (periodType === 'permanent')
    return 'success'
  if (periodType === 'yearly')
    return 'warning'
  if (periodType === 'quarterly')
    return 'info'
  return 'primary'
}
</script>

<style scoped>
.plan-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
