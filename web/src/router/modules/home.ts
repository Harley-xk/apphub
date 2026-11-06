/*
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 工作台路由模块（首页；meta.permission 控制菜单与直链可见性，路由 name / path 保持不变）
 */
import type { RouteRecordRaw } from 'vue-router'

import DashboardView from '@/views/dashboard/index.vue'

export const homeRoutes: RouteRecordRaw[] = [
  {
    path: 'home',
    name: 'Home',
    component: DashboardView,
    meta: { title: '工作台', icon: 'dashboard', permission: 'dashboard:overview:query' },
  },
]
