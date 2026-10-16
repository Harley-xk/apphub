<!--
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 顶栏品牌区默认组件（layout:logo 槽位兜底）：青碧方块标 + 系统名，业务可经槽位注册表替换
-->
<template>
  <div class="apphub-logo">
    <span class="apphub-logo-mark">N</span>
    <span class="apphub-logo-title">应用管理平台</span>
  </div>
</template>

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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  /* 纯色主色方块（区别于渐变标），暗色下主色自动提亮 */
  background: var(--apphub-color-primary);
}

.apphub-logo-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--apphub-text-1);
  letter-spacing: 0.5px;
}
</style>
