<script setup lang="ts">
import { PhCircleNotch, PhCloudWarning, PhShieldWarning, PhTray } from '@phosphor-icons/vue';
import { computed } from 'vue';

type StateKind = 'loading' | 'empty' | 'error' | 'forbidden';

const props = withDefaults(
  defineProps<{
    kind: StateKind;
    title: string;
    description: string;
    actionLabel?: string;
  }>(),
  {
    actionLabel: '',
  },
);

const emit = defineEmits<{
  action: [];
}>();

const iconComponent = computed(() => {
  const icons = {
    loading: PhCircleNotch,
    empty: PhTray,
    error: PhCloudWarning,
    forbidden: PhShieldWarning,
  };
  return icons[props.kind];
});
</script>

<template>
  <section
    class="app-state"
    :role="kind === 'loading' ? 'status' : 'region'"
    :aria-busy="kind === 'loading'"
    aria-live="polite"
  >
    <component
      :is="iconComponent"
      class="app-state__icon"
      :class="{ 'app-state__icon--spin': kind === 'loading' }"
      :size="30"
      weight="duotone"
      aria-hidden="true"
    />
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
    <a-button v-if="actionLabel" type="primary" @click="emit('action')">
      {{ actionLabel }}
    </a-button>
  </section>
</template>

<style scoped>
.app-state {
  display: grid;
  max-width: 30rem;
  min-height: 18rem;
  margin: 0 auto;
  padding: 3rem 2rem;
  place-items: center;
  align-content: center;
  text-align: center;
}

.app-state__icon {
  margin-bottom: 1rem;
  color: var(--lz-color-accent);
}

.app-state h1 {
  margin: 0;
  color: var(--lz-color-text);
  font-size: 1.35rem;
  font-weight: 680;
}

.app-state p {
  max-width: 26rem;
  margin: 0.55rem 0 1.5rem;
  color: var(--lz-color-muted);
  line-height: 1.75;
}

.app-state__icon--spin {
  animation: state-spin 0.9s infinite cubic-bezier(0.65, 0, 0.35, 1);
}

@keyframes state-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
