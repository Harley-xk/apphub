<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 应用注册 / 编辑弹窗：名称、形态标签、调用方类型（编辑不可改）、技术框架、图标 / 描述、排序
-->
<template>
  <el-dialog
    v-model="visible"
    :title="form.id ? '编辑应用' : '注册应用'"
    width="560px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="应用名称" prop="name">
        <el-input v-model="form.name" placeholder="应用名称" maxlength="64" />
      </el-form-item>
      <el-form-item label="形态标签" prop="appType">
        <el-checkbox-group v-model="form.appType">
          <el-checkbox value="desktop">
            桌面应用
          </el-checkbox>
          <el-checkbox value="web">
            Web 应用
          </el-checkbox>
          <el-checkbox value="mobile">
            移动应用
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item label="调用方类型" prop="clientType">
        <el-radio-group v-model="form.clientType" :disabled="!!form.id">
          <el-radio value="confidential">
            机密客户端（有后端，Secret 存服务端）
          </el-radio>
          <el-radio value="public">
            公开客户端（直连，限流阈值减半）
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="技术框架" prop="framework">
        <el-select v-model="form.framework" placeholder="选择框架（适配端点产物校验依据）" clearable style="width: 100%">
          <el-option label="Electron" value="electron" />
          <el-option label="Tauri" value="tauri" />
          <el-option label="自定义 / 其他" value="custom" />
        </el-select>
      </el-form-item>
      <el-form-item label="图标地址" prop="iconUrl">
        <el-input v-model="form.iconUrl" placeholder="应用图标 OSS 地址（可选）" maxlength="512" />
      </el-form-item>
      <el-form-item label="应用描述" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          placeholder="应用描述（可选）"
          maxlength="512"
          show-word-limit
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

import type { AppCredentialVO, AppVO } from '@/api/appcenter/app'
import { createApp, updateApp } from '@/api/appcenter/app'

const emit = defineEmits<{ saved: [], created: [credential: AppCredentialVO] }>()

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  id: undefined as string | undefined,
  name: '',
  appType: [] as string[],
  clientType: 'confidential',
  framework: undefined as string | undefined,
  iconUrl: '',
  description: '',
  sort: 0,
})

/** 与后端 AppCreateDto 校验对齐（名称必填 + 至少一个形态标签） */
const rules: FormRules = {
  name: [{ required: true, message: '请输入应用名称', trigger: 'blur' }],
  appType: [{ required: true, type: 'array', min: 1, message: '至少选择一个形态标签', trigger: 'change' }],
}

/** 打开弹窗：编辑态由行数据填充（clientType 编辑不可改，控件禁用） */
function open(app?: AppVO): void {
  visible.value = true
  if (app) {
    form.id = app.id
    form.name = app.name
    form.appType = [...app.appType]
    form.clientType = app.clientType
    form.framework = app.framework ?? undefined
    form.iconUrl = app.iconUrl ?? ''
    form.description = app.description ?? ''
    form.sort = app.sort
  }
}

function resetForm(): void {
  formRef.value?.resetFields()
  form.id = undefined
  form.name = ''
  form.appType = []
  form.clientType = 'confidential'
  form.framework = undefined
  form.iconUrl = ''
  form.description = ''
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
      await updateApp({
        id: form.id,
        name: form.name,
        appType: form.appType,
        framework: form.framework || undefined,
        iconUrl: form.iconUrl || undefined,
        description: form.description || undefined,
        sort: form.sort,
      })
      ElMessage.success('修改成功')
      visible.value = false
      emit('saved')
    }
    else {
      // 注册响应完整凭证，交由父页弹出凭证展示（此后可随时经列表点击查看）
      const credential = await createApp({
        name: form.name,
        appType: form.appType,
        clientType: form.clientType,
        framework: form.framework || undefined,
        iconUrl: form.iconUrl || undefined,
        description: form.description || undefined,
        sort: form.sort,
      })
      ElMessage.success('注册成功')
      visible.value = false
      emit('created', credential)
      emit('saved')
    }
  }
  finally {
    submitting.value = false
  }
}

defineExpose({ open })
</script>
