/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 订阅管理路由模块（M3）：计划 / 订单 / 订阅实例三页平铺（入口权限挂各自 query 权限点）
 */
import type { RouteRecordRaw } from 'vue-router'

export const subscriptionRoutes: RouteRecordRaw[] = [
  {
    path: 'subscription',
    name: 'Subscription',
    redirect: '/subscription/plan',
    meta: { title: '订阅管理', icon: 'subscription' },
    children: [
      {
        path: 'plan',
        name: 'SubscriptionPlan',
        component: () => import('@/views/subscription/plan/index.vue'),
        meta: { title: '订阅计划', icon: 'subscription-plan', permission: 'subscription:plan:query', keepAlive: true },
      },
      {
        path: 'order',
        name: 'SubscriptionOrder',
        component: () => import('@/views/subscription/order/index.vue'),
        meta: { title: '订单管理', icon: 'subscription-order', permission: 'subscription:order:query', keepAlive: true },
      },
      {
        path: 'sub',
        name: 'SubscriptionSub',
        component: () => import('@/views/subscription/sub/index.vue'),
        meta: { title: '订阅实例', icon: 'subscription-sub', permission: 'subscription:sub:query', keepAlive: true },
      },
    ],
  },
]
