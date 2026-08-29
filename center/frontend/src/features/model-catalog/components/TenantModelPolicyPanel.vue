<script setup lang="ts">
import { PhArrowClockwise, PhCheckCircle, PhMagnifyingGlass, PhSliders } from '@phosphor-icons/vue';
import { computed, nextTick, ref } from 'vue';

import { toAppError } from '@/api/errors';
import AppState from '@/components/AppState.vue';
import { useAuthStore } from '@/features/auth/stores/auth-store';
import {
  capabilityLabel,
  formatCatalogDate,
  policyLabel,
} from '@/features/model-catalog/formatters';
import {
  useTenantModelsQuery,
  useUpdateTenantModelPolicyMutation,
} from '@/features/model-catalog/queries/model-catalog-queries';
import type { TenantModel, TenantModelPolicy } from '@/features/model-catalog/types';

const authStore = useAuthStore();
const emit = defineEmits<{
  goToPlatform: [];
}>();
const keyword = ref('');
const effectiveState = ref('all');
const tenantModelsQuery = useTenantModelsQuery();
const updatePolicyMutation = useUpdateTenantModelPolicyMutation();
const savingModelId = ref<string | null>(null);
const feedback = ref<{
  modelId: string;
  kind: 'success' | 'error';
  message: string;
} | null>(null);
const canManage = computed(() =>
  Boolean(authStore.currentUser?.permissions?.includes('tenant_model.manage')),
);
const canReadPlatform = computed(() =>
  Boolean(authStore.currentUser?.permissions?.includes('model_catalog.read')),
);
const emptyStateActionLabel = computed(() => (canReadPlatform.value ? '前往平台目录' : ''));
const emptyStateDescription = computed(() =>
  canReadPlatform.value
    ? '请先在平台目录创建并启用模型，再通过“发布目录”生成正式版本；发布后这里会自动显示租户策略。'
    : '当前账号没有平台目录读取或发布权限，无法创建和发布模型目录，请联系管理员开通相应权限。',
);
const error = computed(() =>
  tenantModelsQuery.error.value ? toAppError(tenantModelsQuery.error.value) : null,
);
const filteredModels = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase();
  return (tenantModelsQuery.data.value?.models ?? []).filter((model) => {
    const matchesKeyword =
      !normalizedKeyword ||
      model.displayName.toLowerCase().includes(normalizedKeyword) ||
      model.code.toLowerCase().includes(normalizedKeyword) ||
      model.provider.displayName.toLowerCase().includes(normalizedKeyword);
    const matchesState =
      effectiveState.value === 'all' ||
      model.effectiveEnabled === (effectiveState.value === 'enabled');
    return matchesKeyword && matchesState;
  });
});
const enabledCount = computed(
  () => tenantModelsQuery.data.value?.models.filter((model) => model.effectiveEnabled).length ?? 0,
);
const stateOptions = [
  { value: 'all', label: '全部最终状态' },
  { value: 'enabled', label: '最终启用' },
  { value: 'disabled', label: '最终不可用' },
];
const policyOptions: Array<{ value: TenantModelPolicy; label: string }> = [
  { value: 'inherit', label: '继承平台' },
  { value: 'enabled', label: '租户启用' },
  { value: 'hidden', label: '租户隐藏' },
];

function handleEmptyStateAction(): void {
  if (canReadPlatform.value) {
    emit('goToPlatform');
    return;
  }
  tenantModelsQuery.refetch();
}

function resetFilters(): void {
  keyword.value = '';
  effectiveState.value = 'all';
}

async function restorePolicyFocus(modelId: string, policy: TenantModelPolicy): Promise<void> {
  await nextTick();
  const target = Array.from(
    globalThis.document.querySelectorAll<HTMLButtonElement>('.policy-option'),
  ).find(
    (button) => button.dataset.policyModelId === modelId && button.dataset.policyValue === policy,
  );
  target?.focus();
}

async function updatePolicy(model: TenantModel, policy: TenantModelPolicy): Promise<void> {
  if (!canManage.value || savingModelId.value || model.policy === policy) return;
  savingModelId.value = model.modelId;
  feedback.value = null;
  try {
    await updatePolicyMutation.mutateAsync({
      modelId: model.modelId,
      request: {
        policy,
        rowVersion: model.rowVersion,
      },
    });
    feedback.value = {
      modelId: model.modelId,
      kind: 'success',
      message: '策略已保存，最终状态已更新。',
    };
  } catch (cause) {
    const appError = toAppError(cause);
    if (appError.status === 409) {
      await tenantModelsQuery.refetch();
      feedback.value = {
        modelId: model.modelId,
        kind: 'error',
        message: '策略已被其他管理员更新，已刷新最新状态，请重新选择。',
      };
    } else {
      feedback.value = {
        modelId: model.modelId,
        kind: 'error',
        message: appError.message,
      };
    }
  } finally {
    savingModelId.value = null;
    await restorePolicyFocus(model.modelId, policy);
  }
}
</script>

