<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 订阅订单管理页：渠道 / 状态 / 应用 / 订单号筛选分页 + 线下收款备案 + 待支付手动关单（订阅与支付设计 §3.5）
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
        <el-form-item label="渠道">
          <el-select v-model="queryParam.channel" placeholder="全部渠道" clearable style="width: 130px">
            <el-option
              v-for="option in ORDER_CHANNEL_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryParam.status" placeholder="全部状态" clearable style="width: 130px">
            <el-option
              v-for="option in ORDER_STATUS_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="订单号">
          <el-input
            v-model="queryParam.orderNo"
            placeholder="精确匹配"
            clearable
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
        <el-form-item>
          <el-button v-hasPermi="'subscription:order:offline-create'" type="primary" @click="offlineDialogRef?.open()">
            线下收款备案
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
        <template #amount="{ row }">
          ¥{{ formatCentAmount(row.amount) }}
        </template>
        <template #channel="{ row }">
          {{ orderChannelText(row.channel) }}
        </template>
        <template #status="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">
            {{ orderStatusText(row.status) }}
          </el-tag>
        </template>
        <template #transactionId="{ row }">
          {{ row.transactionId ?? '-' }}
        </template>
        <template #offlineNote="{ row }">
          {{ row.offlineNote ?? '-' }}
        </template>
        <template #action="{ row }">
          <el-button
            v-if="row.status === 'pending'"
            v-hasPermi="'subscription:order:close'"
            link
            type="danger"
            @click="handleClose(row)"
          >
            关闭订单
          </el-button>
          <span v-else class="action-placeholder">-</span>
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

    <OfflineCreateDialog ref="offlineDialogRef" :app-options="appOptions" @saved="handleQuery" />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'

import { getAppOptions } from '@/api/appcenter/app'
import type { OrderVO } from '@/api/subscription/order'
import {
  closeOrder,
  getOrderPage,
  ORDER_CHANNEL_OPTIONS,
  orderChannelText,
  ORDER_STATUS_OPTIONS,
  orderStatusText,
} from '@/api/subscription/order'
import { periodTypeText } from '@/api/subscription/plan'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter, formatCentAmount } from '@/utils/format'
import OfflineCreateDialog from '@/views/subscription/order/components/OfflineCreateDialog.vue'

// 与路由 name 对齐（keep-alive 缓存键契约）
defineOptions({ name: 'SubscriptionOrder' })

/** 列定义（field 即列宽 / 列序持久化标识，设计见 docs/前端/表格组件设计.md） */
const columns: ApphubTableColumn[] = [
  { field: 'orderNo', title: '订单号', width: 220 },
  { field: 'memberNickname', title: '会员', minWidth: 130 },
  { field: 'appName', title: '应用', minWidth: 140 },
  { field: 'planName', title: '计划（快照）', minWidth: 190, slot: 'planName' },
  { field: 'amount', title: '实收金额', width: 110, slot: 'amount' },
  { field: 'channel', title: '渠道', width: 100, slot: 'channel' },
  { field: 'status', title: '状态', width: 95, slot: 'status' },
  { field: 'transactionId', title: '流水号', minWidth: 140, slot: 'transactionId' },
  { field: 'paidAt', title: '支付时间', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'createTime', title: '创建时间', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'offlineNote', title: '备案备注', minWidth: 140, slot: 'offlineNote' },
  { field: 'action', title: '操作', width: 110, fixed: 'right', slot: 'action' },
]

const loading = ref(false)
const tableData = ref<OrderVO[]>([])
const total = ref(0)
/** 应用下拉数据源（筛选与备案弹窗共用） */
const appOptions = ref<{ id: string, name: string }[]>([])

const queryParam = reactive({
  pageNo: 1,
  pageSize: 10,
  appId: undefined as string | undefined,
  channel: undefined as string | undefined,
  status: undefined as string | undefined,
  orderNo: '',
})

const offlineDialogRef = ref<InstanceType<typeof OfflineCreateDialog>>()

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
    const page = await getOrderPage({
      pageNo: queryParam.pageNo,
      pageSize: queryParam.pageSize,
      appId: queryParam.appId || undefined,
      channel: queryParam.channel || undefined,
      status: queryParam.status || undefined,
      orderNo: queryParam.orderNo || undefined,
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
  queryParam.channel = undefined
  queryParam.status = undefined
  queryParam.orderNo = ''
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

/** 档位标签配色（与计划页保持一致） */
function periodTagType(periodType: string): 'primary' | 'info' | 'warning' | 'success' {
  if (periodType === 'permanent')
    return 'success'
  if (periodType === 'yearly')
    return 'warning'
  if (periodType === 'quarterly')
    return 'info'
  return 'primary'
}

/** 订单状态配色（pending 提示可操作，closed 弱化） */
function statusTagType(status: string): 'warning' | 'success' | 'info' {
  if (status === 'paid')
    return 'success'
  if (status === 'pending')
    return 'warning'
  return 'info'
}

async function handleClose(order: OrderVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定关闭订单「${order.orderNo}」吗？关闭后渠道回调到达将只做留痕受理`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await closeOrder(order.id)
  ElMessage.success('订单已关闭')
  loadTable()
}
</script>

<style scoped>
.plan-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-placeholder {
  color: var(--apphub-text-secondary, #909399);
}
</style>
