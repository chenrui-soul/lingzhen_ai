<script setup lang="ts">
import {
  PhArrowClockwise,
  PhBuildings,
  PhCheckCircle,
  PhCube,
  PhMagnifyingGlass,
  PhPencilSimple,
  PhPlus,
  PhPower,
  PhStack,
} from '@phosphor-icons/vue';
import Modal from 'ant-design-vue/es/modal';
import message from 'ant-design-vue/es/message';
import { computed, ref } from 'vue';

import { toAppError } from '@/api/errors';
import AppState from '@/components/AppState.vue';
import { useAuthStore } from '@/features/auth/stores/auth-store';
import ModelCatalogEditorDrawer from '@/features/model-catalog/components/ModelCatalogEditorDrawer.vue';
import ProviderManagerDrawer from '@/features/model-catalog/components/ProviderManagerDrawer.vue';
import {
  capabilityLabel,
  formatCatalogDate,
  statusLabel,
  statusTone,
} from '@/features/model-catalog/formatters';
import {
  useCatalogModelsQuery,
  useCatalogVersionsQuery,
  useModelProvidersQuery,
  useUpdateCatalogModelMutation,
} from '@/features/model-catalog/queries/model-catalog-queries';
import type { CatalogModel } from '@/features/model-catalog/types';

const PAGE_SIZE = 20;
const authStore = useAuthStore();
const page = ref(1);
const keywordDraft = ref('');
const keyword = ref('');
const status = ref('all');
const capabilityType = ref('all');
const providerId = ref('');

const filters = computed(() => ({
  page: page.value,
  pageSize: PAGE_SIZE,
  keyword: keyword.value || undefined,
  status: status.value,
  capabilityType: capabilityType.value,
  providerId: providerId.value,
}));
const modelsQuery = useCatalogModelsQuery(filters);
const providersQuery = useModelProvidersQuery();
const versionsQuery = useCatalogVersionsQuery();
const updateModelMutation = useUpdateCatalogModelMutation();
const activeDrawer = ref<'providers' | 'model' | null>(null);
const selectedModelId = ref('');
const lastTrigger = ref<HTMLElement | null>(null);
const statusConfirmVisible = ref(false);
const canManage = computed(() =>
  Boolean(authStore.currentUser?.permissions?.includes('model_catalog.manage')),
);
const editingModel = computed(
  () => modelsQuery.data.value?.items.find((model) => model.id === selectedModelId.value) ?? null,
);

const error = computed(() => {
  const source = modelsQuery.error.value ?? providersQuery.error.value ?? versionsQuery.error.value;
  return source ? toAppError(source) : null;
});
const currentVersion = computed(
  () =>
    versionsQuery.data.value?.items.find((version) => version.current) ??
    versionsQuery.data.value?.items[0],
);
const providerOptions = computed(() => [
  { value: '', label: '全部厂商' },
  ...(providersQuery.data.value?.items ?? []).map((provider) => ({
    value: provider.id,
    label: provider.displayName,
  })),
]);
const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '可用' },
  { value: 'inactive', label: '停用' },
  { value: 'deprecated', label: '已弃用' },
  { value: 'draft', label: '草稿' },
];
const capabilityOptions = [
  { value: 'all', label: '全部能力' },
  { value: 'text', label: '文本生成' },
  { value: 'image', label: '图像生成' },
  { value: 'video', label: '视频生成' },
  { value: 'audio', label: '音频生成' },
  { value: 'embedding', label: '向量嵌入' },
  { value: 'multimodal', label: '多模态' },
];
const hasFilters = computed(
  () =>
    Boolean(keyword.value) ||
    status.value !== 'all' ||
    capabilityType.value !== 'all' ||
    Boolean(providerId.value),
);

function submitSearch(): void {
  keyword.value = keywordDraft.value.trim();
  page.value = 1;
}

function resetFilters(): void {
  keywordDraft.value = '';
  keyword.value = '';
  status.value = 'all';
  capabilityType.value = 'all';
  providerId.value = '';
  page.value = 1;
}

