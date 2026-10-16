/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 应用中心路由模块（应用与版本管理，M1）：应用列表页 + 版本下钻隐藏页（keepAlive 关闭防多页签串缓存）
 */
import type { RouteRecordRaw } from 'vue-router'

export const appcenterRoutes: RouteRecordRaw[] = [
  {
    path: 'appcenter',
    name: 'Appcenter',
    redirect: '/appcenter/app',
    meta: { title: '应用中心', icon: 'appcenter' },
    children: [
      {
        path: 'app',
        name: 'AppcenterApp',
        component: () => import('@/views/appcenter/app/index.vue'),
        meta: { title: '应用管理', icon: 'app', permission: 'appcenter:app:query', keepAlive: true },
      },
    ],
  },
]
