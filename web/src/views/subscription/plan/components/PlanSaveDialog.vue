<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 订阅计划新增 / 编辑弹窗：应用归属（编辑不可改）、周期档位、价格（元输入分提交）、原价与排序备注
-->
<template>
  <el-dialog
    v-model="visible"
    :title="form.id ? '编辑订阅计划' : '新增订阅计划'"
    width="560px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="所属应用" prop="appId">
        <el-select
          v-model="form.appId"
          placeholder="选择应用"
          :disabled="!!form.id"
          style="width: 100%"
        >
          <el-option
            v-for="item in appOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="计划名称" prop="name">
        <el-input v-model="form.name" placeholder="如：专业版 · 年付" maxlength="64" />
      </el-form-item>
      <el-form-item label="周期档位" prop="periodType">
        <el-select v-model="form.periodType" placeholder="选择档位" style="width: 100%">
          <el-option
            v-for="option in PERIOD_TYPE_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="现价（元）" prop="price">
        <el-input-number
          v-model="form.price"
          :min="0"
          :precision="2"
          :step="1"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="划线原价（元）" prop="originalPrice">
        <el-input-number
          v-model="form.originalPrice"
          :min="0"
          :precision="2"
          :step="1"
          placeholder="不填则不展示划线价"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item v-if="form.id" label="在售状态">
        <el-switch
          v-model="form.status"
          active-text="在售"
          inactive-text="下架"
        />
      </el-form-item>
      <el-form-item label="排序" prop="sort">
        <el-input-number
          v-model="form.sort"
          :min="0"
          :max="9999"
          :step="1"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          placeholder="备注（可选）"
          maxlength="512"
          show-word-limit
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

import type { PlanVO } from '@/api/subscription/plan'
import { createPlan, PERIOD_TYPE_OPTIONS, updatePlan } from '@/api/subscription/plan'

const emit = defineEmits<{ saved: [] }>()

/** 应用下拉数据源（父页面拉取后传入，避免多页面重复请求） */
defineProps<{ appOptions: { id: string, name: string }[] }>()

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  id: undefined as string | undefined,
  appId: undefined as string | undefined,
  name: '',
  periodType: undefined as string | undefined,
  /** 价格以元录入、分提交（后端整数分存储） */
  price: 0,
  originalPrice: undefined as number | undefined,
  status: 'on',
  sort: 0,
  remark: '',
})

/** 与后端 CreatePlanDto / UpdatePlanDto 校验对齐 */
const rules: FormRules = {
  appId: [{ required: true, message: '请选择所属应用', trigger: 'change' }],
  name: [{ required: true, message: '请输入计划名称', trigger: 'blur' }],
  periodType: [{ required: true, message: '请选择周期档位', trigger: 'change' }],
  price: [
    { required: true, message: '请输入现价', trigger: 'blur' },
    { type: 'number', min: 0, message: '现价不能为负数', trigger: 'blur' },
  ],
}

/** 打开弹窗：编辑态由行数据填充（分 → 元回显） */
function open(plan?: PlanVO): void {
  visible.value = true
  if (plan) {
    form.id = plan.id
    form.appId = plan.appId
    form.name = plan.name
    form.periodType = plan.periodType
    form.price = plan.price / 100
    form.originalPrice = plan.originalPrice != null ? plan.originalPrice / 100 : undefined
    form.status = plan.status
    form.sort = plan.sort
    form.remark = plan.remark ?? ''
  }
}

function resetForm(): void {
  formRef.value?.resetFields()
  form.id = undefined
  form.appId = undefined
  form.name = ''
  form.periodType = undefined
  form.price = 0
  form.originalPrice = undefined
  form.status = 'on'
  form.sort = 0
  form.remark = ''
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().then(() => true).catch(() => false)
  if (!valid) {
    return
  }
  submitting.value = true
  try {
    if (form.id) {
      await updatePlan(form.id, {
        name: form.name,
        periodType: form.periodType!,
        price: Math.round(form.price * 100),
        status: form.status,
        originalPrice: form.originalPrice != null ? Math.round(form.originalPrice * 100) : undefined,
        sort: form.sort,
        remark: form.remark || undefined,
      })
      ElMessage.success('修改成功')
    }
    else {
      await createPlan({
        appId: form.appId!,
        name: form.name,
        periodType: form.periodType!,
        price: Math.round(form.price * 100),
        originalPrice: form.originalPrice != null ? Math.round(form.originalPrice * 100) : undefined,
        sort: form.sort,
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