async function refreshAll(): Promise<void> {
  await Promise.all([modelsQuery.refetch(), providersQuery.refetch(), versionsQuery.refetch()]);
}

function rememberTrigger(event?: Event): void {
  lastTrigger.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

function openProviders(event: Event): void {
  if (!canManage.value || activeDrawer.value || statusConfirmVisible.value) return;
  rememberTrigger(event);
  activeDrawer.value = 'providers';
}

function openCreateModel(event: Event): void {
  if (!canManage.value || activeDrawer.value || statusConfirmVisible.value) return;
  rememberTrigger(event);
  selectedModelId.value = '';
  activeDrawer.value = 'model';
}

function openEditModel(model: CatalogModel, event: Event): void {
  if (!canManage.value || activeDrawer.value || statusConfirmVisible.value) return;
  rememberTrigger(event);
  selectedModelId.value = model.id;
  activeDrawer.value = 'model';
}

function closeDrawer(): void {
  activeDrawer.value = null;
}

function restoreTriggerFocus(): void {
  lastTrigger.value?.focus();
  lastTrigger.value = null;
}

async function handleModelConflict(modelId: string): Promise<void> {
  await modelsQuery.refetch();
  selectedModelId.value = modelId;
}

async function handleProviderConflict(): Promise<void> {
  await providersQuery.refetch();
}

async function toggleModelStatus(model: CatalogModel, event: Event): Promise<void> {
  if (!canManage.value || activeDrawer.value || statusConfirmVisible.value) return;
  rememberTrigger(event);
  statusConfirmVisible.value = true;
  const targetStatus = model.status === 'active' ? 'inactive' : 'active';
  Modal.confirm({
    title: targetStatus === 'active' ? '启用这个模型？' : '停用这个模型？',
    content:
      targetStatus === 'active'
        ? `启用后，${model.displayName} 会立即同步到桌面端。`
        : `停用后，${model.displayName} 会立即从桌面端可用模型中移除。`,
    okText: targetStatus === 'active' ? '确认启用' : '确认停用',
    cancelText: '取消',
    centered: true,
    async onOk() {
      try {
        await updateModelMutation.mutateAsync({
          modelId: model.id,
          request: {
            providerId: model.provider.id,
            code: model.code,
            displayName: model.displayName,
            capabilityType: model.capabilityType,
            description: model.description,
            parameterSchema: model.parameterSchema,
            defaultParameters: model.defaultParameters,
            defaultTenantEnabled: model.defaultTenantEnabled,
            sortOrder: model.sortOrder,
            status: targetStatus,
            rowVersion: model.rowVersion,
          },
        });
        message.success(targetStatus === 'active' ? '模型已启用' : '模型已停用');
        await refreshAll();
      } catch (error) {
        const appError = toAppError(error);
        if (appError.code === 'MODEL_ROW_VERSION_CONFLICT') {
          await modelsQuery.refetch();
          message.warning('模型已被其他管理员修改，列表已刷新，请重新操作。');
          return;
        }
        message.error(`${appError.title}：${appError.message}`);
        throw error;
      }
    },
    afterClose() {
      statusConfirmVisible.value = false;
      restoreTriggerFocus();
    },
  });
}
</script>

<template>
  <div class="catalog-panel">
    <section class="catalog-overview" aria-label="平台目录概况">
      <article>
        <span><PhStack :size="20" /></span>
        <div>
          <small>当前发布版本</small><strong>v{{ currentVersion?.version ?? '—' }}</strong>
        </div>
      </article>
      <article>
        <span><PhCube :size="20" /></span>
        <div>
          <small>目录模型</small
          ><strong>{{ currentVersion?.modelCount ?? modelsQuery.data.value?.total ?? 0 }}</strong>
        </div>
      </article>
      <article>
        <span><PhCheckCircle :size="20" /></span>
        <div>
          <small>模型厂商</small><strong>{{ providersQuery.data.value?.total ?? 0 }}</strong>
        </div>
      </article>
      <article class="catalog-overview__published">
        <div>
          <small>最近发布时间</small
          ><strong>{{ formatCatalogDate(currentVersion?.publishedAt) }}</strong>
        </div>
        <button type="button" aria-label="刷新平台模型目录" @click="refreshAll">
          <PhArrowClockwise :size="18" />
        </button>
      </article>
    </section>

    <section v-if="canManage" class="catalog-actions" aria-label="模型目录维护操作">
      <div>
        <strong>目录维护</strong>
        <span>模型保存后自动同步到桌面端，版本记录由系统后台保留。</span>
      </div>
      <div>
        <a-button v-if="canManage" @click="openProviders"
          ><PhBuildings :size="17" />厂商管理</a-button
        >
        <a-button v-if="canManage" @click="openCreateModel"><PhPlus :size="17" />新增模型</a-button>
      </div>
    </section>

    <section class="catalog-filters" aria-label="模型筛选">
      <label class="catalog-search">
        <span class="sr-only">搜索模型名称或编码</span>
        <PhMagnifyingGlass :size="18" aria-hidden="true" />
        <input
          v-model="keywordDraft"
          type="search"
          maxlength="100"
          placeholder="搜索模型名称或编码"
          @keyup.enter="submitSearch"
        />
      </label>
      <a-button type="primary" @click="submitSearch">查询</a-button>
      <a-select
        v-model:value="status"
        :options="statusOptions"
        aria-label="模型状态"
        @change="page = 1"
      />
      <a-select
        v-model:value="capabilityType"
        :options="capabilityOptions"
        aria-label="能力类型"
        @change="page = 1"
      />
      <a-select
        v-model:value="providerId"
        :options="providerOptions"
        :loading="providersQuery.isPending.value"
        aria-label="模型厂商"
        @change="page = 1"
      />
      <a-button v-if="hasFilters" type="text" @click="resetFilters">重置</a-button>
    </section>

    <section class="catalog-results" :aria-busy="modelsQuery.isFetching.value">
      <AppState
        v-if="
          modelsQuery.isPending.value ||
          providersQuery.isPending.value ||
          versionsQuery.isPending.value
        "
        kind="loading"
        title="正在读取平台目录"
        description="正在加载已发布的模型、厂商和版本信息。"
      />
      <AppState
        v-else-if="error"
        :kind="error.status === 403 ? 'forbidden' : 'error'"
        :title="error.title"
        :description="error.message"
        action-label="重新加载"
        @action="refreshAll"
      />
      <AppState
        v-else-if="!modelsQuery.data.value?.items.length"
        kind="empty"
        title="没有匹配的模型"
        description="当前筛选条件下没有可展示的模型，可以调整筛选后重试。"
        :action-label="hasFilters ? '清除筛选' : ''"
        @action="resetFilters"
      />
      <template v-else>
        <div v-if="modelsQuery.isFetching.value" class="catalog-progress" role="status">
          正在更新目录…
        </div>
        <div class="catalog-table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>厂商</th>
                <th>能力</th>
                <th>租户默认</th>
                <th>状态</th>
                <th>更新时间</th>
                <th v-if="canManage" class="action-column">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="model in modelsQuery.data.value.items" :key="model.id">
                <td data-label="模型">
                  <div class="model-identity">
                    <strong>{{ model.displayName }}</strong>
                    <small>{{ model.code }}</small>
                    <p v-if="model.description">{{ model.description }}</p>
                  </div>
                </td>
                <td data-label="厂商">{{ model.provider.displayName }}</td>
                <td data-label="能力">
                  <span class="soft-badge">{{ capabilityLabel(model.capabilityType) }}</span>
                </td>
                <td data-label="租户默认">
                  <span :class="['state-dot', model.defaultTenantEnabled ? 'state-dot--on' : '']">{{
                    model.defaultTenantEnabled ? '默认启用' : '默认关闭'
                  }}</span>
                </td>
                <td data-label="状态">
                  <span :class="['tone-badge', `tone-badge--${statusTone(model.status)}`]">{{
                    statusLabel(model.status)
                  }}</span>
                </td>
                <td data-label="更新时间">{{ formatCatalogDate(model.updatedAt) }}</td>
                <td v-if="canManage" data-label="操作">
                  <div class="row-actions">
                    <button type="button" @click="openEditModel(model, $event)">
                      <PhPencilSimple :size="16" />编辑
                    </button>
                    <button
                      type="button"
                      :class="model.status === 'active' ? 'row-actions__danger' : ''"
                      @click="toggleModelStatus(model, $event)"
                    >
                      <PhPower :size="16" />{{ model.status === 'active' ? '停用' : '启用' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="catalog-footer">
          <span>共 {{ modelsQuery.data.value.total }} 个模型</span>
          <a-pagination
            v-model:current="page"
            :page-size="PAGE_SIZE"
            :total="modelsQuery.data.value.total"
            :show-size-changer="false"
            :show-less-items="true"
          />
        </footer>
      </template>
    </section>

    <ProviderManagerDrawer
      :open="activeDrawer === 'providers'"
      :providers="providersQuery.data.value?.items ?? []"
      @close="closeDrawer"
      @closed="restoreTriggerFocus"
      @saved="refreshAll"
      @conflict="handleProviderConflict"
    />
    <ModelCatalogEditorDrawer
      :open="activeDrawer === 'model'"
      :model="editingModel"
      :providers="providersQuery.data.value?.items ?? []"
      @close="closeDrawer"
      @closed="restoreTriggerFocus"
      @saved="refreshAll"
      @conflict="handleModelConflict"
    />
  </div>
</template>

<style scoped>
.catalog-panel {
  display: grid;
  gap: 1rem;
}
.catalog-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 0.75fr)) minmax(15rem, 1.5fr);
  gap: 0.75rem;
}
.catalog-overview article {
  display: flex;
  min-width: 0;
  min-height: 5.4rem;
  padding: 1rem;
  gap: 0.75rem;
  align-items: center;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: 1rem;
}
.catalog-overview article > span {
  display: grid;
  width: 2.45rem;
  height: 2.45rem;
  flex: 0 0 auto;
  place-items: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.08);
  border-radius: 0.75rem;
}
.catalog-overview article > div {
  display: grid;
  min-width: 0;
}
.catalog-overview small {
  color: var(--lz-color-subtle);
  font-size: 0.69rem;
}
.catalog-overview strong {
  margin-top: 0.12rem;
  overflow: hidden;
  color: var(--lz-color-text);
  font-size: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-overview__published {
  justify-content: space-between;
}
.catalog-overview__published button {
  display: grid;
  width: 2.45rem;
  height: 2.45rem;
  flex: 0 0 auto;
  place-items: center;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: rgba(140, 177, 218, 0.06);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.72rem;
}
.catalog-actions {
  display: flex;
  min-height: 4.4rem;
  padding: 0.8rem 0.9rem;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  background: rgba(85, 216, 241, 0.045);
  border: 1px solid rgba(85, 216, 241, 0.13);
  border-radius: 1rem;
}
.catalog-actions > div:first-child {
  display: grid;
}
.catalog-actions strong {
  color: var(--lz-color-text);
  font-size: 0.78rem;
}
.catalog-actions span {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
}
.catalog-actions > div:last-child {
  display: flex;
  gap: 0.6rem;
}
.catalog-filters {
  display: grid;
  padding: 0.8rem;
  grid-template-columns: minmax(15rem, 1fr) auto repeat(3, minmax(8.5rem, 0.42fr)) auto;
  gap: 0.6rem;
  align-items: center;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: 1rem;
}
.catalog-search {
  display: flex;
  height: 2.75rem;
  padding: 0 0.85rem;
  gap: 0.6rem;
  align-items: center;
  color: var(--lz-color-subtle);
  background: var(--lz-color-field);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-control);
}
.catalog-search:focus-within {
  border-color: var(--lz-color-line-strong);
}
.catalog-search input {
  min-width: 0;
  flex: 1;
  color: var(--lz-color-text);
  outline: 0;
  background: transparent;
  border: 0;
}
.catalog-search input::placeholder {
  color: var(--lz-color-subtle);
}
.catalog-results {
  position: relative;
  min-height: 25rem;
  overflow: hidden;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}
