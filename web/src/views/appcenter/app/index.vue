<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 应用管理页：搜索分页 + 注册（凭证仅此一次）/ 编辑 / 启停 / 重置凭证 / 删除 / 通道抽屉
-->
<template>
  <div class="page-container">
    <el-card>
      <el-form class="search-bar" inline :model="queryParam" @submit.prevent>
        <el-form-item label="应用名称">
          <el-input
            v-model="queryParam.name"
            placeholder="名称模糊匹配"
            clearable
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryParam.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="启用" value="enabled" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="调用方类型">
          <el-select v-model="queryParam.clientType" placeholder="全部" clearable style="width: 140px">
            <el-option label="机密客户端" value="confidential" />
            <el-option label="公开客户端" value="public" />
          </el-select>
        </el-form-item>
        <el-form-item label="技术框架">
          <el-select v-model="queryParam.framework" placeholder="全部" clearable style="width: 140px">
            <el-option label="Electron" value="electron" />
            <el-option label="Tauri" value="tauri" />
            <el-option label="自定义 / 其他" value="custom" />
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
          <el-button v-hasPermi="'appcenter:app:create'" type="primary" @click="openCreate">
            注册应用
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card">
      <ApphubTable :columns="columns" :data="tableData" :loading="loading">
        <template #name="{ row }">
          <div class="app-name-cell">
            <span>{{ row.name }}</span>
            <span class="app-type-tags">
              <el-tag
                v-for="type in row.appType"
                :key="type"
                size="small"
                effect="plain"
              >
                {{ APP_TYPE_LABELS[type] ?? type }}
              </el-tag>
            </span>
          </div>
        </template>
        <template #appKey="{ row }">
          <code class="app-key">{{ row.appKey }}</code>
        </template>
        <template #framework="{ row }">
          {{ row.framework ? FRAMEWORK_LABELS[row.framework] ?? row.framework : '-' }}
        </template>
        <template #clientType="{ row }">
          <el-tag :type="row.clientType === 'public' ? 'warning' : 'primary'" size="small" effect="plain">
            {{ row.clientType === 'public' ? '公开客户端' : '机密客户端' }}
          </el-tag>
        </template>
        <template #status="{ row }">
          <el-tag :type="row.status === 'enabled' ? 'success' : 'info'" size="small">
            {{ row.status === 'enabled' ? '启用' : '停用' }}
          </el-tag>
        </template>
        <template #action="{ row }">
          <el-button v-hasPermi="'appcenter:app:update'" link type="primary" @click="openUpdate(row)">
            编辑
          </el-button>
          <el-button v-hasPermi="'appcenter:version:query'" link type="primary" @click="goVersion(row)">
            版本
          </el-button>
          <el-dropdown class="action-more" trigger="click" @command="(command: string) => handleMoreCommand(command, row)">
            <el-button link type="primary">
              更多
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="channel">
                  更新通道
                </el-dropdown-item>
                <el-dropdown-item command="reset-secret">
                  重置凭证
                </el-dropdown-item>
                <el-dropdown-item command="toggle-status">
                  {{ row.status === 'enabled' ? '停用应用' : '启用应用' }}
                </el-dropdown-item>
                <el-dropdown-item command="remove" divided>
                  删除应用
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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

    <AppSaveDialog ref="saveDialogRef" @saved="loadTable" @created="handleCreated" />
    <AppCredentialDialog ref="credentialDialogRef" />
    <AppChannelDrawer ref="channelDrawerRef" />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { AppCredentialVO, AppVO } from '@/api/appcenter/app'
import { deleteApp, getAppPage, resetAppSecret, updateAppStatus } from '@/api/appcenter/app'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter } from '@/utils/format'
import AppChannelDrawer from '@/views/appcenter/app/components/AppChannelDrawer.vue'
import AppCredentialDialog from '@/views/appcenter/app/components/AppCredentialDialog.vue'
import AppSaveDialog from '@/views/appcenter/app/components/AppSaveDialog.vue'

// 与路由 name 对齐（keep-alive 缓存键契约）
defineOptions({ name: 'AppcenterApp' })

const router = useRouter()

/** 形态标签展示映射（后端取值域 desktop / web / mobile） */
const APP_TYPE_LABELS: Record<string, string> = {
  desktop: '桌面',
  web: 'Web',
  mobile: '移动',
}

