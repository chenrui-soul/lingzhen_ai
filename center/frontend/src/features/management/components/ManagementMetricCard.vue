<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{
  label: string;
  value: number;
  description: string;
  icon: Component;
  tone?: 'accent' | 'success' | 'warning' | 'neutral';
}>();
</script>

<template>
  <article class="metric-card" :class="`metric-card--${tone ?? 'neutral'}`">
    <div class="metric-card__topline">
      <span>{{ label }}</span>
      <component :is="icon" :size="20" weight="duotone" aria-hidden="true" />
    </div>
    <strong>{{ value.toLocaleString('zh-CN') }}</strong>
    <p>{{ description }}</p>
  </article>
</template>

<style scoped>
.metric-card {
  position: relative;
  min-width: 0;
  padding: 1.2rem 1.25rem;
  overflow: hidden;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
  box-shadow: var(--lz-shadow-control);
}

.metric-card::after {
  position: absolute;
  right: -2.5rem;
  bottom: -3rem;
  width: 7rem;
  height: 7rem;
  content: '';
  background: currentColor;
  border-radius: 50%;
  opacity: 0.035;
}

.metric-card--accent {
  color: var(--lz-color-accent);
}

.metric-card--success {
  color: var(--lz-color-success);
}

.metric-card--warning {
  color: var(--lz-color-warning);
}

.metric-card--neutral {
  color: var(--lz-color-muted);
}

.metric-card__topline {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.metric-card__topline span {
  color: var(--lz-color-muted);
  font-size: 0.76rem;
  font-weight: 620;
}

.metric-card strong {
  display: block;
  margin-top: 0.75rem;
  color: var(--lz-color-text);
  font-size: clamp(1.75rem, 3vw, 2.35rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
}

.metric-card p {
  margin: 0.65rem 0 0;
  color: var(--lz-color-subtle);
  font-size: 0.72rem;
}
</style>
