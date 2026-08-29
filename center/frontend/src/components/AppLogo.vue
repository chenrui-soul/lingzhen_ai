<script setup lang="ts">
import { PhSparkle } from '@phosphor-icons/vue';

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);
</script>

<template>
  <div class="brand-lockup" :class="{ 'brand-lockup--compact': compact }" aria-label="灵帧">
    <span class="brand-lockup__mark" aria-hidden="true">
      <PhSparkle :size="compact ? 18 : 22" weight="duotone" />
    </span>
    <span v-if="!compact" class="brand-lockup__copy">
      <strong>灵帧</strong>
      <small>LINGZHEN CENTER</small>
    </span>
  </div>
</template>

<style scoped>
.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-lockup__mark {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  color: var(--lz-color-accent);
  background:
    linear-gradient(145deg, rgba(85, 216, 241, 0.16), rgba(85, 216, 241, 0.04)),
    var(--lz-color-surface);
  border: 1px solid rgba(85, 216, 241, 0.2);
  border-radius: 0.875rem;
  box-shadow: var(--lz-shadow-control);
}

.brand-lockup__copy {
  display: grid;
  gap: 0.1rem;
}

.brand-lockup__copy strong {
  color: var(--lz-color-text);
  font-size: 1.05rem;
  font-weight: 720;
  letter-spacing: 0.02em;
}

.brand-lockup__copy small {
  color: var(--lz-color-subtle);
  font-size: 0.625rem;
  font-weight: 650;
  letter-spacing: 0.14em;
}

.brand-lockup--compact .brand-lockup__mark {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.7rem;
}
</style>
