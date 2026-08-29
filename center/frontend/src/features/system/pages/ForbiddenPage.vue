<script setup lang="ts">
import { useRouter } from 'vue-router';

import AppState from '@/components/AppState.vue';

const router = useRouter();
</script>

<template>
  <main class="system-page">
    <AppState
      kind="forbidden"
      title="暂无访问权限"
      description="当前账号没有访问该页面的权限。如需使用，请联系租户管理员调整角色。"
      action-label="返回总览"
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
