<!--
 * 作者: Harley-xk
 * 创建: 2026-10-20
 *
 * 描述: 品牌图形标「三花聚心」（WITICE 冰蓝变体）：三朵中雪花品字靠边环绕中心枢纽；尺寸由使用方 class 指定，色彩走 --apphub-logo-* token；规格见 docs/前端/品牌与Logo设计.md
-->
<template>
  <svg class="brand-mark" viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <defs>
      <linearGradient
        id="brand-mark-grad"
        x1="0"
        y1="0"
        x2="1"
        y2="1"
      >
        <stop offset="0" class="brand-mark-grad-a" />
        <stop offset="1" class="brand-mark-grad-b" />
      </linearGradient>
    </defs>
    <path
      class="brand-mark-frame"
      d="M40 7 L65 21.5 L65 50.5 L40 65 L15 50.5 L15 21.5 Z"
    />
    <g
      class="brand-mark-flakes"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <template v-for="pose in FLAKE_POSES" :key="pose">
        <path
          v-for="angle in ARM_ANGLES"
          :key="angle"
          :transform="`${pose} rotate(${angle})`"
          :d="ARM_D"
        />
      </template>
    </g>
    <circle class="brand-mark-dot" cx="40" cy="36" r="2.8" />
  </svg>
</template>

<script setup lang="ts">
/** 单臂臂型（等臂 R8 六臂全分叉：内端 3 / 外端 8 / 分叉起 4.5 / 叉端 7.5 / 叉横距 1.9，规格见品牌设计文档 §3） */
const ARM_D
  = 'M0 -8 L0 -3 M0 -4.5 L-1.9 -7.5 M0 -4.5 L1.9 -7.5 M0 8 L0 3 M0 4.5 L-1.9 7.5 M0 4.5 L1.9 7.5'

/** 三朵花心位姿：花心距中心 12 品字靠边（左 / 右下 / 右上），自转使朝心臂指向六边形中心 */
const FLAKE_POSES = [
  'translate(28 36) rotate(90)',
  'translate(46 44.39) rotate(-30)',
  'translate(46 25.61) rotate(-150)',
]

/** 一条臂型互转 0/60/120 生成六臂 */
const ARM_ANGLES = [0, 60, 120]
</script>

<style scoped>
.brand-mark {
  display: block;
  width: 100%;
  height: 100%;
}

.brand-mark-grad-a {
  stop-color: var(--apphub-logo-ice-a);
}

.brand-mark-grad-b {
  stop-color: var(--apphub-logo-ice-b);
}

.brand-mark-frame {
  stroke: url(#brand-mark-grad);
  stroke-width: 3.5;
  fill: var(--apphub-logo-tint);
}

.brand-mark-flakes {
  stroke: url(#brand-mark-grad);
}

.brand-mark-dot {
  fill: url(#brand-mark-grad);
}
</style>
