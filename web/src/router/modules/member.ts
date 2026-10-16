/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员中心路由模块（终端用户，M2）：会员管理页（入口挂 member:member:query 权限）
 */
import type { RouteRecordRaw } from 'vue-router'

export const memberRoutes: RouteRecordRaw[] = [
  {
    path: 'member',
    name: 'Member',
    redirect: '/member/list',
    meta: { title: '会员中心', icon: 'member' },
    children: [
      {
        path: 'list',
        name: 'MemberList',
        component: () => import('@/views/member/member/index.vue'),
        meta: { title: '会员管理', icon: 'member-list', permission: 'member:member:query', keepAlive: true },
      },
    ],
  },
]