/** 框架展示映射（electron / tauri / custom） */
const FRAMEWORK_LABELS: Record<string, string> = {
  electron: 'Electron',
  tauri: 'Tauri',
  custom: '自定义',
}

/** 列定义（field 即列宽 / 列序持久化标识，设计见 docs/前端/表格组件设计.md） */
const columns: ApphubTableColumn[] = [
  { field: 'name', title: '应用名称', minWidth: 200, slot: 'name' },
  { field: 'appKey', title: 'AppKey', width: 200, slot: 'appKey' },
  { field: 'framework', title: '技术框架', width: 110, slot: 'framework' },
  { field: 'clientType', title: '调用方类型', width: 120, slot: 'clientType' },
  { field: 'status', title: '状态', width: 80, slot: 'status' },
  { field: 'sort', title: '排序', width: 70 },
  { field: 'createTime', title: '创建时间', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'action', title: '操作', width: 200, fixed: 'right', slot: 'action' },
]

const loading = ref(false)
const tableData = ref<AppVO[]>([])
const total = ref(0)

const queryParam = reactive({
  pageNo: 1,
  pageSize: 10,
  name: '',
  status: undefined as string | undefined,
  clientType: undefined as string | undefined,
  framework: undefined as string | undefined,
})

const saveDialogRef = ref<InstanceType<typeof AppSaveDialog>>()
const credentialDialogRef = ref<InstanceType<typeof AppCredentialDialog>>()
const channelDrawerRef = ref<InstanceType<typeof AppChannelDrawer>>()

onMounted(() => {
  loadTable()
})

async function loadTable(): Promise<void> {
  loading.value = true
  try {
    const page = await getAppPage({
      pageNo: queryParam.pageNo,
      pageSize: queryParam.pageSize,
      name: queryParam.name || undefined,
      status: queryParam.status || undefined,
      clientType: queryParam.clientType || undefined,
      framework: queryParam.framework || undefined,
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
  queryParam.name = ''
  queryParam.status = undefined
  queryParam.clientType = undefined
  queryParam.framework = undefined
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

function openCreate(): void {
  saveDialogRef.value?.open()
}

function openUpdate(app: AppVO): void {
  saveDialogRef.value?.open(app)
}

/** 注册成功：AppSecret 仅此一次，立即弹凭证展示 */
function handleCreated(credential: AppCredentialVO): void {
  credentialDialogRef.value?.open(credential, 'created')
}

function openChannelDrawer(app: AppVO): void {
  channelDrawerRef.value?.open(app)
}

/** 进入版本下钻页（hidden 路由，query.appId 携带应用上下文） */
function goVersion(app: AppVO): void {
  router.push({ path: '/appcenter/version', query: { appId: app.id } })
}

/** 操作列「更多」下拉分发 */
function handleMoreCommand(command: string, app: AppVO): void {
  if (command === 'channel')
    openChannelDrawer(app)
  else if (command === 'reset-secret')
    handleResetSecret(app)
  else if (command === 'toggle-status')
    handleToggleStatus(app)
  else if (command === 'remove')
    handleDelete(app)
}

async function handleResetSecret(app: AppVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定重置「${app.name}」的凭证吗？重置后旧凭证立即失效，使用旧凭证的客户端将无法调用开放 API`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  const credential = await resetAppSecret(app.id)
  credentialDialogRef.value?.open(credential, 'reset')
}

async function handleToggleStatus(app: AppVO): Promise<void> {
  const disabling = app.status === 'enabled'
  const confirmed = await ElMessageBox.confirm(
    disabling
      ? `确定停用「${app.name}」吗？停用后其开放 API 调用全部拒绝`
      : `确定启用「${app.name}」吗？`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await updateAppStatus(app.id, disabling ? 'disabled' : 'enabled')
  ElMessage.success(disabling ? '已停用' : '已启用')
  loadTable()
}

async function handleDelete(app: AppVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定删除应用「${app.name}」吗？存在已发布版本时删除将被拒绝`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await deleteApp(app.id)
  ElMessage.success('删除成功')
  loadTable()
}
</script>

<style scoped>
.app-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.app-type-tags {
  display: inline-flex;
  gap: 4px;
}

.app-key {
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-size: 13px;
}
</style>
