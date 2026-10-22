/*
 * 作者: Harley-xk
 * 创建: 2026-09-29
 *
 * 描述: 开发示例路由模块（示例商品单表 CRUD 样板，接入方式见 docs/指南/新模块接入指南.md 第 7 步）；
 *      菜单层隐藏（hidden）不进侧栏，路由保留供直链 /demo/product 访问——页面仍承担多标签 / keep-alive 等机制的 e2e 验证载体
 */
import type { RouteRecordRaw } from 'vue-router'

export const demoRoutes: RouteRecordRaw[] = [
  {
    path: 'demo',
    name: 'Demo',
    redirect: '/demo/product',
    meta: { title: '开发示例', icon: 'demo', hidden: true },
    children: [
      {
        path: 'product',
        name: 'DemoProduct',
        component: () => import('@/views/demo/product/index.vue'),
        meta: { title: '商品管理', icon: 'product', permission: 'demo:product:query', keepAlive: true },
      },
    ],
  },
]