<template>
  <div class="tenant-policy-panel">
    <AppState
      v-if="tenantModelsQuery.isPending.value"
      kind="loading"
      title="正在读取租户模型策略"
      description="正在根据当前登录会话计算模型的最终可用状态。"
    />
    <AppState
      v-else-if="error"
      :kind="error.status === 403 ? 'forbidden' : 'error'"
      :title="error.title"
      :description="error.message"
      action-label="重新加载"
      @action="tenantModelsQuery.refetch()"
    />
    <AppState
      v-else-if="!tenantModelsQuery.data.value?.available"
      kind="empty"
      title="当前还没有发布目录"
      :description="emptyStateDescription"
      :action-label="emptyStateActionLabel"
      @action="handleEmptyStateAction"
    />
    <template v-else>
      <section class="policy-summary" aria-label="当前租户策略概况">
        <div class="policy-summary__identity">
          <span><PhSliders :size="21" /></span>
          <div>
            <small>当前目录版本</small>
            <strong>v{{ tenantModelsQuery.data.value.catalogVersion ?? '-' }}</strong>
          </div>
        </div>
        <div>
          <small>目录模型</small><strong>{{ tenantModelsQuery.data.value.models.length }}</strong>
        </div>
        <div>
          <small>最终启用</small><strong class="success-value">{{ enabledCount }}</strong>
        </div>
        <div>
          <small>发布时间</small
          ><strong>{{ formatCatalogDate(tenantModelsQuery.data.value.publishedAt) }}</strong>
        </div>
        <button
          type="button"
          aria-label="刷新当前租户模型策略"
          @click="tenantModelsQuery.refetch()"
        >
          <PhArrowClockwise :size="18" />
        </button>
      </section>

      <aside class="policy-explanation">
        <PhCheckCircle :size="19" weight="duotone" />
        <p>
          <strong>最终状态</strong>由平台默认设置与当前租户策略共同计算。{{
            canManage ? '策略保存后会立即影响桌面端模型目录。' : '当前账号仅可核对配置。'
          }}
        </p>
      </aside>

      <section class="policy-filter" aria-label="租户模型筛选">
        <label>
          <PhMagnifyingGlass :size="18" aria-hidden="true" />
          <span class="sr-only">搜索模型或厂商</span>
          <input v-model="keyword" type="search" maxlength="100" placeholder="搜索模型或厂商" />
        </label>
        <a-select v-model:value="effectiveState" :options="stateOptions" aria-label="最终状态" />
        <a-button v-if="keyword || effectiveState !== 'all'" type="text" @click="resetFilters"
          >重置</a-button
        >
        <span>{{ filteredModels.length }} 个结果</span>
      </section>

      <section class="policy-results" :aria-busy="tenantModelsQuery.isFetching.value">
        <AppState
          v-if="!filteredModels.length"
          kind="empty"
          title="没有匹配的租户模型"
          description="可以调整搜索内容或最终状态筛选。"
          action-label="清除筛选"
          @action="resetFilters"
        />
        <div v-else class="policy-table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>厂商</th>
                <th>能力</th>
                <th>平台默认</th>
                <th>{{ canManage ? '租户策略' : '当前策略' }}</th>
                <th>最终状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="model in filteredModels" :key="model.modelId">
                <td data-label="模型">
                  <div class="model-name">
                    <strong>{{ model.displayName }}</strong
                    ><small>{{ model.code }}</small>
                  </div>
                </td>
                <td data-label="厂商">{{ model.provider.displayName }}</td>
                <td data-label="能力">
                  <span class="capability-badge">{{ capabilityLabel(model.capabilityType) }}</span>
                </td>
                <td data-label="平台默认">
                  <span
                    :class="['switch-state', model.defaultTenantEnabled ? 'switch-state--on' : '']"
                    >{{ model.defaultTenantEnabled ? '启用' : '关闭' }}</span
                  >
                </td>
                <td data-label="当前策略">
                  <div
                    v-if="canManage"
                    class="policy-editor"
                    role="group"
                    :aria-label="model.displayName + ' 租户策略'"
                  >
                    <div class="policy-segmented">
                      <button
                        v-for="option in policyOptions"
                        :key="option.value"
                        type="button"
                        :class="[
                          'policy-option',
                          'policy-option--' + option.value,
                          model.policy === option.value ? 'policy-option--active' : '',
                        ]"
                        :aria-pressed="model.policy === option.value"
                        :disabled="Boolean(savingModelId)"
                        :data-policy-model-id="model.modelId"
                        :data-policy-value="option.value"
                        @click="updatePolicy(model, option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                    <small
                      v-if="savingModelId === model.modelId"
                      class="policy-feedback policy-feedback--saving"
                      role="status"
                      >正在保存...</small
                    >
                    <small
                      v-else-if="feedback?.modelId === model.modelId"
                      :class="['policy-feedback', 'policy-feedback--' + feedback.kind]"
                      :role="feedback.kind === 'error' ? 'alert' : 'status'"
                      >{{ feedback.message }}</small
                    >
                  </div>
                  <span v-else :class="['policy-badge', 'policy-badge--' + model.policy]">{{
                    policyLabel(model.policy)
                  }}</span>
                </td>
                <td data-label="最终状态">
                  <strong
                    :class="[
                      'effective-state',
                      model.effectiveEnabled ? 'effective-state--on' : '',
                    ]"
                    >{{ model.effectiveEnabled ? '可使用' : '不可使用' }}</strong
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tenant-policy-panel {
  display: grid;
  gap: 1rem;
}
.policy-summary {
  display: grid;
  padding: 0.9rem 1rem;
  grid-template-columns: 1.3fr repeat(3, minmax(8rem, 1fr)) auto;
  gap: 1rem;
  align-items: center;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: 1rem;
}
.policy-summary > div {
  display: grid;
  min-width: 0;
  padding-left: 1rem;
  border-left: 1px solid rgba(140, 177, 218, 0.1);
}
.policy-summary__identity {
  display: flex !important;
  padding-left: 0 !important;
  gap: 0.7rem;
  align-items: center;
  border-left: 0 !important;
}
.policy-summary__identity > span {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  place-items: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.08);
  border-radius: 0.75rem;
}
.policy-summary small {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
}
.policy-summary strong {
  margin-top: 0.1rem;
  overflow: hidden;
  color: var(--lz-color-text);
  font-size: 0.9rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.policy-summary .success-value {
  color: var(--lz-color-success);
}
.policy-summary button {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: rgba(140, 177, 218, 0.06);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.72rem;
}
.policy-explanation {
  display: flex;
  padding: 0.75rem 1rem;
  gap: 0.65rem;
  align-items: flex-start;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.045);
  border: 1px solid rgba(85, 216, 241, 0.13);
  border-radius: 0.9rem;
}
.policy-explanation p {
  margin: 0;
  color: var(--lz-color-muted);
  font-size: 0.73rem;
}
.policy-explanation strong {
  color: var(--lz-color-text);
}
.policy-filter {
  display: flex;
  padding: 0.75rem;
  gap: 0.65rem;
  align-items: center;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: 1rem;
}
.policy-filter label {
  display: flex;
  width: min(27rem, 100%);
  height: 2.75rem;
  padding: 0 0.85rem;
  gap: 0.6rem;
  align-items: center;
  color: var(--lz-color-subtle);
  background: var(--lz-color-field);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-control);
}
.policy-filter label:focus-within {
  border-color: var(--lz-color-line-strong);
}
.policy-filter input {
  min-width: 0;
  flex: 1;
  color: var(--lz-color-text);
  outline: 0;
  background: transparent;
  border: 0;
}
.policy-filter :deep(.ant-select) {
  width: 10.5rem;
}
.policy-filter > span {
  margin-left: auto;
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
  white-space: nowrap;
}
.policy-results {
  min-height: 23rem;
  overflow: hidden;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}