.catalog-progress {
  position: absolute;
  top: 0;
  right: 1rem;
  z-index: 2;
  padding: 0.35rem 0.55rem;
  color: var(--lz-color-accent);
  font-size: 0.68rem;
  background: var(--lz-color-surface-strong);
  border-radius: 0 0 0.55rem 0.55rem;
}
.catalog-table-wrap {
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(85, 216, 241, 0.35) rgba(140, 177, 218, 0.06);
}
table {
  width: 100%;
  min-width: 56rem;
  border-collapse: collapse;
}
th,
td {
  padding: 0.95rem 1rem;
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
  vertical-align: middle;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover td {
  background: rgba(85, 216, 241, 0.025);
}
.action-column {
  width: 10.5rem;
}
.row-actions {
  display: flex;
  gap: 0.35rem;
}
.row-actions button {
  display: inline-flex;
  min-height: 2rem;
  padding: 0.35rem 0.5rem;
  gap: 0.3rem;
  align-items: center;
  color: var(--lz-color-muted);
  font-size: 0.7rem;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 0.5rem;
}
.row-actions button:hover {
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.07);
}
.row-actions .row-actions__danger:hover {
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.07);
}
.model-identity {
  display: grid;
  min-width: 11rem;
  max-width: 18rem;
}
.model-identity strong {
  color: var(--lz-color-text);
  font-size: 0.79rem;
}
.model-identity small {
  color: var(--lz-color-accent);
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.66rem;
}
.model-identity p {
  display: -webkit-box;
  margin: 0.3rem 0 0;
  overflow: hidden;
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.soft-badge,
.tone-badge,
.state-dot {
  display: inline-flex;
  padding: 0.25rem 0.52rem;
  align-items: center;
  white-space: nowrap;
  border-radius: var(--lz-radius-pill);
}
.soft-badge {
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.075);
}
.tone-badge,
.state-dot {
  color: var(--lz-color-muted);
  background: rgba(140, 177, 218, 0.07);
}
.tone-badge--success {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.08);
}
.tone-badge--warning {
  color: var(--lz-color-warning);
  background: rgba(255, 189, 118, 0.08);
}
.tone-badge--danger {
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.08);
}
.state-dot::before {
  width: 0.35rem;
  height: 0.35rem;
  margin-right: 0.35rem;
  content: '';
  background: var(--lz-color-subtle);
  border-radius: 50%;
}
.state-dot--on {
  color: var(--lz-color-success);
}
.state-dot--on::before {
  background: var(--lz-color-success);
}
.catalog-footer {
  display: flex;
  padding: 1rem;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(140, 177, 218, 0.1);
}
.catalog-footer > span {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}
@media (max-width: 75rem) {
  .catalog-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .catalog-filters {
    grid-template-columns: minmax(0, 1fr) auto repeat(3, minmax(0, 1fr));
  }
  .catalog-filters > :last-child {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
@media (max-width: 48rem) {
  .catalog-actions {
    align-items: flex-start;
  }
  .catalog-filters {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .catalog-filters :deep(.ant-select) {
    width: 100%;
  }
  .catalog-filters :deep(.ant-select):nth-of-type(1) {
    grid-column: 1 / -1;
  }
}
@media (max-width: 48rem) {
  .catalog-actions {
    display: grid;
  }
  .catalog-actions > div:last-child {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .catalog-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .catalog-overview article {
    min-height: 4.8rem;
    padding: 0.8rem;
  }
  .catalog-overview__published {
    grid-column: 1 / -1;
  }
  .catalog-table-wrap {
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
  td:last-child {
    grid-column: 1 / -1;
  }
  .row-actions button {
    min-height: 2.5rem;
    padding-inline: 0.75rem;
  }
  .model-identity {
    min-width: 0;
    max-width: none;
  }
  .catalog-footer {
    display: grid;
    justify-items: center;
  }
}
</style>
