<!--
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 顶栏用户区默认组件（layout:header-user 槽位兜底）：用户昵称 + 首字头像 + 退出登录下拉
   契约：根元素保留 .user-entry 类（登录链路 e2e 选择器依赖）
-->
<template>
  <el-dropdown class="user-entry" trigger="click" @command="handleCommand">
    <span class="user-trigger">
      <span class="apphub-avatar">{{ avatarText }}</span>
      <span class="apphub-user-name">{{ auth.user?.nickname ?? auth.user?.username ?? '未登录' }}</span>
      <el-icon :size="12">
        <ArrowDown />
      </el-icon>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="logout">
          退出登录
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { ArrowDown } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

/** 首字头像：昵称 / 用户名首字，兜底「客」 */
const avatarText = computed(() => {
  const name = auth.user?.nickname ?? auth.user?.username ?? ''
  return name ? name.charAt(0) : '客'
})

async function handleCommand(command: string | number | object): Promise<void> {
  if (command !== 'logout') {
    return
  }
  try {
    await ElMessageBox.confirm('确定退出登录吗？', '提示', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  }
  catch {
    return // 用户取消
  }
  await auth.logout()
  // 页签清理由守卫的登出联动承担（beforeEach 检测无 token 即 reset）
  await router.push('/login')
}
</script>

<style scoped>
.user-entry {
  display: inline-flex;
  align-items: center;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px 3px 3px;
  border-radius: 18px;
  cursor: pointer;
  outline: none;
  transition: background-color 0.2s;
}

.user-trigger:hover {
  background: var(--apphub-fill-hover);
}

.apphub-avatar {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--apphub-color-primary);
}

.apphub-user-name {
  font-size: 13px;
  color: var(--apphub-text-1);
}
</style>
