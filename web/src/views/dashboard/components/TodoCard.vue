<!--
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台待办卡：待处理数量 + 说明 + 可选跳转文字链（不做下钻筛选）
-->
<script setup lang="ts">
defineProps<{
  label: string
  count: number
  hint: string
  /** 目标列表页（仅导航，不带筛选参数） */
  to?: string
  linkText?: string
}>()
</script>

<template>
  <div class="todo-card">
    <div class="todo-card__head">
      <span class="todo-card__label">{{ label }}</span>
      <router-link
        v-if="to"
        class="todo-card__link"
        :to="to"
      >
        {{ linkText ?? '去处理' }}
      </router-link>
    </div>
    <div
      class="todo-card__count"
      :class="{ 'todo-card__count--zero': count === 0 }"
    >
      {{ count }}
    </div>
    <div class="todo-card__hint">
      {{ hint }}
    </div>
  </div>
</template>

<style scoped>
.todo-card {
  height: 100%;
  min-height: 104px;
  padding: 16px;
  border: 1px solid var(--apphub-card-border);
  border-radius: var(--apphub-radius);
  background: var(--apphub-card-bg);
  box-shadow: var(--apphub-card-shadow);
}

.todo-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.todo-card__label {
  color: var(--apphub-text-2);
  font-size: 13px;
}

.todo-card__link {
  color: var(--apphub-color-primary);
  font-size: 12px;
  text-decoration: none;
}

.todo-card__link:hover {
  color: var(--apphub-color-primary-hover);
}

.todo-card__count {
  margin-top: 6px;
  color: var(--apphub-text-1);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
}

.todo-card__count--zero {
  color: var(--apphub-text-3);
}

.todo-card__hint {
  margin-top: 4px;
  color: var(--apphub-text-3);
  font-size: 12px;
}
</style>