.policy-table-wrap {
  overflow-x: auto;
  scrollbar-width: thin;
}
table {
  width: 100%;
  min-width: 57rem;
  border-collapse: collapse;
}
th,
td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid rgba(140, 177, 218, 0.1);
}
th {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
  font-weight: 680;
  letter-spacing: 0.04em;
  background: rgba(140, 177, 218, 0.025);
}
td {
  color: var(--lz-color-muted);
  font-size: 0.75rem;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover td {
  background: rgba(85, 216, 241, 0.025);
}
.model-name {
  display: grid;
  min-width: 12rem;
}
.model-name strong {
  color: var(--lz-color-text);
  font-size: 0.79rem;
}
.model-name small {
  color: var(--lz-color-accent);
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.66rem;
}
.capability-badge,
.switch-state,
.policy-badge {
  display: inline-flex;
  padding: 0.25rem 0.52rem;
  align-items: center;
  white-space: nowrap;
  border-radius: var(--lz-radius-pill);
}
.capability-badge {
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.075);
}
.switch-state,
.policy-badge {
  color: var(--lz-color-muted);
  background: rgba(140, 177, 218, 0.07);
}
.switch-state::before {
  width: 0.35rem;
  height: 0.35rem;
  margin-right: 0.35rem;
  content: '';
  background: var(--lz-color-subtle);
  border-radius: 50%;
}
.switch-state--on {
  color: var(--lz-color-success);
}
.switch-state--on::before {
  background: var(--lz-color-success);
}
.policy-badge--enabled {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.08);
}
.policy-badge--hidden {
  color: var(--lz-color-warning);
  background: rgba(255, 189, 118, 0.08);
}
.policy-editor {
  display: grid;
  min-width: 15.75rem;
  gap: 0.4rem;
}
.policy-segmented {
  display: inline-grid;
  width: max-content;
  padding: 0.2rem;
  grid-template-columns: repeat(3, minmax(4.9rem, auto));
  background: rgba(140, 177, 218, 0.055);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.72rem;
}
.policy-option {
  min-height: 2.2rem;
  padding: 0.4rem 0.66rem;
  color: var(--lz-color-muted);
  font-size: 0.7rem;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 0.55rem;
  transition:
    color 180ms var(--lz-motion-standard),
    background-color 180ms var(--lz-motion-standard),
    transform 180ms var(--lz-motion-standard);
}
.policy-option:hover:not(:disabled) {
  color: var(--lz-color-text);
  background: rgba(140, 177, 218, 0.08);
}
.policy-option:active:not(:disabled) {
  transform: translateY(1px);
}
.policy-option:focus-visible {
  outline: 2px solid var(--lz-color-accent);
  outline-offset: 1px;
}
.policy-option:disabled {
  cursor: wait;
  opacity: 0.62;
}
.policy-option--active {
  color: var(--lz-color-text);
  background: rgba(85, 216, 241, 0.13);
  box-shadow: inset 0 0 0 1px rgba(85, 216, 241, 0.12);
}
.policy-option--enabled.policy-option--active {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.1);
  box-shadow: inset 0 0 0 1px rgba(114, 221, 194, 0.14);
}
.policy-option--hidden.policy-option--active {
  color: var(--lz-color-warning);
  background: rgba(255, 189, 118, 0.09);
  box-shadow: inset 0 0 0 1px rgba(255, 189, 118, 0.14);
}
.policy-feedback {
  max-width: 20rem;
  color: var(--lz-color-subtle);
  font-size: 0.66rem;
  line-height: 1.45;
}
.policy-feedback--saving {
  color: var(--lz-color-accent);
}
.policy-feedback--success {
  color: var(--lz-color-success);
}
.policy-feedback--error {
  color: var(--lz-color-danger);
}
.effective-state {
  color: var(--lz-color-danger);
  font-size: 0.73rem;
}
.effective-state--on {
  color: var(--lz-color-success);
}
@media (max-width: 68rem) {
  .policy-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .policy-summary > div {
    padding-left: 0;
    border-left: 0;
  }
  .policy-summary button {
    position: absolute;
    right: 2rem;
  }
}
@media (max-width: 48rem) {
  .policy-filter {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .policy-filter label {
    grid-column: 1 / -1;
    width: 100%;
  }
  .policy-filter > span {
    justify-self: end;
  }
}
@media (max-width: 48rem) {
  .policy-summary {
    position: relative;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .policy-summary button {
    top: 0.9rem;
    right: 0.9rem;
  }
  .policy-summary__identity {
    grid-column: 1 / -1;
    padding-right: 3rem !important;
  }
  .policy-table-wrap {
    overflow: visible;
  }
  table,
  tbody {
    display: block;
    min-width: 0;
  }
  thead {
    display: none;
  }
  tr {
    display: grid;
    padding: 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem 1rem;
    border-bottom: 1px solid rgba(140, 177, 218, 0.1);
  }
  td {
    display: grid;
    padding: 0;
    gap: 0.15rem;
    border: 0;
  }
  td::before {
    color: var(--lz-color-subtle);
    font-size: 0.62rem;
    content: attr(data-label);
  }
  td:first-child {
    grid-column: 1 / -1;
  }
  td[data-label='当前策略'] {
    grid-column: 1 / -1;
  }
  .model-name {
    min-width: 0;
  }
  .policy-editor,
  .policy-segmented {
    width: 100%;
    min-width: 0;
  }
  .policy-segmented {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .policy-option {
    min-height: 2.75rem;
    padding-inline: 0.4rem;
  }
}
</style>
