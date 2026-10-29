<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 版本安装包抽屉：版本下包记录列表（draft / published 可增删换包，offline 只读，下载不限状态）
-->
<template>
  <el-drawer v-model="visible" :title="drawerTitle" size="900px">
    <div class="drawer-body">
      <el-alert
        v-if="version?.status === 'offline'"
        type="info"
        :closable="false"
        show-icon
        title="当前版本已下线，包记录只读（下线版本不再参与更新检测，重新分发请新建版本；安装包仍可下载）"
        class="tip-bar"
      />
      <el-alert
        v-else-if="version?.status === 'published'"
        type="warning"
        :closable="false"
        show-icon
        title="当前版本已发布：可补传新平台包或替换已上传包。替换 / 删除会即时影响该平台分发，但版本号未变，已安装客户端不会自动更新"
        class="tip-bar"
      />
      <div class="drawer-toolbar">
        <el-button
          v-if="version?.status !== 'offline'"
          v-hasPermi="'appcenter:version:update'"
          type="primary"
          @click="uploadDialogRef?.open({ version: version!, framework })"
        >
          上传安装包
        </el-button>
        <span class="toolbar-hint">一次发版 = 一个版本 + N 个平台包；(platform, arch) 槽位内唯一</span>
      </div>

      <ApphubTable :columns="columns" :data="tableData" :loading="loading" persist-key="AppcenterVersion:package">
        <template #platform="{ row }">
          {{ PLATFORM_LABELS[row.platform] ?? row.platform }}
          <span v-if="row.arch" class="arch-text">· {{ row.arch }}</span>
        </template>
        <template #fileName="{ row }">
          <span class="file-name">{{ row.fileName }}</span>
        </template>
        <template #fileSize="{ row }">
          {{ formatFileSize(row.fileSize) }}
        </template>
        <template #artifacts="{ row }">
          <el-tooltip content="sha512 已登记（electron-updater 校验）" placement="top" :disabled="!row.sha512">
            <el-tag :type="row.sha512 ? 'success' : 'info'" size="small" effect="plain">
              sha512
            </el-tag>
          </el-tooltip>
          <el-tooltip content="minisign 签名已登记（tauri updater 验签）" placement="top" :disabled="!row.minisignSignature">
            <el-tag :type="row.minisignSignature ? 'success' : 'info'" size="small" effect="plain">
              minisign
            </el-tag>
          </el-tooltip>
          <el-tooltip content="blockmap 差分文件已上传（差量更新）" placement="top" :disabled="!row.blockmapObjectKey">
            <el-tag :type="row.blockmapObjectKey ? 'success' : 'info'" size="small" effect="plain">
              blockmap
            </el-tag>
          </el-tooltip>
        </template>
        <template #action="{ row }">
          <el-tooltip
            :content="row.ossObjectKey ? '下载安装包（签名链接 2 小时内有效）' : 'iOS 仅登记元信息，无安装包文件'"
            placement="top"
          >
            <span>
              <el-button
                v-hasPermi="'appcenter:version:query'"
                link
                type="primary"
                :disabled="!row.ossObjectKey || downloadingId === row.id"
                :loading="downloadingId === row.id"
                @click="handleDownload(row)"
              >
                下载
              </el-button>
            </span>
          </el-tooltip>
          <el-button
            v-if="version?.status !== 'offline'"
            v-hasPermi="'appcenter:version:update'"
            link
            type="primary"
            @click="handleReplace(row)"
          >
            替换
          </el-button>
          <el-button
            v-if="version?.status !== 'offline'"
            v-hasPermi="'appcenter:version:update'"
            link
            type="danger"
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </ApphubTable>
    </div>

    <PackageUploadDialog ref="uploadDialogRef" @saved="loadTable" />
  </el-drawer>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref } from 'vue'

