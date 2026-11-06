<!--
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 工作台 KPI 卡：主数值 + 说明 + 可选迷你趋势图
-->
<script setup lang="ts">
import MiniSparkline from './MiniSparkline.vue'

defineProps<{
  label: string
  /** 已格式化好的展示值（金额 / 千分位由页面处理） */
  value: string
  /** 副文案（如「启用 3」「7 天内到期 2」） */
  hint?: string
  /** 趋势值序列（可选） */
  sparkline?: number[]
  /** 趋势图无障碍描述 */
  sparklineLabel?: string
}>()
</script>

<template>
  <div class="stat-card">
    <div class="stat-card__label">
      {{ label }}
    </div>
    <div class="stat-card__value">
      {{ value }}
    </div>
    <div
      v-if="hint"
      class="stat-card__hint"
    >
      {{ hint }}
    </div>
    <MiniSparkline
      v-if="sparkline && sparkline.length"
      class="stat-card__spark"
      :points="sparkline"
      :label="sparklineLabel ?? `${label}趋势`"
    />
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  min-height: 118px;
  padding: 16px;
  border: 1px solid var(--apphub-card-border);
  border-radius: var(--apphub-radius);
  background: var(--apphub-card-bg);
  box-shadow: var(--apphub-card-shadow);
}

.stat-card__label {
  color: var(--apphub-text-2);
  font-size: 13px;
}

.stat-card__value {
  color: var(--apphub-text-1);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
}

.stat-card__hint {
  color: var(--apphub-text-3);
  font-size: 12px;
}

.stat-card__spark {
  margin-top: auto;
}
</style>
