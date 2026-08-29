import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:9001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-vue',
              test: /node_modules[\\/](?:vue|@vue|vue-router|pinia|@tanstack)/,
              priority: 30,
            },
            {
              name: 'vendor-antd',
              test: /node_modules[\\/](?:ant-design-vue|@ant-design|vc-util|vue-types|async-validator|dayjs)/,
              priority: 20,
            },
            {
              name: 'vendor-icons',
              test: /node_modules[\\/]@phosphor-icons/,
              priority: 15,
            },
            {
              name: 'vendor-network',
              test: /node_modules[\\/]axios/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: true,
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/api/generated/**', 'src/main.ts'],
    },
  },
});
