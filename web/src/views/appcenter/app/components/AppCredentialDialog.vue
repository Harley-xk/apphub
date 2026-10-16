<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 应用凭证展示弹窗：注册 / 重置 Secret 后的 AppKey + AppSecret 完整展示（仅此一次，附复制）
-->
<template>
  <el-dialog
    v-model="visible"
    :title="mode === 'created' ? '应用凭证（请立即保存）' : '新凭证（请立即保存）'"
    width="560px"
    :close-on-click-modal="false"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="AppSecret 仅此一次展示，关闭后不可再查；重置前旧凭证立即失效"
    />
    <div class="credential-list">
      <div class="credential-item">
        <span class="credential-label">AppKey</span>
        <code class="credential-value">{{ credential?.appKey }}</code>
        <el-button link type="primary" @click="copy(credential?.appKey)">
          复制
        </el-button>
      </div>
      <div class="credential-item">
        <span class="credential-label">AppSecret</span>
        <code class="credential-value">{{ credential?.appSecret }}</code>
        <el-button link type="primary" @click="copy(credential?.appSecret)">
          复制
        </el-button>
      </div>
    </div>
    <template #footer>
      <el-button type="primary" @click="visible = false">
        我已妥善保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { ref } from 'vue'

import type { AppCredentialVO } from '@/api/appcenter/app'

const visible = ref(false)

/** 展示上下文：来源（注册 / 重置）与完整凭证 */
const credential = ref<AppCredentialVO | null>(null)
const mode = ref<'created' | 'reset'>('created')

/** 打开弹窗：仅注册 / 重置成功后调用（凭证不落任何持久层） */
function open(value: AppCredentialVO, source: 'created' | 'reset'): void {
  credential.value = value
  mode.value = source
  visible.value = true
}

async function copy(value: string | undefined): Promise<void> {
  if (!value) {
    return
  }
  await navigator.clipboard.writeText(value)
  ElMessage.success('已复制到剪贴板')
}

defineExpose({ open })
</script>

<style scoped>
.credential-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.credential-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.credential-label {
  flex: none;
  width: 80px;
  color: var(--apphub-text-secondary, #909399);
  font-size: 13px;
}

.credential-value {
  flex: 1;
  overflow-wrap: anywhere;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--apphub-fill-light, #f5f7fa);
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-size: 13px;
}
</style>
