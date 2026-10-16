<!--
  作者: Harley-xk
  创建: 2026-10-17

  描述: 会员管理页：关键字搜索分页 + 详情抽屉（凭证清单 / 解绑 / 重置密码）/ 启停 / 删除（统一认证设计 §3.4）
-->
<template>
  <div class="page-container">
    <el-card>
      <el-form class="search-bar" inline :model="queryParam" @submit.prevent>
        <el-form-item label="关键字">
          <el-input
            v-model="queryParam.keyword"
            placeholder="昵称 / 手机 / 邮箱模糊匹配"
            clearable
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">
            查询
          </el-button>
          <el-button @click="handleReset">
            重置
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card">
      <ApphubTable :columns="columns" :data="tableData" :loading="loading">
        <template #nickname="{ row }">
          <div class="member-name-cell">
            <el-avatar v-if="row.avatarUrl" :size="24" :src="row.avatarUrl" />
            <span>{{ row.nickname }}</span>
          </div>
        </template>
        <template #phone="{ row }">
          {{ row.phone ?? '-' }}
        </template>
        <template #email="{ row }">
          {{ row.email ?? '-' }}
        </template>
        <template #status="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '正常' : '已禁用' }}
          </el-tag>
        </template>
        <template #action="{ row }">
          <el-button v-hasPermi="'member:member:query'" link type="primary" @click="openDetail(row)">
            详情
          </el-button>
          <el-button
            v-if="row.status === 'active'"
            v-hasPermi="'member:member:disable'"
            link
            type="warning"
            @click="handleToggleStatus(row)"
          >
            禁用
          </el-button>
          <el-button
            v-else
            v-hasPermi="'member:member:enable'"
            link
            type="success"
            @click="handleToggleStatus(row)"
          >
            启用
          </el-button>
          <el-button v-hasPermi="'member:member:remove'" link type="danger" @click="handleDelete(row)">
            删除
          </el-button>
        </template>
      </ApphubTable>

      <el-pagination
        class="pagination-bar"
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        :current-page="queryParam.pageNo"
        :page-size="queryParam.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        @current-change="handlePageChange"
        @size-change="handleSizeChange"
      />
    </el-card>

    <MemberDetailDrawer ref="detailDrawerRef" />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'

import type { MemberVO } from '@/api/member/member'
import { deleteMember, disableMember, enableMember, getMemberPage } from '@/api/member/member'
import ApphubTable from '@/components/ApphubTable/index.vue'
import type { ApphubTableColumn } from '@/components/ApphubTable/types'
import { dateTimeFormatter } from '@/utils/format'
import MemberDetailDrawer from '@/views/member/member/components/MemberDetailDrawer.vue'

// 与路由 name 对齐（keep-alive 缓存键契约）
defineOptions({ name: 'MemberList' })

/** 列定义（field 即列宽 / 列序持久化标识，设计见 docs/前端/表格组件设计.md） */
const columns: ApphubTableColumn[] = [
  { field: 'nickname', title: '昵称', minWidth: 180, slot: 'nickname' },
  { field: 'phone', title: '手机', width: 140, slot: 'phone' },
  { field: 'email', title: '邮箱', minWidth: 180, slot: 'email' },
  { field: 'status', title: '状态', width: 90, slot: 'status' },
  { field: 'lastLoginAt', title: '最近登录', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'createTime', title: '注册时间', minWidth: 170, formatter: dateTimeFormatter },
  { field: 'action', title: '操作', width: 190, fixed: 'right', slot: 'action' },
]

const loading = ref(false)
const tableData = ref<MemberVO[]>([])
const total = ref(0)

const queryParam = reactive({
  pageNo: 1,
  pageSize: 10,
  keyword: '',
})

const detailDrawerRef = ref<InstanceType<typeof MemberDetailDrawer>>()

onMounted(() => {
  loadTable()
})

async function loadTable(): Promise<void> {
  loading.value = true
  try {
    const page = await getMemberPage({
      pageNo: queryParam.pageNo,
      pageSize: queryParam.pageSize,
      keyword: queryParam.keyword || undefined,
    })
    tableData.value = page.list
    total.value = page.total
  }
  finally {
    loading.value = false
  }
}

function handleQuery(): void {
  queryParam.pageNo = 1
  loadTable()
}

function handleReset(): void {
  queryParam.keyword = ''
  handleQuery()
}

function handlePageChange(pageNo: number): void {
  queryParam.pageNo = pageNo
  loadTable()
}

function handleSizeChange(pageSize: number): void {
  queryParam.pageSize = pageSize
  queryParam.pageNo = 1
  loadTable()
}

function openDetail(member: MemberVO): void {
  detailDrawerRef.value?.open(member)
}

async function handleToggleStatus(member: MemberVO): Promise<void> {
  const disabling = member.status === 'active'
  const confirmed = await ElMessageBox.confirm(
    disabling
      ? `确定禁用会员「${member.nickname}」吗？其全部登录状态将立即失效`
      : `确定启用会员「${member.nickname}」吗？启用后需重新登录`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await (disabling ? disableMember(member.id) : enableMember(member.id))
  ElMessage.success(disabling ? '已禁用' : '已启用')
  loadTable()
}

async function handleDelete(member: MemberVO): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定删除会员「${member.nickname}」吗？删除后其凭证标识不再释放（防抢注），不可恢复`,
    '提示',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) {
    return
  }
  await deleteMember(member.id)
  ElMessage.success('删除成功')
  loadTable()
}
</script>

<style scoped>
.member-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
