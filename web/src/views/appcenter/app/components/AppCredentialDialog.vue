<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 应用凭证展示弹窗：注册 / 重置 / 列表点击查看三处共用，展示 AppKey + AppSecret 完整值（附复制）
-->
<template>
  <el-dialog
    v-model="visible"
    :title="TITLE_BY_MODE[mode]"
    width="560px"
    :close-on-click-modal="false"
  >
    <el-alert
      :type="mode === 'reset' ? 'warning' : 'info'"
      :closable="false"
      show-icon
      :title="ALERT_BY_MODE[mode]"
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
        {{ mode === 'created' ? '我已妥善保存' : '关闭' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { ref } from 'vue'

import type { AppCredentialVO } from '@/api/appcenter/app'

/** 展示来源：注册成功 / 重置成功 / 列表点击查看 */
type CredentialMode = 'created' | 'reset' | 'view'

const TITLE_BY_MODE: Record<CredentialMode, string> = {
  created: '应用凭证（请立即保存）',
  reset: '新凭证（旧凭证已失效）',
  view: '应用凭证',
}

const ALERT_BY_MODE: Record<CredentialMode, string> = {
  created: 'AppSecret 可随时在应用列表中点击查看；重置会立即使旧 Secret 失效',
  reset: '旧 Secret 已立即失效，使用旧凭证的调用方将无法调用开放 API，请尽快更新配置',
  view: '凭证属于敏感信息，请勿外传；重置会立即使旧 Secret 失效',
}

const visible = ref(false)

/** 展示上下文：来源与完整凭证 */
const credential = ref<AppCredentialVO | null>(null)
const mode = ref<CredentialMode>('created')

/** 打开弹窗（凭证不落任何持久层） */
function open(value: AppCredentialVO, source: CredentialMode): void {
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
