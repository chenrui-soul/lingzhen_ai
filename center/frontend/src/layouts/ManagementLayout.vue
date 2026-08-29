<script setup lang="ts">
import {
  PhBell,
  PhBuildings,
  PhCaretLeft,
  PhCaretRight,
  PhCoins,
  PhCube,
  PhList,
  PhPuzzlePiece,
  PhSignOut,
  PhSquaresFour,
  PhUsersThree,
} from '@phosphor-icons/vue';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppLogo from '@/components/AppLogo.vue';
import { useAuthStore } from '@/features/auth/stores/auth-store';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const isCollapsed = ref(false);
const isMobileMenuOpen = ref(false);

const selectedKeys = computed(() => [route.name?.toString() ?? 'dashboard']);
const canReadTenant = computed(() => authStore.currentUser?.permissions?.includes('tenant.read'));
const canReadMembers = computed(() =>
  authStore.currentUser?.permissions?.includes('membership.read'),
);
const canReadModels = computed(() =>
  authStore.currentUser?.permissions?.some((permission) =>
    ['model_catalog.read', 'tenant_model.read'].includes(permission),
  ),
);
const canManageCredits = computed(() =>
  authStore.currentUser?.permissions?.includes('credits.manage'),
);

async function handleLogout(): Promise<void> {
  await authStore.logout();
  await router.replace({ name: 'login' });
}

function navigateToDashboard(): void {
  isMobileMenuOpen.value = false;
  void router.push({ name: 'dashboard' });
}

function navigateTo(name: 'users' | 'tenant' | 'models' | 'credits'): void {
  isMobileMenuOpen.value = false;
  void router.push({ name });
}
</script>

<template>
  <div class="management-shell" :class="{ 'management-shell--collapsed': isCollapsed }">
    <aside
      class="management-sidebar"
      :class="{ 'management-sidebar--mobile-open': isMobileMenuOpen }"
    >
      <div class="management-sidebar__brand">
        <AppLogo :compact="isCollapsed" />
      </div>

      <nav class="management-sidebar__nav" aria-label="管理中心导航">
        <a-menu
          mode="inline"
          theme="dark"
          :selected-keys="selectedKeys"
          :inline-collapsed="isCollapsed"
        >
          <a-menu-item v-if="canReadTenant" key="dashboard" @click="navigateToDashboard">
            <template #icon><PhSquaresFour :size="19" weight="duotone" /></template>
            总览
          </a-menu-item>

          <a-menu-item-group key="organization" title="组织管理">
            <a-menu-item v-if="canReadMembers" key="users" @click="navigateTo('users')">
              <template #icon><PhUsersThree :size="19" /></template>
              用户管理
            </a-menu-item>
            <a-menu-item v-if="canReadTenant" key="tenant" @click="navigateTo('tenant')">
              <template #icon><PhBuildings :size="19" /></template>
              租户概览
            </a-menu-item>
          </a-menu-item-group>

          <a-menu-item-group key="platform" title="平台能力">
            <a-menu-item v-if="canReadModels" key="models" @click="navigateTo('models')">
              <template #icon><PhCube :size="19" /></template>
              模型目录
            </a-menu-item>
            <a-menu-item v-if="canManageCredits" key="credits" @click="navigateTo('credits')">
              <template #icon><PhCoins :size="19" /></template>
              积分与充值
            </a-menu-item>
          </a-menu-item-group>

          <a-menu-item-group v-if="!isCollapsed" key="planned" title="后续模块">
            <a-menu-item key="skills" disabled>
              <template #icon><PhPuzzlePiece :size="19" /></template>
              Skill 管理
            </a-menu-item>
          </a-menu-item-group>
        </a-menu>
      </nav>

      <button
        class="management-sidebar__collapse"
        type="button"
        :aria-label="isCollapsed ? '展开侧栏' : '收起侧栏'"
        @click="isCollapsed = !isCollapsed"
      >
        <PhCaretRight v-if="isCollapsed" :size="17" />
        <PhCaretLeft v-else :size="17" />
      </button>
    </aside>

    <button
      v-if="isMobileMenuOpen"
      class="management-shell__scrim"
      type="button"
      aria-label="关闭导航"
      @click="isMobileMenuOpen = false"
    />

    <section class="management-main">
      <header class="management-topbar">
        <div class="management-topbar__title">
          <button
            class="management-topbar__menu"
            type="button"
            aria-label="打开导航"
            @click="isMobileMenuOpen = true"
          >
            <PhList :size="21" />
          </button>
          <div>
            <span>{{ authStore.tenantName }}</span>
            <strong>{{ route.meta.title }}</strong>
          </div>
        </div>

        <div class="management-topbar__actions">
          <button class="topbar-icon-button" type="button" aria-label="通知" disabled>
            <PhBell :size="20" />
          </button>
          <div class="management-user">
            <span class="management-user__avatar" aria-hidden="true">
              {{ authStore.displayName.slice(0, 1).toUpperCase() }}
            </span>
            <span class="management-user__copy">
              <strong>{{ authStore.displayName }}</strong>
              <small>{{ authStore.currentUser?.role ?? 'member' }}</small>
            </span>
          </div>
          <button
            class="topbar-icon-button"
            type="button"
            aria-label="退出登录"
            @click="handleLogout"
          >
            <PhSignOut :size="20" />
          </button>
        </div>
      </header>

      <main class="management-content">
        <RouterView />
      </main>
    </section>
  </div>
</template>

