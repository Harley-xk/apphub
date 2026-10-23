<!--
  作者: Harley-xk
  创建: 2026-09-28

  描述: 角色新增 / 编辑弹窗：code 创建后不可改（super_admin 为保留字，编辑态隐藏 code 输入语义为禁改）
-->
<template>
  <el-dialog
    v-model="visible"
    :title="form.id ? '编辑角色' : '新增角色'"
    width="480px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="角色名称" prop="name">
        <el-input v-model="form.name" placeholder="角色名称" maxlength="30" />
      </el-form-item>
      <el-form-item label="角色标识" prop="code">
        <el-input
          v-model="form.code"
          placeholder="唯一标识（创建后不可修改）"
          maxlength="50"
          :disabled="!!form.id"
        />
      </el-form-item>
      <el-form-item label="显示排序" prop="sort">
        <el-input-number v-model="form.sort" :min="0" :max="9999" />
      </el-form-item>
      <el-form-item label="数据范围">
        <el-radio-group v-model="form.dataScope">
          <el-radio value="all">
            全部应用
          </el-radio>
          <el-radio value="app">
            按应用
          </el-radio>
        </el-radio-group>
        <div class="form-hint">
          按应用：仅能操作账户被授权的应用（appcenter / subscription），未授权即不可见
        </div>
      </el-form-item>
      <el-form-item v-if="form.id" label="启用状态">
        <el-switch v-model="form.status" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="2"
          placeholder="备注（可选）"
          maxlength="200"
        />
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

import { createRole, updateRole } from '@/api/system/role'
import type { RoleVO } from '@/api/system/role'

const emit = defineEmits<{ saved: [] }>()

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  id: undefined as string | undefined,
  name: '',
  code: '',
  sort: 0,
  /** 数据范围：all 全部应用 / app 按应用收窄 */
  dataScope: 'all',
  remark: '',
  status: true,
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入角色标识', trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9-]*$/, message: '小写字母开头，可含数字 / 连字符', trigger: 'blur' },
  ],
}

/** 打开弹窗：编辑态由行数据填充 */
function open(role?: RoleVO): void {
  visible.value = true
  if (role) {
    form.id = role.id
    form.name = role.name
    form.code = role.code
    form.sort = role.sort
    form.dataScope = role.dataScope ?? 'all'
    form.remark = role.remark ?? ''
    form.status = role.status
  }
}

function resetForm(): void {
  formRef.value?.resetFields()
  form.id = undefined
  form.name = ''
  form.code = ''
  form.sort = 0
  form.dataScope = 'all'
  form.remark = ''
  form.status = true
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().then(() => true).catch(() => false)
  if (!valid) {
    return
  }
  submitting.value = true
  try {
    if (form.id) {
      await updateRole({
        id: form.id,
        name: form.name,
        status: form.status,
        sort: form.sort,
        dataScope: form.dataScope,
        remark: form.remark || undefined,
      })
      ElMessage.success('修改成功')
    }
    else {
      await createRole({
        name: form.name,
        code: form.code,
        sort: form.sort,
        dataScope: form.dataScope,
        remark: form.remark || undefined,
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
.form-hint {
  margin-top: 4px;
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
}
</style>
