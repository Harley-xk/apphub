<!--
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 多标签栏：白底细边框（上圆角与内容卡片连体），圆角块页签（激活主色浅底），右键菜单批量操作，左右扩展槽
-->
<template>
  <div class="apphub-tags-bar">
    <SlotRenderer :name="SLOT_KEYS.layoutTagsbarLeft" />
    <div ref="scrollRef" class="apphub-tags-scroll" @wheel="onWheel">
      <el-dropdown
        v-for="tab in tagsView.views"
        :key="tab.fullPath"
        trigger="contextmenu"
        @command="(command: string | number | object) => handleContextCommand(String(command), tab)"
      >
        <div
          class="apphub-tag"
          :class="{ active: tab.fullPath === route.fullPath }"
          :data-fullpath="tab.fullPath"
          @click="switchTab(tab)"
        >
          <el-icon class="apphub-tag-icon">
            <component :is="resolveMenuIcon(tab.icon)" />
          </el-icon>
          <span class="apphub-tag-title">{{ tab.title }}</span>
          <el-icon v-if="!tab.affix" class="apphub-tag-close" @click.stop="actions.closeTab(tab)">
            <Close />
          </el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="refresh" :disabled="tab.fullPath !== route.fullPath">
              刷新页签
            </el-dropdown-item>
            <el-dropdown-item command="close" :disabled="tab.affix">
              关闭页签
            </el-dropdown-item>
            <el-dropdown-item command="closeOthers" divided>
              关闭其他
            </el-dropdown-item>
            <el-dropdown-item command="closeLeft" :disabled="!hasSideTabs(tab, 'left')">
              关闭左侧
            </el-dropdown-item>
            <el-dropdown-item command="closeRight" :disabled="!hasSideTabs(tab, 'right')">
              关闭右侧
            </el-dropdown-item>
            <el-dropdown-item command="closeAll">
              全部关闭
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <SlotRenderer :name="SLOT_KEYS.layoutTagsbarRight" :fallback="DefaultTagsbarActions" />
  </div>
</template>

<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'
import { nextTick, ref, watch } from 'vue'
import type { LocationQueryRaw } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'

import { SLOT_KEYS } from '@/framework/slots/keys'
import SlotRenderer from '@/framework/slots/SlotRenderer.vue'
import { useTagsViewStore } from '@/stores/tags-view'
import type { TagView } from '@/stores/tags-view'
import { resolveMenuIcon } from '@/utils/menu-icon'

import { useTagsActions } from '../composables/use-tags-actions'
import DefaultTagsbarActions from '../defaults/DefaultTagsbarActions.vue'

const route = useRoute()
const router = useRouter()
const tagsView = useTagsViewStore()
const actions = useTagsActions()

const scrollRef = ref<HTMLDivElement>()

/** 竖向滚轮转横向滚动（页签条不换行） */
function onWheel(event: WheelEvent): void {
  if (event.deltaY !== 0 && scrollRef.value) {
    scrollRef.value.scrollLeft += event.deltaY
  }
}

function switchTab(tab: TagView): void {
  if (tab.fullPath === route.fullPath) {
    return
  }
  router.push({ path: tab.path, query: tab.query as LocationQueryRaw })
}

/** 锚点签左侧 / 右侧是否还有可关闭页签 */
function hasSideTabs(tab: TagView, side: 'left' | 'right'): boolean {
  const index = tagsView.views.findIndex((view) => view.fullPath === tab.fullPath)
  if (index === -1) {
    return false
  }
  const range = side === 'left' ? tagsView.views.slice(0, index) : tagsView.views.slice(index + 1)
  return range.some((view) => !view.affix)
}

function handleContextCommand(command: string, tab: TagView): void {
  switch (command) {
    case 'refresh':
      void actions.refreshCurrent()
      break
    case 'close':
      actions.closeTab(tab)
      break
    case 'closeOthers':
      actions.closeOthers(tab.fullPath)
      break
    case 'closeLeft':
      actions.closeSide(tab.fullPath, 'left')
      break
    case 'closeRight':
      actions.closeSide(tab.fullPath, 'right')
      break
    case 'closeAll':
      actions.closeAll()
      break
  }
}

/** 激活签变化时滚动到可见区 */
watch(
  () => route.fullPath,
  async () => {
    await nextTick()
    const el = scrollRef.value?.querySelector(`[data-fullpath="${CSS.escape(route.fullPath)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  },
)
</script>

<style scoped>
/* 标签栏：白底细边框（左右上三边），下边由内容卡片补齐，拼为一张视觉卡片 */
.apphub-tags-bar {
  height: var(--apphub-tags-bar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--apphub-card-bg);
  border: 1px solid var(--apphub-card-border);
  border-bottom: none;
  border-radius: var(--apphub-radius) var(--apphub-radius) 0 0;
  padding: 0 8px;
}

.apphub-tags-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  /* 页签条隐藏滚动条（滚轮横向滚动） */
  scrollbar-width: none;
}

.apphub-tags-scroll::-webkit-scrollbar {
  display: none;
}

/* 页签：圆角浅底块（激活主色浅底 + 主色文字） */
.apphub-tag {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border-radius: var(--apphub-radius-small);
  font-size: 12px;
  color: var(--apphub-text-2);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.apphub-tag:hover {
  background: var(--apphub-fill-hover);
  color: var(--apphub-color-primary);
}

/* 菜单图标：与侧栏共用语义映射，未激活时弱化 */
.apphub-tag-icon {
  font-size: 13px;
  color: var(--apphub-text-3);
}

.apphub-tag:hover .apphub-tag-icon,
.apphub-tag.active .apphub-tag-icon {
  color: var(--apphub-color-primary);
}

.apphub-tag.active {
  background: var(--apphub-color-primary-bg-light);
  color: var(--apphub-color-primary);
  font-weight: 500;
}

.apphub-tag-close {
  font-size: 12px;
  border-radius: 50%;
  color: var(--apphub-text-3);
}

.apphub-tag-close:hover {
  color: var(--apphub-text-1);
  background: var(--apphub-fill-hover);
}
</style>
