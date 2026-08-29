import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('@/layouts/AuthLayout.vue'),
    meta: { title: '登录', isPublic: true },
    children: [
      {
        path: '',
        name: 'login',
        component: () => import('@/features/auth/pages/LoginPage.vue'),
        meta: { title: '登录', isPublic: true },
      },
    ],
  },
  {
    path: '/',
    component: () => import('@/layouts/ManagementLayout.vue'),
    meta: { title: '管理中心', requiresAuth: true },
    children: [
      {
        path: '',
        redirect: '/dashboard',
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/features/dashboard/pages/DashboardPage.vue'),
        meta: { title: '总览', requiresAuth: true, requiredPermission: 'tenant.read' },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/features/management/pages/UserManagementPage.vue'),
        meta: { title: '用户管理', requiresAuth: true, requiredPermission: 'membership.read' },
      },
      {
        path: 'tenant',
        name: 'tenant',
        component: () => import('@/features/management/pages/TenantManagementPage.vue'),
        meta: { title: '租户概览', requiresAuth: true, requiredPermission: 'tenant.read' },
      },
      {
        path: 'models',
        name: 'models',
        component: () => import('@/features/model-catalog/pages/ModelCatalogPage.vue'),
        meta: {
          title: '模型目录',
          requiresAuth: true,
          requiredPermissionsAnyOf: ['model_catalog.read', 'tenant_model.read'],
        },
      },
      {
        path: 'credits',
        name: 'credits',
        component: () => import('@/features/credits-management/pages/CreditsManagementPage.vue'),
        meta: {
          title: '积分与充值',
          requiresAuth: true,
          requiredPermission: 'credits.manage',
        },
      },
    ],
  },
  {
    path: '/403',
    name: 'forbidden',
    component: () => import('@/features/system/pages/ForbiddenPage.vue'),
    meta: { title: '无权访问', isPublic: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/features/system/pages/NotFoundPage.vue'),
    meta: { title: '页面不存在', isPublic: true },
  },
];
