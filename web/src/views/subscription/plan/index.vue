<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 订阅计划管理页：应用 / 关键字 / 状态筛选分页 + 新增编辑弹窗 + 上下架 + 删除（订阅与支付设计 §3.5）
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
        <el-form-item label="关键字">
          <el-input
            v-model="queryParam.keyword"
            placeholder="计划名模糊匹配"
            clearable
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryParam.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="在售" value="on" />
            <el-option label="下架" value="off" />
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
        <el-form-item>
          <el-button v-hasPermi="'subscription:plan:create'" type="primary" @click="openSave()">
            新增计划
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card">
      <ApphubTable :columns="columns" :data="tableData" :loading="loading">
        <template #name="{ row }">
          <div class="plan-name-cell">
            <span>{{ row.name }}</span>
            <el-tag size="small" :type="periodTagType(row.periodType)">
              {{ periodTypeText(row.periodType) }}
            </el-tag>
          </div>
        </template>
        <template #durationMonths="{ row }">
          {{ row.durationMonths != null ? `${row.durationMonths} 个月` : '-' }}
        </template>
        <template #price="{ row }">
          <div class="price-cell">
            <span>¥{{ formatCentAmount(row.price) }}</span>
            <span v-if="row.originalPrice != null" class="original-price">
              ¥{{ formatCentAmount(row.originalPrice) }}
            </span>
          </div>
        </template>
        <template #status="{ row }">
          <el-tag :type="row.status === 'on' ? 'success' : 'info'" size="small">
            {{ row.status === 'on' ? '在售' : '下架' }}
          </el-tag>
        </template>
        <template #remark="{ row }">
          {{ row.remark ?? '-' }}
        </template>
        <template #action="{ row }">
          <el-button v-hasPermi="'subscription:plan:update'" link type="primary" @click="openSave(row)">
            编辑
          </el-button>
          <el-button
            v-if="row.status === 'on'"
            v-hasPermi="'subscription:plan:update'"
            link
            type="warning"
            @click="handleToggleStatus(row)"
          >
            下架
          </el-button>
          <el-button
            v-else
            v-hasPermi="'subscription:plan:update'"
            link
            type="success"
            @click="handleToggleStatus(row)"
          >
            上架
          </el-button>
          <el-button v-hasPermi="'subscription:plan:remove'" link type="danger" @click="handleDelete(row)">
            删除
          </el-button>
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

    <PlanSaveDialog ref="saveDialogRef" :app-options="appOptions" @saved="loadTable" />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'

import { getAppOptions } from '@/api/appcenter/app'
import type { PlanVO } from '@/api/subscription/plan'
import { deletePlan, getPlanPage, periodTypeText, updatePlan } from '@/api/subscription/plan'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter, formatCentAmount } from '@/utils/format'
import PlanSaveDialog from '@/views/subscription/plan/components/PlanSaveDialog.vue'

// 与路由 name 对齐（keep-alive 缓存键契约）
defineOptions({ name: 'SubscriptionPlan' })

/** 列定义（field 即列宽 / 列序持久化标识，设计见 docs/前端/表格组件设计.md） */
const columns: ApphubTableColumn[] = [
  { field: 'name', title: '计划', minWidth: 200, slot: 'name' },
  { field: 'appName', title: '所属应用', minWidth: 160 },
  { field: 'durationMonths', title: '时长', width: 100, slot: 'durationMonths' },
  { field: 'price', title: '价格', width: 150, slot: 'price' },
  { field: 'status', title: '状态', width: 90, slot: 'status' },
  { field: 'sort', title: '排序', width: 80 },
  { field: 'remark', title: '备注', minWidth: 160, slot: 'remark' },
  { field: 'createTime', title: '创建时间', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'action', title: '操作', width: 190, fixed: 'right', slot: 'action' },
]

const loading = ref(false)
const tableData = ref<PlanVO[]>([])
const total = ref(0)
/** 应用下拉数据源（筛选与弹窗共用；应用数量有限，一次拉全量） */
const appOptions = ref<{ id: string, name: string }[]>([])

const queryParam = reactive({
  pageNo: 1,
  pageSize: 10,
  appId: undefined as string | undefined,
  keyword: '',
  status: undefined as string | undefined,
})

const saveDialogRef = ref<InstanceType<typeof PlanSaveDialog>>()

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
    const page = await getPlanPage({
      pageNo: queryParam.pageNo,
      pageSize: queryParam.pageSize,
      appId: queryParam.appId || undefined,
      keyword: queryParam.keyword || undefined,
      status: queryParam.status || undefined,
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
  queryParam.keyword = ''
  queryParam.status = undefined
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

/** 档位标签配色（永久档醒目提示终态语义） */
function periodTagType(periodType: string): 'primary' | 'info' | 'warning' | 'success' {
  if (periodType === 'permanent')
    return 'success'
  if (periodType === 'yearly')
    return 'warning'
  if (periodType === 'quarterly')
    return 'info'
  return 'primary'
}

function openSave(plan?: PlanVO): void {
  saveDialogRef.value?.open(plan)
}

async function handleToggleStatus(plan: PlanVO): Promise<void> {
  const offShelf = plan.status === 'on'
  const confirmed = await ElMessageBox.confirm(
    offShelf
      ? `确定下架计划「${plan.name}」吗？下架后不再产生新订单，存量订阅不受影响`
      : `确定重新上架计划「${plan.name}」吗？`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await updatePlan(plan.id, {
    name: plan.name,
    periodType: plan.periodType,
    price: plan.price,
    status: offShelf ? 'off' : 'on',
    originalPrice: plan.originalPrice ?? undefined,
    sort: plan.sort,
    remark: plan.remark ?? undefined,
  })
  ElMessage.success(offShelf ? '已下架' : '已上架')
  loadTable()
}

async function handleDelete(plan: PlanVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定删除计划「${plan.name}」吗？存量订阅与历史订单不受影响，但不可再以此计划下单`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await deletePlan(plan.id)
  ElMessage.success('删除成功')
  loadTable()
}
</script>

<style scoped>
.plan-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.price-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.original-price {
  color: var(--apphub-text-secondary, #909399);
  text-decoration: line-through;
  font-size: 12px;
}
</style>
