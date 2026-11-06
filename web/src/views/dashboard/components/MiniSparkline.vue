<!--
 * 作者: Harley-xk
 * 创建: 2026-11-06
 *
 * 描述: 纯 SVG 迷你趋势图（不引入图表库）：按 min/max 归一化，全零 / 单点绘制水平基线
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 趋势值序列（按自然日升序，长度即区间天数） */
  points: number[]
  /** 无障碍描述（如「近 7 天会员新增趋势」） */
  label: string
}>()

/** 内部坐标系（响应式铺满容器，非等比缩放） */
const WIDTH = 100
const HEIGHT = 28
const PADDING = 2

const gradientId = `sparkline-${Math.random().toString(36).slice(2, 9)}`

/** 折线路径：全零或单点时退化为居中水平基线 */
const linePath = computed(() => {
  const values = props.points
  if (values.length === 0) {
    return ''
  }
  if (values.length === 1) {
    return `M ${PADDING} ${HEIGHT / 2} L ${WIDTH - PADDING} ${HEIGHT / 2}`
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  return values
    .map((value, index) => {
      const x = PADDING + (index / (values.length - 1)) * (WIDTH - PADDING * 2)
      const y = span === 0
        ? HEIGHT / 2
        : HEIGHT - PADDING - ((value - min) / span) * (HEIGHT - PADDING * 2)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
})

/** 面积路径：折线向下闭合到基线 */
const areaPath = computed(() => {
  if (!linePath.value) {
    return ''
  }
  return `${linePath.value} L ${WIDTH - PADDING} ${HEIGHT} L ${PADDING} ${HEIGHT} Z`
})
</script>

<template>
  <svg
    v-if="points.length"
    class="mini-sparkline"
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    preserveAspectRatio="none"
    role="img"
    :aria-label="label"
  >
    <defs>
      <linearGradient
        :id="gradientId"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop offset="0%" stop-color="var(--apphub-color-primary)" stop-opacity="0.28" />
        <stop offset="100%" stop-color="var(--apphub-color-primary)" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line
      :x1="0"
      :y1="HEIGHT - 0.5"
      :x2="WIDTH"
      :y2="HEIGHT - 0.5"
      class="mini-sparkline__baseline"
    />
    <path
      :d="areaPath"
      :fill="`url(#${gradientId})`"
      stroke="none"
    />
    <path
      :d="linePath"
      class="mini-sparkline__line"
      fill="none"
    />
  </svg>
</template>

<style scoped>
.mini-sparkline {
  display: block;
  width: 100%;
  height: 32px;
}

.mini-sparkline__baseline {
  stroke: var(--apphub-divider);
  stroke-width: 1;
}

.mini-sparkline__line {
  stroke: var(--apphub-color-primary);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
</style>
