<!--
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 顶栏品牌区默认组件（layout:logo 槽位兜底）：三花聚心品牌标（BrandMark）+ 系统名，业务可经槽位注册表替换；图形规格见 docs/前端/品牌与Logo设计.md
-->
<template>
  <div class="apphub-logo">
    <BrandMark class="apphub-logo-mark" />
    <span class="apphub-logo-title">应用管理平台</span>
  </div>
</template>

<script setup lang="ts">
import BrandMark from '@/components/BrandMark/index.vue'
</script>

<style scoped>
.apphub-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.apphub-logo-mark {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
}

.apphub-logo-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--apphub-text-1);
  letter-spacing: 0.5px;
}
</style>
