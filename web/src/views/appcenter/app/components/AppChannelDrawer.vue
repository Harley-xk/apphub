<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 更新通道抽屉：固定在某应用下的通道全量列表管理（新增 / 编辑 / 删除，stable 不可删）
-->
<template>
  <el-drawer v-model="visible" :title="drawerTitle" size="720px">
    <div class="drawer-body">
      <div class="drawer-toolbar">
        <el-button v-hasPermi="'appcenter:channel:create'" type="primary" @click="openCreate">
          新增通道
        </el-button>
        <span class="toolbar-hint">通道 code 参与 OSS 对象键与 feed URL，创建后不可修改</span>
      </div>

      <ApphubTable :columns="columns" :data="tableData" :loading="loading" persist-key="AppcenterApp:channel">
        <template #status="{ row }">
          <el-tag :type="row.status === 'enabled' ? 'success' : 'info'" size="small">
            {{ row.status === 'enabled' ? '启用' : '停用' }}
          </el-tag>
        </template>
        <template #action="{ row }">
          <el-button v-hasPermi="'appcenter:channel:update'" link type="primary" @click="openUpdate(row)">
            编辑
          </el-button>
          <el-tooltip v-if="row.code === 'stable'" content="默认通道不可删除" placement="top">
            <span>
              <el-button link type="danger" disabled>
                删除
              </el-button>
            </span>
          </el-tooltip>
          <el-button
            v-else
            v-hasPermi="'appcenter:channel:remove'"
            link
            type="danger"
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </ApphubTable>
    </div>

    <ChannelSaveDialog ref="saveDialogRef" @saved="loadTable" />
  </el-drawer>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref } from 'vue'

import type { AppVO } from '@/api/appcenter/app'
import type { ChannelVO } from '@/api/appcenter/channel'
import { deleteChannel, getChannelList } from '@/api/appcenter/channel'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter } from '@/utils/format'
import ChannelSaveDialog from '@/views/appcenter/app/components/ChannelSaveDialog.vue'

/** 列定义（抽屉内非页面级表格，持久化 key 显式指定；总宽收敛在抽屉内容宽内避免横向滚动拆分 fixed 列） */
const columns: ApphubTableColumn[] = [
  { field: 'code', title: '通道代码', width: 120 },
  { field: 'name', title: '显示名', width: 110 },
  { field: 'status', title: '状态', width: 80, slot: 'status' },
  { field: 'sort', title: '排序', width: 60 },
  { field: 'createTime', title: '创建时间', width: 160, formatter: dateTimeFormatter },
  { field: 'action', title: '操作', width: 110, fixed: 'right', slot: 'action' },
]

const visible = ref(false)
const loading = ref(false)
const tableData = ref<ChannelVO[]>([])

/** 抽屉上下文：当前管理的应用 */
const app = ref<AppVO | null>(null)

const saveDialogRef = ref<InstanceType<typeof ChannelSaveDialog>>()

const drawerTitle = computed(() => (app.value ? `更新通道 - ${app.value.name}` : '更新通道'))

/** 打开抽屉：固定应用上下文并加载通道列表（通道数量少，不分页） */
function open(target: AppVO): void {
  app.value = target
  visible.value = true
  loadTable()
}

async function loadTable(): Promise<void> {
  if (!app.value) {
    return
  }
  loading.value = true
  try {
    tableData.value = await getChannelList(app.value.id)
  }
  finally {
    loading.value = false
  }
}

function openCreate(): void {
  if (app.value) {
    saveDialogRef.value?.open({ appId: app.value.id })
  }
}

function openUpdate(channel: ChannelVO): void {
  if (app.value) {
    saveDialogRef.value?.open({ appId: app.value.id, channel })
  }
}

async function handleDelete(channel: ChannelVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定删除通道「${channel.name}（${channel.code}）」吗？`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed || !app.value) {
    return
  }
  await deleteChannel(app.value.id, channel.id)
  ElMessage.success('删除成功')
  loadTable()
}

defineExpose({ open })
</script>

<style scoped>
.drawer-body {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.drawer-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.toolbar-hint {
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}
</style>
