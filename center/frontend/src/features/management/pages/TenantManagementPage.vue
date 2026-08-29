<script setup lang="ts">
import {
  PhArrowClockwise,
  PhCalendarBlank,
  PhCheckCircle,
  PhIdentificationCard,
  PhPauseCircle,
  PhPulse,
  PhUsersThree,
} from '@phosphor-icons/vue';
import { computed } from 'vue';

import { toAppError } from '@/api/errors';
import AppState from '@/components/AppState.vue';
import ManagementMetricCard from '@/features/management/components/ManagementMetricCard.vue';
import { formatDateTime, statusLabel, statusTone } from '@/features/management/formatters';
import { useManagementTenantQuery } from '@/features/management/queries/management-queries';

const tenantQuery = useManagementTenantQuery();
const error = computed(() =>
  tenantQuery.error.value ? toAppError(tenantQuery.error.value) : null,
);
</script>

<template>
  <div class="tenant-page">
    <AppState
      v-if="tenantQuery.isPending.value"
      kind="loading"
      title="正在读取租户信息"
      description="正在确认当前会话所属的工作空间。"
    />
    <AppState
      v-else-if="error"
      :kind="error.status === 403 ? 'forbidden' : 'error'"
      :title="error.title"
      :description="error.message"
      action-label="重新加载"
      @action="tenantQuery.refetch()"
    />
    <template v-else-if="tenantQuery.data.value">
      <header class="tenant-hero">
        <div>
          <span>当前工作空间</span>
          <h1>{{ tenantQuery.data.value.name ?? '未命名租户' }}</h1>
          <p>此页面只展示当前登录会话所属租户，暂不开放管理写入操作。</p>
        </div>
        <div class="tenant-hero__actions">
          <span
            class="tenant-status"
            :class="`tenant-status--${statusTone(tenantQuery.data.value.status)}`"
          >
            <PhCheckCircle :size="15" weight="fill" />
            {{ statusLabel(tenantQuery.data.value.status) }}
          </span>
          <button type="button" aria-label="刷新租户信息" @click="tenantQuery.refetch()">
            <PhArrowClockwise :size="18" />
          </button>
        </div>
      </header>

      <section class="tenant-profile" aria-label="租户资料">
        <article>
          <span class="tenant-profile__icon"><PhIdentificationCard :size="21" /></span>
          <div>
            <small>租户编码</small>
            <strong>{{ tenantQuery.data.value.code ?? '未设置' }}</strong>
          </div>
        </article>
        <article>
          <span class="tenant-profile__icon"><PhCalendarBlank :size="21" /></span>
          <div>
            <small>创建时间</small>
            <strong>{{ formatDateTime(tenantQuery.data.value.createdAt) }}</strong>
          </div>
        </article>
        <article>
          <span class="tenant-profile__icon"><PhIdentificationCard :size="21" /></span>
          <div>
            <small>租户 ID</small>
            <strong class="tenant-id">{{ tenantQuery.data.value.id ?? '未知' }}</strong>
          </div>
        </article>
      </section>

      <section class="tenant-metrics" aria-label="租户指标">
        <ManagementMetricCard
          label="成员总数"
          :value="tenantQuery.data.value.metrics?.totalMembers ?? 0"
          description="当前租户有效成员"
          :icon="PhUsersThree"
          tone="accent"
        />
        <ManagementMetricCard
          label="活跃成员"
          :value="tenantQuery.data.value.metrics?.activeMembers ?? 0"
          description="可正常访问的成员"
          :icon="PhCheckCircle"
          tone="success"
        />
        <ManagementMetricCard
          label="暂停成员"
          :value="tenantQuery.data.value.metrics?.suspendedMembers ?? 0"
          description="已暂停访问的成员"
          :icon="PhPauseCircle"
          tone="warning"
        />
        <ManagementMetricCard
          label="活跃会话"
          :value="tenantQuery.data.value.metrics?.activeSessions ?? 0"
          description="尚未过期的会话"
          :icon="PhPulse"
          tone="neutral"
        />
      </section>

      <aside class="readonly-note">
        <PhCheckCircle :size="21" weight="duotone" />
        <div>
          <strong>只读安全模式</strong>
          <p>
            Wave 2 仅开放数据查询。新增成员、角色调整和租户状态变更将在写入权限审计完成后单独上线。
          </p>
        </div>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.tenant-page {
  width: min(100%, 92rem);
  margin: 0 auto;
}

.tenant-hero {
  display: flex;
  padding: 0.5rem 0 1.6rem;
  gap: 2rem;
  align-items: flex-start;
  justify-content: space-between;
}

.tenant-hero > div:first-child > span {
  color: var(--lz-color-accent);
  font-size: 0.7rem;
  font-weight: 680;
  letter-spacing: 0.08em;
}

.tenant-hero h1 {
  margin: 0.35rem 0 0;
  color: var(--lz-color-text);
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  letter-spacing: -0.04em;
}

.tenant-hero p {
  margin: 0.65rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.84rem;
}

.tenant-hero__actions {
  display: flex;
  gap: 0.55rem;
  align-items: center;
}

.tenant-hero__actions button {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  place-items: center;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: rgba(140, 177, 218, 0.07);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.7rem;
}

.tenant-status {
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

.tenant-status--success {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.08);
  border-color: rgba(114, 221, 194, 0.18);
}

.tenant-status--warning {
  color: var(--lz-color-warning);
}

.tenant-status--danger {
  color: var(--lz-color-danger);
}

.tenant-profile {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.tenant-profile article {
  display: flex;
  min-width: 0;
  padding: 1.15rem 1.2rem;
  gap: 0.8rem;
  align-items: center;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}

.tenant-profile__icon {
  display: grid;
  width: 2.6rem;
  height: 2.6rem;
  flex: 0 0 auto;
  place-items: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.08);
  border-radius: 0.8rem;
}

.tenant-profile article > div {
  display: grid;
  min-width: 0;
}

.tenant-profile small {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
}

.tenant-profile strong {
  margin-top: 0.18rem;
  overflow: hidden;
  color: var(--lz-color-text);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tenant-id {
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.7rem !important;
}

.tenant-metrics {
  display: grid;
  margin-top: 1rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}

.readonly-note {
  display: flex;
  margin-top: 1rem;
  padding: 1.1rem 1.2rem;
  gap: 0.8rem;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.045);
  border: 1px solid rgba(85, 216, 241, 0.13);
  border-radius: var(--lz-radius-card);
}

.readonly-note strong {
  color: var(--lz-color-text);
  font-size: 0.8rem;
}

.readonly-note p {
  margin: 0.25rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.74rem;
}

@media (max-width: 70rem) {
  .tenant-profile,
  .tenant-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 40rem) {
  .tenant-hero {
    display: grid;
    gap: 1rem;
  }

  .tenant-profile,
  .tenant-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
