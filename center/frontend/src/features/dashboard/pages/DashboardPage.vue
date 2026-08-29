<script setup lang="ts">
import {
  PhArrowClockwise,
  PhCheckCircle,
  PhPauseCircle,
  PhPulse,
  PhUsersThree,
} from '@phosphor-icons/vue';
import { computed } from 'vue';

import { toAppError } from '@/api/errors';
import AppState from '@/components/AppState.vue';
import ManagementMetricCard from '@/features/management/components/ManagementMetricCard.vue';
import { formatDateTime, statusLabel, statusTone } from '@/features/management/formatters';
import { useManagementDashboardQuery } from '@/features/management/queries/management-queries';

const dashboardQuery = useManagementDashboardQuery();
const error = computed(() =>
  dashboardQuery.error.value ? toAppError(dashboardQuery.error.value) : null,
);
const largestRoleCount = computed(() =>
  Math.max(1, ...(dashboardQuery.data.value?.roles ?? []).map((role) => role.members ?? 0)),
);

function roleWidth(members?: number): string {
  return `${Math.max(8, ((members ?? 0) / largestRoleCount.value) * 100)}%`;
}
</script>

<template>
  <div class="dashboard-page">
    <AppState
      v-if="dashboardQuery.isPending.value"
      kind="loading"
      title="正在读取工作空间数据"
      description="成员、角色和会话数据正在从服务端汇总。"
    />
    <AppState
      v-else-if="error"
      :kind="error.status === 403 ? 'forbidden' : 'error'"
      :title="error.title"
      :description="error.message"
      action-label="重新加载"
      @action="dashboardQuery.refetch()"
    />
    <template v-else-if="dashboardQuery.data.value">
      <header class="dashboard-hero">
        <div>
          <span class="dashboard-eyebrow">实时工作空间总览</span>
          <h1>{{ dashboardQuery.data.value.tenant?.name ?? '当前工作空间' }}</h1>
          <p>
            数据仅统计当前租户，更新时间：{{
              formatDateTime(dashboardQuery.data.value.generatedAt)
            }}
          </p>
        </div>
        <span
          class="status-pill"
          :class="`status-pill--${statusTone(dashboardQuery.data.value.tenant?.status)}`"
        >
          <PhCheckCircle :size="15" weight="fill" />
          {{ statusLabel(dashboardQuery.data.value.tenant?.status) }}
        </span>
      </header>

      <section class="metric-grid" aria-label="租户关键指标">
        <ManagementMetricCard
          label="成员总数"
          :value="dashboardQuery.data.value.metrics?.totalMembers ?? 0"
          description="不包含已移除成员"
          :icon="PhUsersThree"
          tone="accent"
        />
        <ManagementMetricCard
          label="活跃成员"
          :value="dashboardQuery.data.value.metrics?.activeMembers ?? 0"
          description="当前可正常使用的成员"
          :icon="PhCheckCircle"
          tone="success"
        />
        <ManagementMetricCard
          label="暂停成员"
          :value="dashboardQuery.data.value.metrics?.suspendedMembers ?? 0"
          description="当前已暂停访问的成员"
          :icon="PhPauseCircle"
          tone="warning"
        />
        <ManagementMetricCard
          label="活跃会话"
          :value="dashboardQuery.data.value.metrics?.activeSessions ?? 0"
          description="尚未过期的在线会话"
          :icon="PhPulse"
          tone="neutral"
        />
      </section>

      <section class="dashboard-panel">
        <header class="dashboard-panel__header">
          <div>
            <span>角色结构</span>
            <h2>当前租户成员分布</h2>
          </div>
          <button type="button" aria-label="刷新总览" @click="dashboardQuery.refetch()">
            <PhArrowClockwise :size="18" />
          </button>
        </header>

        <div v-if="dashboardQuery.data.value.roles?.length" class="role-list">
          <article v-for="role in dashboardQuery.data.value.roles" :key="role.code">
            <div class="role-list__label">
              <span>{{ role.name ?? role.code }}</span>
              <strong>{{ role.members ?? 0 }} 人</strong>
            </div>
            <div class="role-list__track" aria-hidden="true">
              <span :style="{ width: roleWidth(role.members) }" />
            </div>
          </article>
        </div>
        <AppState
          v-else
          kind="empty"
          title="暂无角色数据"
          description="当前租户还没有可统计的有效成员。"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.dashboard-page {
  width: min(100%, 92rem);
  margin: 0 auto;
}

.dashboard-hero {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0.5rem 0 1.6rem;
}

.dashboard-eyebrow {
  color: var(--lz-color-accent);
  font-size: 0.72rem;
  font-weight: 680;
  letter-spacing: 0.08em;
}

.dashboard-hero h1 {
  margin: 0.45rem 0 0;
  color: var(--lz-color-text);
  font-size: clamp(1.75rem, 3vw, 2.65rem);
  font-weight: 680;
  letter-spacing: -0.04em;
  line-height: 1.2;
}

.dashboard-hero p {
  max-width: 42rem;
  margin: 0.8rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.9rem;
}

.status-pill {
  display: inline-flex;
  padding: 0.42rem 0.72rem;
  gap: 0.35rem;
  align-items: center;
  color: var(--lz-color-muted);
  font-size: 0.72rem;
  font-weight: 650;
  background: rgba(140, 177, 218, 0.08);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-pill);
}

.status-pill--success {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.08);
  border-color: rgba(114, 221, 194, 0.18);
}

.status-pill--warning {
  color: var(--lz-color-warning);
}

.status-pill--danger {
  color: var(--lz-color-danger);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}

.dashboard-panel {
  margin-top: 1rem;
  padding: clamp(1.25rem, 2.5vw, 2rem);
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
  box-shadow: var(--lz-shadow-control);
}

.dashboard-panel__header {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.dashboard-panel__header span {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dashboard-panel__header h2 {
  margin: 0.25rem 0 0;
  color: var(--lz-color-text);
  font-size: 1.08rem;
}

.dashboard-panel__header button {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  place-items: center;
  color: var(--lz-color-muted);
  background: rgba(140, 177, 218, 0.07);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.7rem;
  cursor: pointer;
}

.role-list {
  display: grid;
  margin-top: 1.5rem;
  gap: 1.15rem;
}

.role-list__label {
  display: flex;
  margin-bottom: 0.45rem;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  color: var(--lz-color-muted);
  font-size: 0.76rem;
}

.role-list__label strong {
  color: var(--lz-color-text);
  font-size: 0.74rem;
}

.role-list__track {
  height: 0.42rem;
  overflow: hidden;
  background: rgba(140, 177, 218, 0.08);
  border-radius: var(--lz-radius-pill);
}

.role-list__track span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--lz-color-accent-strong), var(--lz-color-accent));
  border-radius: inherit;
}

@media (max-width: 70rem) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 40rem) {
  .dashboard-hero,
  .dashboard-panel__header {
    align-items: flex-start;
    gap: 1rem;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-hero {
    display: grid;
  }
}
</style>
