<script setup lang="ts">
import { useRouter } from 'vue-router';

import AppState from '@/components/AppState.vue';

const router = useRouter();
</script>

<template>
  <main class="system-page">
    <AppState
      kind="empty"
      title="页面不存在"
      description="你访问的地址不存在，或页面已经移动。"
      action-label="返回管理中心"
      @action="router.push({ name: 'dashboard' })"
    />
  </main>
</template>

<style scoped>
.system-page {
  display: grid;
  min-height: 100dvh;
  place-items: center;
  background: var(--lz-color-bg);
}
</style>
