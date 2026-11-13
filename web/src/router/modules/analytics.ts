/*
 * 作者: Harley-xk
 * 创建: 2026-11-13
 *
 * 描述: 数据分析路由模块：活跃度统计页（analytics:activity:query 权限控制菜单与直链可见性）
 */
import type { RouteRecordRaw } from 'vue-router'

export const analyticsRoutes: RouteRecordRaw[] = [
  {
    path: 'analytics',
    name: 'Analytics',
    redirect: '/analytics/activity',
    meta: { title: '数据分析', icon: 'analytics' },
    children: [
      {
        path: 'activity',
        name: 'AnalyticsActivity',
        component: () => import('@/views/analytics/activity/index.vue'),
        meta: {
          title: '活跃度',
          icon: 'analytics-activity',
          permission: 'analytics:activity:query',
          keepAlive: true,
        },
      },
    ],
  },
]
