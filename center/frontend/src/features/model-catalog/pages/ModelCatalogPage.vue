<script setup lang="ts">
import { PhEye, PhPencilSimple } from '@phosphor-icons/vue';
import { computed, nextTick, ref, watch } from 'vue';

import { useAuthStore } from '@/features/auth/stores/auth-store';
import PlatformCatalogPanel from '@/features/model-catalog/components/PlatformCatalogPanel.vue';
import TenantModelPolicyPanel from '@/features/model-catalog/components/TenantModelPolicyPanel.vue';

type CatalogTab = 'platform' | 'tenant';

const authStore = useAuthStore();
const canReadPlatform = computed(() =>
  Boolean(authStore.currentUser?.permissions?.includes('model_catalog.read')),
);
const canReadTenantPolicy = computed(() =>
  Boolean(authStore.currentUser?.permissions?.includes('tenant_model.read')),
);
const canManagePlatform = computed(() =>
  Boolean(authStore.currentUser?.permissions?.includes('model_catalog.manage')),
);
const storageKey = computed(
  () =>
    `lingzhen:model-catalog-tab:${authStore.currentUser?.userId ?? 'user'}:${authStore.currentUser?.tenantId ?? 'tenant'}`,
);

function allowedTab(value: string | null): value is CatalogTab {
  return (
    (value === 'platform' && canReadPlatform.value) ||
    (value === 'tenant' && canReadTenantPolicy.value)
  );
}

function initialTab(): CatalogTab {
  const saved = globalThis.sessionStorage.getItem(storageKey.value);
  if (allowedTab(saved)) return saved;
  return canReadPlatform.value ? 'platform' : 'tenant';
}

const activeTab = ref<CatalogTab>(initialTab());

watch(activeTab, (value) => globalThis.sessionStorage.setItem(storageKey.value, value));

async function activateTab(tab: CatalogTab, focus = false): Promise<void> {
  activeTab.value = tab;
  if (focus) {
    await nextTick();
    globalThis.document
      .getElementById(`${tab === 'platform' ? 'platform-catalog' : 'tenant-policy'}-tab`)
      ?.focus();
  }
}
</script>

<template>
  <div class="model-catalog-page">
    <header class="catalog-heading">
      <div>
        <span>平台能力目录</span>
        <h1>模型目录</h1>
        <p>核对平台已发布模型，以及 {{ authStore.tenantName }} 当前生效的模型策略。</p>
      </div>
      <div :class="['mode-indicator', canManagePlatform ? 'mode-indicator--write' : '']">
        <PhPencilSimple v-if="canManagePlatform" :size="17" />
        <PhEye v-else :size="17" />
        <span>{{ canManagePlatform ? '可维护目录' : '只读模式' }}</span>
      </div>
    </header>

    <div
      v-if="canReadPlatform && canReadTenantPolicy"
      class="catalog-tabs"
      role="tablist"
      aria-label="模型目录视图"
    >
      <button
        id="platform-catalog-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'platform'"
        aria-controls="platform-catalog-panel"
        :tabindex="activeTab === 'platform' ? 0 : -1"
        @click="activateTab('platform')"
        @keydown.right.prevent="activateTab('tenant', true)"
        @keydown.end.prevent="activateTab('tenant', true)"
      >
        平台目录
      </button>
      <button
        id="tenant-policy-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'tenant'"
        aria-controls="tenant-policy-panel"
        :tabindex="activeTab === 'tenant' ? 0 : -1"
        @click="activateTab('tenant')"
        @keydown.left.prevent="activateTab('platform', true)"
        @keydown.home.prevent="activateTab('platform', true)"
      >
        当前租户
      </button>
    </div>

    <section
      v-if="activeTab === 'platform' && canReadPlatform"
      id="platform-catalog-panel"
      role="tabpanel"
      aria-labelledby="platform-catalog-tab"
    >
      <PlatformCatalogPanel />
    </section>
    <section
      v-else-if="canReadTenantPolicy"
      id="tenant-policy-panel"
      role="tabpanel"
      aria-labelledby="tenant-policy-tab"
    >
      <TenantModelPolicyPanel @go-to-platform="activateTab('platform', true)" />
    </section>
  </div>
</template>

<style scoped>
.model-catalog-page {
  width: min(100%, 96rem);
  margin: 0 auto;
}
.catalog-heading {
  display: flex;
  padding: 0.35rem 0 1.35rem;
  gap: 2rem;
  align-items: flex-start;
  justify-content: space-between;
}
.catalog-heading > div:first-child > span {
  color: var(--lz-color-accent);
  font-size: 0.7rem;
  font-weight: 680;
  letter-spacing: 0.08em;
}
.catalog-heading h1 {
  margin: 0.3rem 0 0;
  color: var(--lz-color-text);
  font-size: clamp(1.75rem, 3vw, 2.45rem);
  letter-spacing: -0.04em;
}
.catalog-heading p {
  margin: 0.55rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.84rem;
}
.mode-indicator {
  display: inline-flex;
  padding: 0.45rem 0.72rem;
  gap: 0.4rem;
  align-items: center;
  color: var(--lz-color-accent);
  font-size: 0.71rem;
  font-weight: 650;
  background: rgba(85, 216, 241, 0.055);
  border: 1px solid rgba(85, 216, 241, 0.15);
  border-radius: var(--lz-radius-pill);
  white-space: nowrap;
}
.mode-indicator--write {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.06);
  border-color: rgba(114, 221, 194, 0.16);
}
.catalog-tabs {
  display: inline-flex;
  margin-bottom: 1rem;
  padding: 0.25rem;
  background: rgba(140, 177, 218, 0.055);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.85rem;
}
.catalog-tabs button {
  min-width: 7.5rem;
  height: 2.45rem;
  padding: 0 1rem;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 0.65rem;
  transition:
    color 220ms var(--lz-motion-standard),
    background-color 220ms var(--lz-motion-standard);
}
.catalog-tabs button[aria-selected='true'] {
  color: var(--lz-color-text);
  font-weight: 650;
  background: rgba(85, 216, 241, 0.1);
  box-shadow: inset 0 0 0 1px rgba(85, 216, 241, 0.1);
}
@media (max-width: 40rem) {
  .catalog-heading {
    display: grid;
    gap: 0.8rem;
  }
  .mode-indicator {
    justify-self: start;
  }
  .catalog-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
  }
  .catalog-tabs button {
    min-width: 0;
  }
}
</style>
