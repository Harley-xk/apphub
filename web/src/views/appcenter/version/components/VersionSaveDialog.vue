<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 版本新增 / 编辑弹窗：draft 任意编辑；published 仅更新说明与强制标记（服务端状态机分流校验）
-->
<template>
  <el-dialog
    v-model="visible"
    :title="form.id ? `编辑版本${isPublished ? '（仅说明与强制标记可改）' : ''}` : '新增版本'"
    width="560px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="所属通道" prop="channelId">
        <el-select v-model="form.channelId" placeholder="选择通道" :disabled="!!form.id" style="width: 100%">
          <el-option
            v-for="channel in channels"
            :key="channel.id"
            :label="`${channel.name}（${channel.code}）`"
            :value="channel.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="版本号" prop="version">
        <el-input
          v-model="form.version"
          placeholder="semver 格式，如 1.3.0"
          maxlength="32"
          :disabled="isPublished"
        />
      </el-form-item>
      <el-form-item label="版本标题" prop="title">
        <el-input v-model="form.title" placeholder="如 1.3.0 性能优化版" maxlength="128" :disabled="isPublished" />
      </el-form-item>
      <el-form-item label="更新说明" prop="notes">
        <el-input
          v-model="form.notes"
          type="textarea"
          :rows="4"
          placeholder="多行纯文本，随更新检测下发给客户端"
        />
      </el-form-item>
      <el-form-item label="强制更新">
        <el-switch v-model="form.forceUpdate" />
        <span class="force-hint">开启后：自研协议返回 forceUpdate: true，框架 manifest 说明首行注入 [force] 标记</span>
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
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { computed, reactive, ref } from 'vue'

import type { ChannelVO } from '@/api/appcenter/channel'
import type { VersionVO } from '@/api/appcenter/version'
import { createVersion, updateVersion } from '@/api/appcenter/version'

const emit = defineEmits<{ saved: [] }>()

/** 应用上下文：应用 id 与其通道列表（新增版本的通道下拉数据源） */
const appId = ref('')
const channels = ref<ChannelVO[]>([])

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  id: undefined as string | undefined,
  channelId: undefined as string | undefined,
  version: '',
  title: '',
  notes: '',
  forceUpdate: false,
})

/** published 状态仅说明与强制标记可改（draft 任意编辑；offline 终态不打开编辑） */
const isPublished = computed(() => editing.value?.status === 'published')
const editing = ref<VersionVO | null>(null)

/** 与后端 VersionCreateDto 校验对齐（通道必选 + semver 格式 + 标题必填） */
const rules: FormRules = {
  channelId: [{ required: true, message: '请选择所属通道', trigger: 'change' }],
  version: [
    { required: true, message: '请输入版本号', trigger: 'blur' },
    { pattern: /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, message: '版本号须为 semver 格式，如 1.3.0', trigger: 'blur' },
  ],
  title: [{ required: true, message: '请输入版本标题', trigger: 'blur' }],
}

/** 打开弹窗：编辑态由行数据填充（版本号 / 标题在 published 态禁用） */
function open(context: { appId: string, channels: ChannelVO[], version?: VersionVO }): void {
  appId.value = context.appId
  channels.value = context.channels
  editing.value = context.version ?? null
  visible.value = true
  if (context.version) {
    form.id = context.version.id
    form.channelId = context.version.channelId
    form.version = context.version.version
    form.title = context.version.title
    form.notes = context.version.notes ?? ''
    form.forceUpdate = context.version.forceUpdate
  }
}

function resetForm(): void {
  formRef.value?.resetFields()
  form.id = undefined
  form.channelId = undefined
  form.version = ''
  form.title = ''
  form.notes = ''
  form.forceUpdate = false
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().then(() => true).catch(() => false)
  if (!valid) {
    return
  }
  submitting.value = true
  try {
    if (form.id) {
      // published 态服务端拒绝 version / title 变更，编辑态仅在可改时携带
      await updateVersion({
        id: form.id,
        ...(isPublished.value ? {} : { version: form.version, title: form.title }),
        notes: form.notes || undefined,
        forceUpdate: form.forceUpdate,
      })
      ElMessage.success('修改成功')
    }
    else {
      await createVersion(appId.value, {
        channelId: form.channelId!,
        version: form.version,
        title: form.title,
        notes: form.notes || undefined,
        forceUpdate: form.forceUpdate,
      })
      ElMessage.success('新增成功')
    }
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
.force-hint {
  margin-left: 8px;
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}
</style>
