<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 版本管理下钻页（应用作用域，经 query.appId 进入）：版本状态机操作与安装包管理入口；keepAlive 关闭防多页签串缓存
-->
<template>
  <div class="page-container">
    <el-card class="app-header">
      <div class="app-header-body">
        <el-button link @click="goBack">
          ← 返回应用列表
        </el-button>
        <template v-if="app">
          <span class="app-title">{{ app.name }}</span>
          <code class="app-key">{{ app.appKey }}</code>
          <el-tag size="small" effect="plain">
            {{ app.framework ? FRAMEWORK_LABELS[app.framework] ?? app.framework : '未归类框架' }}
          </el-tag>
          <el-tag :type="app.status === 'enabled' ? 'success' : 'info'" size="small">
            {{ app.status === 'enabled' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </div>
    </el-card>

    <el-card>
      <el-form class="search-bar" inline :model="queryParam" @submit.prevent>
        <el-form-item label="通道">
          <el-select v-model="queryParam.channelId" placeholder="全部通道" clearable style="width: 180px">
            <el-option
              v-for="channel in channels"
              :key="channel.id"
              :label="`${channel.name}（${channel.code}）`"
              :value="channel.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryParam.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="已下线" value="offline" />
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
          <el-button v-hasPermi="'appcenter:version:create'" type="primary" @click="openCreate">
            新增版本
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card">
      <ApphubTable :columns="columns" :data="tableData" :loading="loading">
        <template #version="{ row }">
          <span class="version-text">{{ row.version }}</span>
        </template>
        <template #channel="{ row }">
          {{ row.channelName }}（{{ row.channelCode }}）
        </template>
        <!-- 支持平台 / 架构：按该版本自身包记录成对展示（与版本状态无关，设计 §3.7） -->
        <template #packageTargets="{ row }">
          <div v-if="row.packageTargets.length" class="package-targets">
            <el-tag
              v-for="target in row.packageTargets"
              :key="`${target.platform}-${target.arch ?? ''}`"
              size="small"
              effect="plain"
            >
              {{ formatPackageTarget(target) }}
            </el-tag>
          </div>
          <span v-else>-</span>
        </template>
        <template #status="{ row }">
          <el-tag :type="STATUS_TAG_TYPES[row.status] ?? 'info'" size="small">
            {{ STATUS_LABELS[row.status] ?? row.status }}
          </el-tag>
        </template>
        <template #forceUpdate="{ row }">
          <el-tag v-if="row.forceUpdate" type="danger" size="small" effect="plain">
            强制
          </el-tag>
          <span v-else>-</span>
        </template>
        <template #publishedAt="{ row }">
          {{ row.publishedAt ? dateTimeFormatter({ cellValue: row.publishedAt }) : '-' }}
        </template>
        <template #action="{ row }">
          <el-button
            v-if="row.status !== 'offline'"
            v-hasPermi="'appcenter:version:update'"
            link
            type="primary"
            @click="openUpdate(row)"
          >
            编辑
          </el-button>
          <!-- 安装包入口不随状态隐藏：下线版本包层冻结，但仍可查看与下载留档 -->
          <el-button v-hasPermi="'appcenter:version:query'" link type="primary" @click="openPackageDrawer(row)">
            安装包
          </el-button>
          <template v-if="row.status !== 'offline'">
            <el-button
              v-if="row.status === 'draft'"
              v-hasPermi="'appcenter:version:publish'"
              link
              type="success"
              @click="handlePublish(row)"
            >
              发布
            </el-button>
            <el-button
              v-if="row.status === 'published'"
              v-hasPermi="'appcenter:version:offline'"
              link
              type="warning"
              @click="handleOffline(row)"
            >
              下线
            </el-button>
            <el-button
              v-if="row.status === 'draft'"
              v-hasPermi="'appcenter:version:remove'"
              link
              type="danger"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
          <span v-else class="terminal-text">终态</span>
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

    <VersionSaveDialog ref="saveDialogRef" @saved="loadTable" />
    <PackagePanelDrawer ref="packageDrawerRef" />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { AppVO } from '@/api/appcenter/app'
import { getApp } from '@/api/appcenter/app'
import type { ChannelVO } from '@/api/appcenter/channel'
import { getChannelList } from '@/api/appcenter/channel'
import type { VersionVO } from '@/api/appcenter/version'
import { deleteVersion, getVersionPage, offlineVersion, publishVersion } from '@/api/appcenter/version'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter } from '@/utils/format'
import { formatPackageTarget } from '@/views/appcenter/package-platform'
import PackagePanelDrawer from '@/views/appcenter/version/components/PackagePanelDrawer.vue'
import VersionSaveDialog from '@/views/appcenter/version/components/VersionSaveDialog.vue'

// 与路由 name 对齐（keep-alive 缓存键契约；本页 keepAlive 关闭——多 fullPath 页签共享实例会串应用数据）
defineOptions({ name: 'AppcenterVersion' })

const route = useRoute()
const router = useRouter()

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
}