import type { PackageVO } from '@/api/appcenter/package'
import { deletePackage, getPackageDownloadUrl, getPackageList } from '@/api/appcenter/package'
import type { VersionVO } from '@/api/appcenter/version'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter } from '@/utils/format'
import { PLATFORM_LABELS } from '@/views/appcenter/package-platform'
import PackageUploadDialog from '@/views/appcenter/version/components/PackageUploadDialog.vue'

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
}

/** 列定义（抽屉内非页面级表格，持久化 key 显式指定；总宽收敛在抽屉内容宽内避免横向滚动拆分 fixed 列） */
const columns: ApphubTableColumn[] = [
  { field: 'platform', title: '平台 / 架构', width: 110, slot: 'platform' },
  { field: 'fileName', title: '文件名', minWidth: 180, slot: 'fileName' },
  { field: 'fileSize', title: '大小', width: 90, slot: 'fileSize' },
  { field: 'artifacts', title: '框架产物', width: 190, slot: 'artifacts' },
  { field: 'createTime', title: '登记时间', width: 150, formatter: dateTimeFormatter },
  { field: 'action', title: '操作', width: 130, fixed: 'right', slot: 'action' },
]

const visible = ref(false)
const loading = ref(false)
const tableData = ref<PackageVO[]>([])

/** 抽屉上下文：当前版本与应用框架（上传弹窗的产物提示依据） */
const version = ref<VersionVO | null>(null)
const framework = ref<string | null>(null)

const uploadDialogRef = ref<InstanceType<typeof PackageUploadDialog>>()

/** 正在签发下载链接的包 id（按钮 loading，防重复点击） */
const downloadingId = ref<string | null>(null)

const drawerTitle = computed(() =>
  version.value ? `安装包 - ${version.value.version}（${STATUS_LABELS[version.value.status] ?? version.value.status}）` : '安装包',
)

/** 打开抽屉：固定版本上下文并加载包列表 */
function open(context: { version: VersionVO, framework: string | null }): void {
  version.value = context.version
  framework.value = context.framework
  visible.value = true
  loadTable()
}

async function loadTable(): Promise<void> {
  if (!version.value) {
    return
  }
  loading.value = true
  try {
    tableData.value = await getPackageList(version.value.id)
  }
  finally {
    loading.value = false
  }
}

/** 文件大小人性化展示 */
function formatFileSize(size: number): string {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
  }
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)} MB`
  }
  return `${(size / 1024).toFixed(1)} KB`
}

/**
 * 下载安装包：先向后端签发签名 URL，再用临时 <a> 触发浏览器下载。
 * 签名 URL 携带 response-content-disposition attachment，浏览器按原始文件名落盘；
 * 不用 window.open（异步签发后被弹窗拦截），临时 <a> 不触发拦截。
 */
async function handleDownload(pkg: PackageVO): Promise<void> {
  if (!version.value || downloadingId.value) {
    return
  }
  downloadingId.value = pkg.id
  try {
    const { url, fileName } = await getPackageDownloadUrl(version.value.id, pkg.id)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
  finally {
    downloadingId.value = null
  }
}

/** 替换已上传包：锁定槽位，走上传弹窗的替换模式（版本号不变，仅影响新下载） */
function handleReplace(pkg: PackageVO): void {
  if (!version.value) {
    return
  }
  uploadDialogRef.value?.open({ version: version.value, framework: framework.value, replaceTarget: pkg })
}

async function handleDelete(pkg: PackageVO): Promise<void> {
  const isPublished = version.value?.status === 'published'
  const confirmed = await ElMessageBox.confirm(
    isPublished
      ? `确定删除「${pkg.fileName}」吗？该平台将立即回退到更早的有包版本；若无更早版本则新用户拿不到更新。已安装客户端不受影响，但重新分发需新建版本。`
      : `确定删除「${pkg.fileName}」吗？将连带清理 OSS 对象并释放 (platform, arch) 槽位`,
    isPublished ? '撤回该平台分发' : '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed || !version.value) {
    return
  }
  await deletePackage(version.value.id, pkg.id)
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

.tip-bar {
  margin-bottom: 12px;
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

.arch-text {
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}

.file-name {
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-size: 13px;
}
</style>
