<!--
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 登录页（根级路由，不进主布局）：账号口令登录，redirect 参数回带；青碧卡片浮起视觉（--apphub-* token）
 * 文案契约（浏览器 e2e 依赖）：placeholder「请输入登录账号 / 请输入登录密码」、按钮「登 录」
-->
<script setup lang="ts">
import { Lock, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BrandMark from '@/components/BrandMark/index.vue'
import { useAuthStore } from '@/stores/auth'

defineOptions({ name: 'Login' })

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const form = reactive({
  username: '',
  password: '',
})

const loading = ref(false)

/** 登录：成功后回带 redirect 跳转（守卫将在此后的首次导航拉取权限信息） */
async function handleLogin(): Promise<void> {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入登录账号与登录密码')
    return
  }
  loading.value = true
  try {
    await auth.login(form.username, form.password)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
  }
  catch {
    // 失败提示已由 http 层统一弹出（携带后端业务 message），此处仅停留登录页
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <main class="login-card">
      <header class="login-brand">
        <BrandMark class="login-logo" />
        <h1 class="login-title">
          应用管理平台
        </h1>
        <p class="login-subtitle">
          企业级全栈项目框架底座
        </p>
      </header>

      <form class="login-form" @submit.prevent="handleLogin">
        <el-input
          v-model="form.username"
          size="large"
          name="username"
          placeholder="请输入登录账号"
          :prefix-icon="User"
          autocomplete="username"
        />
        <el-input
          v-model="form.password"
          size="large"
          type="password"
          name="password"
          placeholder="请输入登录密码"
          :prefix-icon="Lock"
          show-password
          autocomplete="current-password"
          @keyup.enter="handleLogin"
        />
        <el-button
          type="primary"
          size="large"
          class="login-submit"
          :loading="loading"
          native-type="submit"
        >
          登 录
        </el-button>
      </form>
    </main>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  /* 画布底色由全局 body 提供，此处仅留白 */
}

/* 中央白卡片：青碧卡片浮起（白底 + 1px 边框 + 10px 圆角 + 阴影） */
.login-card {
  width: 380px;
  max-width: calc(100vw - 32px);
  padding: 36px 32px 32px;
  background: var(--apphub-card-bg);
  border: 1px solid var(--apphub-card-border);
  border-radius: var(--apphub-radius);
  box-shadow: var(--apphub-card-shadow);
}

.login-brand {
  text-align: center;
  margin-bottom: 28px;
}

/* 品牌图形标：三花聚心（BrandMark，色彩走 --apphub-logo-* token 明暗自动翻转；规格见 docs/前端/品牌与Logo设计.md） */
.login-logo {
  display: block;
  width: 44px;
  height: 44px;
  margin: 0 auto;
}

.login-title {
  margin: 12px 0 0;
  font-size: 22px;
  color: var(--apphub-text-1);
}

.login-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--apphub-text-3);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-submit {
  margin-top: 4px;
  width: 100%;
}
</style>