<style scoped>
.management-shell {
  display: grid;
  min-height: 100dvh;
  grid-template-columns: 16.5rem minmax(0, 1fr);
  background:
    radial-gradient(circle at 92% 0, rgba(85, 216, 241, 0.055), transparent 30rem),
    var(--lz-color-bg);
  transition: grid-template-columns 360ms var(--lz-motion-standard);
}

.management-shell--collapsed {
  grid-template-columns: 5.25rem minmax(0, 1fr);
}

.management-sidebar {
  position: sticky;
  top: 0;
  z-index: var(--lz-z-sticky);
  display: flex;
  height: 100dvh;
  min-width: 0;
  padding: 1.25rem 0.85rem;
  flex-direction: column;
  background: rgba(5, 12, 23, 0.9);
  border-right: 1px solid var(--lz-color-line);
}

.management-sidebar__brand {
  min-height: 3.75rem;
  padding: 0 0.65rem;
}

.management-sidebar__nav {
  min-height: 0;
  margin-top: 1.5rem;
  flex: 1;
  overflow: hidden auto;
}

.management-sidebar__nav :deep(.ant-menu) {
  background: transparent;
  border: 0;
}

.management-sidebar__nav :deep(.ant-menu-item),
.management-sidebar__nav :deep(.ant-menu-submenu-title) {
  min-height: 2.85rem;
  margin-block: 0.25rem;
  border-radius: 0.75rem;
}

.management-sidebar__nav :deep(.ant-menu-item-selected) {
  color: var(--lz-color-text);
  background: rgba(85, 216, 241, 0.095);
  box-shadow: inset 3px 0 var(--lz-color-accent);
}

.management-sidebar__nav :deep(.ant-menu-item-selected .ant-menu-item-icon) {
  color: var(--lz-color-accent);
}

.management-sidebar__nav :deep(.ant-menu-item-group-title) {
  padding-top: 1.25rem;
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.08em;
}

.management-sidebar__collapse {
  display: grid;
  width: 2.4rem;
  height: 2.4rem;
  margin-left: auto;
  place-items: center;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: rgba(140, 177, 218, 0.07);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.7rem;
  transition:
    transform 260ms var(--lz-motion-standard),
    color 260ms var(--lz-motion-standard),
    background-color 260ms var(--lz-motion-standard);
}

.management-sidebar__collapse:hover {
  color: var(--lz-color-text);
  background: rgba(140, 177, 218, 0.12);
  transform: translateY(-1px);
}

.management-main {
  min-width: 0;
}

.management-topbar {
  position: sticky;
  top: 0;
  z-index: var(--lz-z-sticky);
  display: flex;
  height: 4.75rem;
  padding: 0 2rem;
  align-items: center;
  justify-content: space-between;
  background: rgba(7, 17, 30, 0.92);
  border-bottom: 1px solid var(--lz-color-line);
  backdrop-filter: blur(1.25rem);
}

.management-topbar__title {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.management-topbar__title div {
  display: grid;
}

.management-topbar__title span {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}

.management-topbar__title strong {
  color: var(--lz-color-text);
  font-size: 1rem;
  font-weight: 650;
}

.management-topbar__menu {
  display: none;
}

.management-topbar__actions {
  display: flex;
  gap: 0.65rem;
  align-items: center;
}

.topbar-icon-button,
.management-topbar__menu {
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 0.7rem;
  transition:
    color 240ms var(--lz-motion-standard),
    background-color 240ms var(--lz-motion-standard),
    transform 240ms var(--lz-motion-standard);
}

.topbar-icon-button:hover:not(:disabled),
.management-topbar__menu:hover {
  color: var(--lz-color-text);
  background: rgba(140, 177, 218, 0.09);
  transform: translateY(-1px);
}

.topbar-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.management-user {
  display: flex;
  min-width: 10rem;
  padding: 0 0.65rem;
  gap: 0.65rem;
  align-items: center;
}

.management-user__avatar {
  display: grid;
  width: 2.35rem;
  height: 2.35rem;
  place-items: center;
  color: #04131e;
  font-weight: 760;
  background: var(--lz-color-accent);
  border-radius: 0.75rem;
}

.management-user__copy {
  display: grid;
  min-width: 0;
}

.management-user__copy strong,
.management-user__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.management-user__copy strong {
  color: var(--lz-color-text);
  font-size: 0.78rem;
}

.management-user__copy small {
  color: var(--lz-color-subtle);
  font-size: 0.66rem;
}

.management-content {
  min-width: 0;
  padding: clamp(1.5rem, 3vw, 2.75rem);
}

.management-shell__scrim {
  display: none;
}

@media (max-width: 64rem) {
  .management-shell,
  .management-shell--collapsed {
    display: block;
  }

  .management-sidebar {
    position: fixed;
    left: 0;
    width: min(18rem, calc(100vw - 4rem));
    transform: translateX(-105%);
    transition: transform 340ms var(--lz-motion-standard);
  }

  .management-sidebar--mobile-open {
    transform: translateX(0);
  }

  .management-sidebar__collapse {
    display: none;
  }

  .management-shell__scrim {
    position: fixed;
    inset: 0;
    z-index: calc(var(--lz-z-sticky) - 1);
    display: block;
    cursor: pointer;
    background: rgba(5, 12, 23, 0.72);
    border: 0;
  }

  .management-topbar__menu {
    display: grid;
    place-items: center;
  }
}

@media (max-width: 40rem) {
  .management-topbar {
    height: 4.25rem;
    padding: 0 1rem;
  }

  .management-user {
    min-width: 0;
    padding: 0;
  }

  .management-user__copy {
    display: none;
  }

  .management-content {
    padding: 1.25rem 1rem;
  }
}
</style>
