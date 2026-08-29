import { createRouter, createWebHistory } from 'vue-router';

import { routes } from '@/router/routes';
import { pinia } from '@/stores';
import { useAuthStore } from '@/features/auth/stores/auth-store';
import { authenticatedLandingRoute, hasRouteAccess } from '@/router/access';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore(pinia);

  if (authStore.status === 'idle') {
    await authStore.bootstrap();
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return {
      name: 'login',
      query: { redirect: to.fullPath, reason: 'session_required' },
    };
  }

  if (to.name === 'login' && authStore.isAuthenticated) {
    return authenticatedLandingRoute(authStore.currentUser?.permissions);
  }

  if (!hasRouteAccess(authStore.currentUser?.permissions, to.meta)) {
    if (to.name === 'dashboard' && authStore.isAuthenticated) {
      return authenticatedLandingRoute(authStore.currentUser?.permissions);
    }
    return { name: 'forbidden' };
  }

  document.title = `${to.meta.title} | 灵帧管理中心`;
  return true;
});

window.addEventListener('lingzhen:session-expired', () => {
  const authStore = useAuthStore(pinia);
  authStore.expireSession();
  void router.replace({ name: 'login', query: { reason: 'session_expired' } });
});
