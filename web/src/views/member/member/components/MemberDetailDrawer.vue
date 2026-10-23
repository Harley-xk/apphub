<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 会员详情抽屉：基本信息描述 + 凭证清单（脱敏标识 / 解绑 / 重置密码，统一认证设计 §3.4）
-->
<template>
  <el-drawer v-model="visible" :title="drawerTitle" size="720px">
    <div class="drawer-body">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="昵称">
          {{ detail?.nickname ?? '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="detail?.status === 'active' ? 'success' : 'info'" size="small">
            {{ detail?.status === 'active' ? '正常' : '已禁用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="手机">
          {{ detail?.phone ?? '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="邮箱">
          {{ detail?.email ?? '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="最近登录">
          {{ detail?.lastLoginAt ? dateTimeFormatter({ cellValue: detail.lastLoginAt }) : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="注册时间">
          {{ detail ? dateTimeFormatter({ cellValue: detail.createTime }) : '-' }}
        </el-descriptions-item>
      </el-descriptions>

      <div class="credential-toolbar">
        <el-button
          v-hasPermi="'member:credential:reset-password'"
          type="primary"
          @click="handleResetPassword"
        >
          重置密码
        </el-button>
        <span class="toolbar-hint">重置后新密码仅展示一次，该会员全部登录状态立即吊销</span>
      </div>

      <ApphubTable :columns="columns" :data="detail?.credentials ?? []" :loading="loading" persist-key="MemberList:credential">
        <template #credentialType="{ row }">
          <el-tag size="small" effect="plain">
            {{ CREDENTIAL_TYPE_LABELS[row.credentialType] ?? row.credentialType }}
          </el-tag>
        </template>
        <template #verified="{ row }">
          <el-tag :type="row.verified ? 'success' : 'warning'" size="small">
            {{ row.verified ? '已验证' : '未验证' }}
          </el-tag>
        </template>
        <template #action="{ row }">
          <el-button
            v-hasPermi="'member:credential:unbind'"
            link
            type="danger"
            @click="handleUnbind(row)"
          >
            解绑
          </el-button>
        </template>
      </ApphubTable>
    </div>

    <ResetPasswordDialog ref="resetPasswordDialogRef" />
  </el-drawer>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref } from 'vue'

import type { CredentialVO, MemberDetailVO, MemberVO } from '@/api/member/member'
import { getMember, resetMemberPassword, unbindCredential } from '@/api/member/member'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter } from '@/utils/format'
import ResetPasswordDialog from '@/views/member/member/components/ResetPasswordDialog.vue'

/** 凭证类型展示映射（M4 起五类型全开放：密码 / 手机 / 邮箱验证码与微信 / 支付宝扫码，认证方式扩展设计 §3.3） */
const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  password: '密码',
  phone: '手机',
  email: '邮箱',
  wechat: '微信',
  alipay: '支付宝',
}

/** 列定义（抽屉内表格：总宽收敛在抽屉内容宽约 680px 内，超宽会横向滚动拆 fixed 操作列——见表格组件设计） */
const columns: ApphubTableColumn[] = [
  { field: 'credentialType', title: '类型', width: 80, slot: 'credentialType' },
  { field: 'identifier', title: '标识（脱敏）', minWidth: 150 },
  { field: 'verified', title: '验证', width: 70, slot: 'verified' },
  { field: 'lastUsedAt', title: '最近使用', width: 150, formatter: dateTimeFormatter },
  { field: 'createTime', title: '绑定时间', width: 150, formatter: dateTimeFormatter },
  { field: 'action', title: '操作', width: 80, fixed: 'right', slot: 'action' },
]

const visible = ref(false)
const loading = ref(false)
const detail = ref<MemberDetailVO | null>(null)

const resetPasswordDialogRef = ref<InstanceType<typeof ResetPasswordDialog>>()

const drawerTitle = computed(() => (detail.value ? `会员详情 - ${detail.value.nickname}` : '会员详情'))

/** 打开抽屉：加载会员详情（含凭证清单，标识已脱敏） */
function open(member: MemberVO): void {
  visible.value = true
  loadDetail(member)
}

async function loadDetail(member: MemberVO): Promise<void> {
  loading.value = true
  try {
    detail.value = await getMember(member.id)
  }
  finally {
    loading.value = false
  }
}

async function handleUnbind(credential: CredentialVO): Promise<void> {
  const typeLabel = CREDENTIAL_TYPE_LABELS[credential.credentialType] ?? credential.credentialType
  const confirmed = await ElMessageBox.confirm(
    `确定解绑该会员的${typeLabel}凭证「${credential.identifier}」吗？解绑后该会员全部登录状态立即吊销`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed || !detail.value) {
    return
  }
  await unbindCredential(detail.value.id, credential.id)
  ElMessage.success('已解绑')
  loadDetail(detail.value)
}

async function handleResetPassword(): Promise<void> {
  if (!detail.value) {
    return
  }
  const confirmed = await ElMessageBox.confirm(
    '确定为该会员重置密码吗？将生成随机新密码（仅展示一次），其全部登录状态立即吊销',
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  const result = await resetMemberPassword(detail.value.id)
  resetPasswordDialogRef.value?.open(result.password)
}

defineExpose({ open })
</script>

<style scoped>
.drawer-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.credential-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-hint {
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}
</style>
