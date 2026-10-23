<!--
  作者: Harley-xk
  创建: 2026-10-23

  描述: 用户应用授权弹窗：远程搜索 AppKey / 名称多选，回显已授权应用（保存为目标全集差集绑定）
-->
<template>
  <el-dialog
    v-model="visible"
    :title="`应用授权 - ${user?.nickname ?? ''}`"
    width="560px"
    :close-on-click-modal="false"
    @closed="reset"
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="仅当用户持有「数据范围 = 按应用」的角色时生效；未授权应用在列表不可见，直调接口返回 403"
    />
    <el-form class="dialog-form" label-width="90px">
      <el-form-item label="授权应用">
        <el-select
          v-model="checkedAppIds"
          multiple
          filterable
          remote
          clearable
          :remote-method="searchApps"
          :loading="loading"
          placeholder="输入应用名称 / AppKey 搜索"
          style="width: 100%"
        >
          <el-option
            v-for="app in appOptions"
            :key="app.id"
            :label="app.name"
            :value="app.id"
          >
            <span>{{ app.name }}</span>
            <span class="option-hint">{{ app.appKey }}</span>
          </el-option>
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { ref } from 'vue'

import type { AppOptionVO } from '@/api/appcenter/app'
import { getAppOptions } from '@/api/appcenter/app'
import type { UserVO } from '@/api/system/user'
import { assignUserAppScope, getUserAppScope } from '@/api/system/user'

const emit = defineEmits<{ saved: [] }>()

const visible = ref(false)
const loading = ref(false)
const submitting = ref(false)

const user = ref<UserVO | null>(null)
/** 远程搜索结果 + 已选应用（已选项不因搜索词变化而丢失标签） */
const appOptions = ref<AppOptionVO[]>([])
const checkedAppIds = ref<string[]>([])

/** 打开弹窗：拉取已授权应用与可管理应用全集（回显） */
async function open(target: UserVO): Promise<void> {
  user.value = target
  visible.value = true
  loading.value = true
  checkedAppIds.value = []
  appOptions.value = []
  try {
    const [scope, options] = await Promise.all([
      getUserAppScope(target.id),
      getAppOptions(),
    ])
    checkedAppIds.value = scope.appIds
    appOptions.value = mergeOptions(options, scope.apps)
  }
  finally {
    loading.value = false
  }
}

/** 远程搜索：结果并入已选应用，保证勾选项始终有可读标签 */
async function searchApps(keyword: string): Promise<void> {
  loading.value = true
  try {
    const options = await getAppOptions(keyword || undefined)
    const selected = appOptions.value.filter(app => checkedAppIds.value.includes(app.id))
    appOptions.value = mergeOptions(options, selected)
  }
  finally {
    loading.value = false
  }
}

function reset(): void {
  user.value = null
  appOptions.value = []
  checkedAppIds.value = []
}

/** 合并应用选项（按 id 去重，base 优先） */
function mergeOptions(base: AppOptionVO[], extra: AppOptionVO[]): AppOptionVO[] {
  const map = new Map(base.map(app => [app.id, app]))
  for (const app of extra) {
    if (!map.has(app.id)) {
      map.set(app.id, app)
    }
  }
  return [...map.values()]
}

async function handleSubmit(): Promise<void> {
  if (!user.value) {
    return
  }
  submitting.value = true
  try {
    await assignUserAppScope(user.value.id, checkedAppIds.value)
    ElMessage.success('授权已保存')
    visible.value = false
    emit('saved')
  }
  finally {
    submitting.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
.dialog-form {
  margin-top: 16px;
}

.option-hint {
  float: right;
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}
</style>
