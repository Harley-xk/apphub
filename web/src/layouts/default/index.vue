<!--
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 主布局（见 docs/前端/布局与风格设计.md §2）：浅灰画布 + 透明顶栏一整条 / 白卡片侧栏 + 主色微染浅底标签栏 + 连体白卡片内容区
-->
<template>
  <div class="apphub-app-wrapper">
    <LayoutHeader />
    <div class="apphub-main-container">
      <LayoutSidebar />
      <div class="apphub-content-layout">
        <TagsBar />
        <div class="apphub-content-card">
          <el-scrollbar class="apphub-content-scrollbar">
            <RouterView v-slot="{ Component, route: currentRoute }">
              <KeepAlive :include="tagsView.cachedNames">
                <component :is="Component" :key="currentRoute.fullPath" />
              </KeepAlive>
            </RouterView>
          </el-scrollbar>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTagsViewStore } from '@/stores/tags-view'

import LayoutHeader from './components/LayoutHeader.vue'
import LayoutSidebar from './components/LayoutSidebar.vue'
import TagsBar from './components/TagsBar.vue'

const tagsView = useTagsViewStore()
</script>

<style scoped>
.apphub-app-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.apphub-main-container {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}

.apphub-content-layout {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 内容白卡片：唯一滚动容器（el-scrollbar 内滚），与标签栏拼为一张视觉卡片 */
.apphub-content-card {
  flex: 1;
  min-height: 0;
  background: var(--apphub-card-bg);
  border: 1px solid var(--apphub-card-border);
  border-top: none;
  border-radius: 0 0 var(--apphub-radius) var(--apphub-radius);
  box-shadow: var(--apphub-card-shadow);
  overflow: hidden;
}

.apphub-content-scrollbar {
  height: 100%;
}
</style>
