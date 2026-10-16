<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 通道新增 / 编辑弹窗：code（创建后不可改）、显示名、状态与排序
-->
<template>
  <el-dialog
    v-model="visible"
    :title="form.id ? '编辑通道' : '新增通道'"
    width="480px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="通道代码" prop="code">
        <el-input
          v-model="form.code"
          placeholder="如 beta / internal（参与 OSS 对象键与 feed URL，创建后不可改）"
          maxlength="32"
          :disabled="!!form.id"
        />
      </el-form-item>
      <el-form-item label="显示名" prop="name">
        <el-input v-model="form.name" placeholder="如 公测版" maxlength="64" />
      </el-form-item>
      <el-form-item v-if="form.id" label="状态">
        <el-switch
          v-model="form.status"
          active-value="enabled"
          inactive-value="disabled"
          active-text="启用"
          inactive-text="停用"
        />
      </el-form-item>
      <el-form-item label="排序" prop="sort">
        <el-input-number v-model="form.sort" :min="0" :step="1" style="width: 100%" />
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
import { reactive, ref } from 'vue'

import type { ChannelVO } from '@/api/appcenter/channel'
import { createChannel, updateChannel } from '@/api/appcenter/channel'

const emit = defineEmits<{ saved: [] }>()

/** 抽屉上下文：当前管理的应用 id（由打开方注入） */
const appId = ref('')

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  id: undefined as string | undefined,
  code: '',
  name: '',
  status: 'enabled',
  sort: 0,
})

/** 与后端 ChannelCreateDto 校验对齐（code / 显示名必填） */
const rules: FormRules = {
  code: [{ required: true, message: '请输入通道代码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入通道显示名', trigger: 'blur' }],
}

/** 打开弹窗：编辑态由行数据填充（code 编辑不可改，控件禁用） */
function open(context: { appId: string, channel?: ChannelVO }): void {
  appId.value = context.appId
  visible.value = true
  if (context.channel) {
    form.id = context.channel.id
    form.code = context.channel.code
    form.name = context.channel.name
    form.status = context.channel.status
    form.sort = context.channel.sort
  }
}

function resetForm(): void {
  formRef.value?.resetFields()
  form.id = undefined
  form.code = ''
  form.name = ''
  form.status = 'enabled'
  form.sort = 0
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().then(() => true).catch(() => false)
  if (!valid) {
    return
  }
  submitting.value = true
  try {
    if (form.id) {
      await updateChannel(appId.value, form.id, {
        name: form.name,
        status: form.status,
        sort: form.sort,
      })
      ElMessage.success('修改成功')
    }
    else {
      await createChannel(appId.value, { code: form.code, name: form.name, sort: form.sort })
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
