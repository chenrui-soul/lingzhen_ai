<script setup lang="ts">
import ConfigProvider from 'ant-design-vue/es/config-provider';
import theme from 'ant-design-vue/es/theme';
import { RouterView } from 'vue-router';

import { antTheme } from '@/styles/ant-theme';
</script>

<template>
  <ConfigProvider :theme="{ algorithm: theme.darkAlgorithm, token: antTheme }">
    <RouterView />
  </ConfigProvider>
</template>
