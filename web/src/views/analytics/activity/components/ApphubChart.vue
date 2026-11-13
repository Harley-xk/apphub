<!--
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: ECharts 薄封装：按需注册折线 / 柱状图，响应容器尺寸变化并随 option 变化重绘
-->
<template>
  <div ref="containerRef" class="apphub-chart" :style="{ height }" />
</template>

<script setup lang="ts">
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

// 按需注册：仅引入活跃度页面用到的折线 / 柱状与基础组件（Q1 定稿：按需引入 ECharts）
echarts.use([LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  option: EChartsCoreOption
  height?: string
}>(), {
  height: '320px',
})

const containerRef = ref<HTMLDivElement | null>(null)
const chartRef = shallowRef<EChartsType | null>(null)
let resizeObserver: ResizeObserver | null = null

function render(): void {
  chartRef.value?.setOption(props.option, { notMerge: true })
}

onMounted(() => {
  if (!containerRef.value)
    return
  chartRef.value = echarts.init(containerRef.value)
  render()
  // 容器宽度随侧栏收起 / 窗口缩放变化：观察容器自身而非全局 resize
  resizeObserver = new ResizeObserver(() => chartRef.value?.resize())
  resizeObserver.observe(containerRef.value)
})

watch(() => props.option, render, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  chartRef.value?.dispose()
  chartRef.value = null
})
</script>

<style scoped>
.apphub-chart {
  width: 100%;
}
</style>
