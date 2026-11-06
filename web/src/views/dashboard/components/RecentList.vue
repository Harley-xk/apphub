<!--
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台最近动态只读简报（语义化列表，不使用 ApphubTable——设计 §7.3 豁免）
-->
<script setup lang="ts">
import { formatDateTime } from '@/utils/format'

export interface RecentItem {
  key: string
  title: string
  /** 次要信息（会员 · 应用 / 归属应用） */
  subtitle?: string | null
  /** 右侧附加信息（金额 / 状态） */
  meta?: string
  /** 毫秒时间戳 */
  time: number
}

defineProps<{
  title: string
  items: RecentItem[]
  emptyText?: string
}>()
</script>

<template>
  <div class="recent-list">
    <div class="recent-list__title">
      {{ title }}
    </div>
    <ul
      v-if="items.length"
      class="recent-list__items"
    >
      <li
        v-for="item in items"
        :key="item.key"
        class="recent-list__item"
      >
        <div class="recent-list__headline">
          <span class="recent-list__name">{{ item.title }}</span>
          <span
            v-if="item.meta"
            class="recent-list__meta"
          >{{ item.meta }}</span>
        </div>
        <div class="recent-list__sub">
          <span>{{ item.subtitle || '-' }}</span>
          <span>{{ formatDateTime(item.time) }}</span>
        </div>
      </li>
    </ul>
    <div
      v-else
      class="recent-list__empty"
    >
      {{ emptyText ?? '暂无数据' }}
    </div>
  </div>
</template>

<style scoped>
.recent-list {
  height: 100%;
  padding: 16px;
  border: 1px solid var(--apphub-card-border);
  border-radius: var(--apphub-radius);
  background: var(--apphub-card-bg);
  box-shadow: var(--apphub-card-shadow);
}

.recent-list__title {
  margin-bottom: 10px;
  color: var(--apphub-text-1);
  font-size: 14px;
  font-weight: 600;
}

.recent-list__items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent-list__item {
  padding: 8px 0;
  border-top: 1px solid var(--apphub-divider);
}

.recent-list__item:first-child {
  border-top: none;
}

.recent-list__headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.recent-list__name {
  overflow: hidden;
  color: var(--apphub-text-1);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-list__meta {
  flex-shrink: 0;
  color: var(--apphub-text-1);
  font-size: 13px;
}

.recent-list__sub {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
  color: var(--apphub-text-3);
  font-size: 12px;
}

.recent-list__empty {
  padding: 24px 0;
  color: var(--apphub-text-3);
  font-size: 13px;
  text-align: center;
}
</style>