const STATUS_TAG_TYPES: Record<string, 'warning' | 'success' | 'info'> = {
  draft: 'warning',
  published: 'success',
  offline: 'info',
}

const FRAMEWORK_LABELS: Record<string, string> = {
  electron: 'Electron',
  tauri: 'Tauri',
  custom: '自定义',
}

/** 列定义 */
const columns: ApphubTableColumn[] = [
  { field: 'version', title: '版本号', width: 130, slot: 'version' },
  { field: 'title', title: '版本标题', minWidth: 180 },
  { field: 'channel', title: '通道', minWidth: 140, slot: 'channel' },
  { field: 'packageTargets', title: '支持平台', minWidth: 180, slot: 'packageTargets' },
  { field: 'status', title: '状态', width: 90, slot: 'status' },
  { field: 'forceUpdate', title: '强制更新', width: 90, slot: 'forceUpdate' },
  { field: 'publishedAt', title: '发布时间', minWidth: 170, slot: 'publishedAt' },
  { field: 'createTime', title: '创建时间', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'action', title: '操作', width: 280, fixed: 'right', slot: 'action' },
]

const app = ref<AppVO | null>(null)
const channels = ref<ChannelVO[]>([])
const loading = ref(false)
const tableData = ref<VersionVO[]>([])
const total = ref(0)
/** 路由参数（hidden 下钻页约定：query.appId 携带应用上下文） */
const appId = String(route.query.appId ?? '')

const queryParam = reactive({
  pageNo: 1,
  pageSize: 10,
  channelId: undefined as string | undefined,
  status: undefined as string | undefined,
})

const saveDialogRef = ref<InstanceType<typeof VersionSaveDialog>>()
const packageDrawerRef = ref<InstanceType<typeof PackagePanelDrawer>>()

onMounted(() => {
  if (!appId) {
    ElMessage.warning('缺少应用上下文，已返回应用列表')
    router.replace('/appcenter/app')
    return
  }
  loadContext()
  loadTable()
})

/** 加载应用与通道上下文（头部展示与新增版本的下拉数据源） */
async function loadContext(): Promise<void> {
  app.value = await getApp(appId)
  channels.value = await getChannelList(appId)
}

async function loadTable(): Promise<void> {
  loading.value = true
  try {
    const page = await getVersionPage(appId, {
      pageNo: queryParam.pageNo,
      pageSize: queryParam.pageSize,
      channelId: queryParam.channelId || undefined,
      status: queryParam.status || undefined,
    })
    tableData.value = page.list
    total.value = page.total
  }
  finally {
    loading.value = false
  }
}

function goBack(): void {
  router.push('/appcenter/app')
}

function handleQuery(): void {
  queryParam.pageNo = 1
  loadTable()
}

function handleReset(): void {
  queryParam.channelId = undefined
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

function openCreate(): void {
  if (!app.value) {
    return
  }
  saveDialogRef.value?.open({ appId, channels: channels.value })
}

function openUpdate(row: VersionVO): void {
  saveDialogRef.value?.open({ appId, channels: channels.value, version: row })
}

function openPackageDrawer(row: VersionVO): void {
  packageDrawerRef.value?.open({ version: row, framework: app.value?.framework ?? null })
}

async function handlePublish(row: VersionVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定发布「${row.version}」吗？发布后更新检测立即返回该版本（前置校验：包记录与框架产物完整性）`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await publishVersion(row.id)
  ElMessage.success('发布成功')
  loadTable()
}

async function handleOffline(row: VersionVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定下线「${row.version}」吗？下线为终态，更新检测不再返回该版本`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await offlineVersion(row.id)
  ElMessage.success('已下线')
  loadTable()
}

async function handleDelete(row: VersionVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定删除草稿版本「${row.version}」吗？将连带清理包记录与 OSS 对象`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await deleteVersion(row.id)
  ElMessage.success('删除成功')
  loadTable()
}
</script>

<style scoped>
.app-header-body {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.app-title {
  font-size: 15px;
  font-weight: 600;
}

.app-key {
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-size: 13px;
}

.version-text {
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-weight: 600;
}

.package-targets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.terminal-text {
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}
</style>
