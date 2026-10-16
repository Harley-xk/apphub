<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 重置密码结果弹窗：新密码明文仅此一次展示（附复制），关闭后不可再查
-->
<template>
  <el-dialog
    v-model="visible"
    title="重置密码（请立即保存）"
    width="480px"
    :close-on-click-modal="false"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="新密码仅此一次展示，关闭后不可再查；该会员全部登录状态已吊销，需用新密码重新登录"
    />
    <div class="password-row">
      <span class="password-label">新密码</span>
      <code class="password-value">{{ password }}</code>
      <el-button link type="primary" @click="copy">
        复制
      </el-button>
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

const visible = ref(false)

/** 展示上下文：重置成功后的明文新密码（不落任何持久层） */
const password = ref('')

/** 打开弹窗：仅重置成功后调用 */
function open(value: string): void {
  password.value = value
  visible.value = true
}

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(password.value)
  ElMessage.success('已复制到剪贴板')
}

defineExpose({ open })
</script>

<style scoped>
.password-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.password-label {
  flex: none;
  color: var(--apphub-text-secondary, #909399);
  font-size: 13px;
}

.password-value {
  flex: 1;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--apphub-fill-light, #f5f7fa);
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-size: 13px;
}
</style>
