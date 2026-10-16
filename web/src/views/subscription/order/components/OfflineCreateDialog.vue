<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 线下收款备案对话框：会员远程搜索 → 应用 → 在售计划联动 → 实收金额（默认带计划价，可改协商价）→ 备案即生效
-->
<template>
  <el-dialog
    v-model="visible"
    title="线下收款备案"
    width="560px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="备案即生效：订单直接落为已支付并即时顺延订阅，收款事实由经办人负责（设计 §3.3）"
    />
    <el-form
      ref="formRef"
      class="dialog-form"
      :model="form"
      :rules="rules"
      label-width="100px"
    >
      <el-form-item label="会员" prop="memberId">
        <el-select
          v-model="form.memberId"
          placeholder="输入昵称 / 手机 / 邮箱搜索"
          filterable
          remote
          :remote-method="searchMembers"
          :loading="memberLoading"
          style="width: 100%"
        >
          <el-option
            v-for="member in memberOptions"
            :key="member.id"
            :label="member.nickname"
            :value="member.id"
          >
            <span>{{ member.nickname }}</span>
            <span class="option-hint">{{ member.phone ?? member.email ?? '' }}</span>
          </el-option>
        </el-select>
      </el-form-item>
      <el-form-item label="所属应用" prop="appId">
        <el-select
          v-model="form.appId"
          placeholder="选择应用"
          style="width: 100%"
          @change="handleAppChange"
        >
          <el-option
            v-for="item in appOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="订阅计划" prop="planId">
        <el-select
          v-model="form.planId"
          placeholder="先选择应用"
          :disabled="!form.appId"
          :loading="planLoading"
          style="width: 100%"
          @change="handlePlanChange"
        >
          <el-option
            v-for="plan in planOptions"
            :key="plan.id"
            :label="plan.name"
            :value="plan.id"
          >
            <span>{{ plan.name }}</span>
            <span class="option-hint">
              {{ periodTypeText(plan.periodType) }} · ¥{{ formatCentAmount(plan.price) }}
            </span>
          </el-option>
        </el-select>
      </el-form-item>
      <el-form-item label="实收金额（元）" prop="amount">
        <el-input-number
          v-model="form.amount"
          :min="0"
          :precision="2"
          :step="1"
          placeholder="默认带出计划价，协商价以录入为准"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="转账流水号" prop="transactionId">
        <el-input v-model="form.transactionId" placeholder="选填，便于对账" maxlength="64" />
      </el-form-item>
      <el-form-item label="收款备注" prop="offlineNote">
        <el-input
          v-model="form.offlineNote"
          type="textarea"
          :rows="3"
          placeholder="收款凭证说明（选填）"
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
        确认备案
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { reactive, ref } from 'vue'

import type { MemberVO } from '@/api/member/member'
import { getMemberPage } from '@/api/member/member'
import { createOfflineOrder, type OrderVO } from '@/api/subscription/order'
import type { PlanVO } from '@/api/subscription/plan'
import { getPlanPage, periodTypeText } from '@/api/subscription/plan'
import { formatCentAmount } from '@/utils/format'

const emit = defineEmits<{ saved: [order: OrderVO] }>()

/** 应用下拉数据源（父页面拉取后传入） */
defineProps<{ appOptions: { id: string, name: string }[] }>()

const visible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const memberOptions = ref<MemberVO[]>([])
const memberLoading = ref(false)
const planOptions = ref<PlanVO[]>([])
const planLoading = ref(false)

const form = reactive({
  memberId: undefined as string | undefined,
  appId: undefined as string | undefined,
  planId: undefined as string | undefined,
  /** 实收以元录入、分提交 */
  amount: undefined as number | undefined,
  transactionId: '',
  offlineNote: '',
})

/** 与后端 OfflineCreateDto 校验对齐 */
const rules: FormRules = {
  memberId: [{ required: true, message: '请搜索并选择会员', trigger: 'change' }],
  appId: [{ required: true, message: '请选择应用', trigger: 'change' }],
  planId: [{ required: true, message: '请选择订阅计划', trigger: 'change' }],
  amount: [
    { required: true, message: '请输入实收金额', trigger: 'blur' },
    { type: 'number', min: 0, message: '金额不能为负数', trigger: 'blur' },
  ],
}

function open(): void {
  visible.value = true
  searchMembers('')
}

function resetForm(): void {
  formRef.value?.resetFields()
  form.memberId = undefined
  form.appId = undefined
  form.planId = undefined
  form.amount = undefined
  form.transactionId = ''
  form.offlineNote = ''
  memberOptions.value = []
  planOptions.value = []
}

/** 会员远程搜索（关键字匹配昵称 / 手机 / 邮箱，脱敏值展示为提示文案） */
async function searchMembers(keyword: string): Promise<void> {
  memberLoading.value = true
  try {
    const page = await getMemberPage({ pageNo: 1, pageSize: 20, keyword: keyword || undefined })
    memberOptions.value = page.list
  }
  finally {
    memberLoading.value = false
  }
}

/** 切换应用：重选计划并拉取该应用在售计划 */
async function handleAppChange(): Promise<void> {
  form.planId = undefined
  form.amount = undefined
  planOptions.value = []
  if (!form.appId) {
    return
  }
  planLoading.value = true
  try {
    const page = await getPlanPage({ pageNo: 1, pageSize: 100, appId: form.appId, status: 'on' })
    planOptions.value = page.list
  }
  finally {
    planLoading.value = false
  }
}

/** 选中计划：默认带出计划价（协商价场景可手改） */
function handlePlanChange(planId: string): void {
  const plan = planOptions.value.find(item => item.id === planId)
  form.amount = plan ? plan.price / 100 : undefined
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().then(() => true).catch(() => false)
  if (!valid) {
    return
  }
  submitting.value = true
  try {
    const order = await createOfflineOrder({
      memberId: form.memberId!,
      planId: form.planId!,
      amount: Math.round(form.amount! * 100),
      transactionId: form.transactionId || undefined,
      offlineNote: form.offlineNote || undefined,
    })
    ElMessage.success(`备案成功，订单号 ${order.orderNo}`)
    visible.value = false
    emit('saved', order)
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
