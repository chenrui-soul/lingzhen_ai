<script setup lang="ts">
import { PhArrowLeft, PhBuildings, PhPencilSimple, PhPlus } from '@phosphor-icons/vue';
import ADrawer from 'ant-design-vue/es/drawer';
import message from 'ant-design-vue/es/message';
import { computed, reactive, ref, watch } from 'vue';

import { toAppError } from '@/api/errors';
import { statusLabel, statusTone } from '@/features/model-catalog/formatters';
import {
  useCreateModelProviderMutation,
  useUpdateModelProviderMutation,
} from '@/features/model-catalog/queries/model-catalog-queries';
import type { ModelProvider } from '@/features/model-catalog/types';

type ViewMode = 'list' | 'create' | 'edit';

const props = defineProps<{ open: boolean; providers: ModelProvider[] }>();
const emit = defineEmits<{
  close: [];
  saved: [provider: ModelProvider];
  conflict: [providerId: string];
  closed: [];
}>();

const createMutation = useCreateModelProviderMutation();
const updateMutation = useUpdateModelProviderMutation();
const submitting = computed(
  () => createMutation.isPending.value || updateMutation.isPending.value,
);
const mode = ref<ViewMode>('list');
const selectedId = ref('');
const conflictPending = ref(false);
const formError = ref('');
const notice = ref('');
const fieldErrors = reactive<Record<string, string>>({});
const selectedProvider = computed(
  () => props.providers.find((provider) => provider.id === selectedId.value) ?? null,
);

const form = reactive({
  code: '',
  displayName: '',
  protocolFamily: 'openai_compatible',
  description: '',
  status: 'draft',
});
const protocolOptions = [
  { value: 'openai_compatible', label: 'OpenAI 兼容协议' },
  { value: 'anthropic_compatible', label: 'Anthropic 兼容协议' },
  { value: 'custom_proxy', label: '自定义代理协议' },
];
const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '启用' },
  { value: 'inactive', label: '停用' },
];

function clearErrors(): void {
  formError.value = '';
  notice.value = '';
  Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
}

function openList(): void {
  clearErrors();
  mode.value = 'list';
  selectedId.value = '';
  conflictPending.value = false;
}

function openCreate(): void {
  clearErrors();
  mode.value = 'create';
  selectedId.value = '';
  form.code = '';
  form.displayName = '';
  form.protocolFamily = 'openai_compatible';
  form.description = '';
  form.status = 'draft';
}

function populate(provider: ModelProvider): void {
  clearErrors();
  form.code = provider.code;
  form.displayName = provider.displayName;
  form.protocolFamily = provider.protocolFamily;
  form.description = provider.description ?? '';
  form.status = provider.status;
}

function openEdit(provider: ModelProvider): void {
  mode.value = 'edit';
  selectedId.value = provider.id;
  conflictPending.value = false;
  populate(provider);
}

watch(
  () => props.open,
  (open) => {
    if (open) openList();
  },
);

watch(
  () => selectedProvider.value?.rowVersion,
  (nextVersion, previousVersion) => {
    if (
      props.open &&
      mode.value === 'edit' &&
      conflictPending.value &&
      selectedProvider.value &&
      nextVersion !== previousVersion
    ) {
      populate(selectedProvider.value);
      conflictPending.value = false;
      notice.value = '已载入服务器上的最新厂商资料，请核对后重新保存。';
    }
  },
);

function validate(): boolean {
  clearErrors();
  if (!form.code.trim()) fieldErrors.code = '请输入厂商编码';
  if (!form.displayName.trim()) fieldErrors.displayName = '请输入厂商名称';
  return Object.keys(fieldErrors).length === 0;
}

async function submit(): Promise<void> {
  if (!validate()) return;
  try {
    const saved =
      mode.value === 'edit' && selectedProvider.value
        ? await updateMutation.mutateAsync({
            providerId: selectedProvider.value.id,
            request: {
              displayName: form.displayName.trim(),
              protocolFamily: form.protocolFamily,
              description: form.description.trim(),
              status: form.status,
              rowVersion: selectedProvider.value.rowVersion,
            },
          })
        : await createMutation.mutateAsync({
            code: form.code.trim(),
            displayName: form.displayName.trim(),
            protocolFamily: form.protocolFamily,
            description: form.description.trim(),
          });
    message.success(mode.value === 'edit' ? '厂商资料已更新' : '厂商已创建为草稿');
    emit('saved', saved);
    openList();
  } catch (error) {
    const appError = toAppError(error);
    Object.assign(fieldErrors, appError.fieldErrors);
    if (appError.code === 'MODEL_ROW_VERSION_CONFLICT' && selectedProvider.value) {
      conflictPending.value = true;
      formError.value = '此厂商已被其他管理员修改，正在刷新最新内容。';
      emit('conflict', selectedProvider.value.id);
      return;
    }
    formError.value = `${appError.title}：${appError.message}`;
  }
}

function handleOpenChange(open: boolean): void {
  if (!open) emit('closed');
}
</script>

<template>
  <ADrawer
    :open="open"
    :width="'min(38rem, 100vw)'"
    :keyboard="!submitting"
    :mask-closable="!submitting"
    :closable="!submitting"
    placement="right"
    @close="emit('close')"
    @after-open-change="handleOpenChange"
  >
    <template #title>
      <div class="provider-heading">
        <span><PhBuildings :size="19" /></span>
        <div>
          <strong>模型厂商</strong>
          <small>维护协议类型、展示资料与可用状态</small>
        </div>
      </div>
    </template>

    <div v-if="mode === 'list'" class="provider-list-view">
      <div class="provider-toolbar">
        <div>
          <strong>{{ providers.length }} 个厂商</strong>
          <small>停用前需先处理该厂商下的启用模型。</small>
        </div>
        <a-button type="primary" @click="openCreate"><PhPlus :size="16" />新增厂商</a-button>
      </div>
      <div v-if="providers.length" class="provider-list">
        <article v-for="provider in providers" :key="provider.id" class="provider-row">
          <div class="provider-row__identity">
            <span>{{ provider.displayName.slice(0, 1).toUpperCase() }}</span>
            <div>
              <strong>{{ provider.displayName }}</strong>
              <small>{{ provider.code }}</small>
            </div>
          </div>
          <div class="provider-row__meta">
            <span>{{ protocolOptions.find((item) => item.value === provider.protocolFamily)?.label ?? provider.protocolFamily }}</span>
            <span :class="['tone-badge', `tone-badge--${statusTone(provider.status)}`]">{{ statusLabel(provider.status) }}</span>
          </div>
          <button type="button" class="edit-button" :aria-label="`编辑 ${provider.displayName}`" @click="openEdit(provider)">
            <PhPencilSimple :size="17" />编辑
          </button>
        </article>
      </div>
      <div v-else class="provider-empty">
        <PhBuildings :size="28" />
        <strong>还没有模型厂商</strong>
        <span>先创建厂商，再新增该厂商下的模型。</span>
      </div>
    </div>

    <form v-else class="provider-form" @submit.prevent="submit">
      <button type="button" class="back-button" @click="openList"><PhArrowLeft :size="17" />返回厂商列表</button>
      <header>
        <h2>{{ mode === 'create' ? '新增厂商' : '编辑厂商' }}</h2>
        <p>{{ mode === 'create' ? '厂商创建后默认处于草稿状态。' : '编码创建后不可修改，避免破坏模型映射。' }}</p>
      </header>
      <div v-if="notice" class="provider-notice provider-notice--success" role="status">{{ notice }}</div>
      <div v-if="formError" class="provider-notice provider-notice--error" role="alert">{{ formError }}</div>
      <label class="field">
        <span>厂商编码</span>
        <a-input v-model:value="form.code" :disabled="mode === 'edit'" :maxlength="64" placeholder="例如 volcengine" />
        <small v-if="fieldErrors.code" class="field-error">{{ fieldErrors.code }}</small>
        <small v-else>使用小写字母、数字、点、短横线或下划线。</small>
      </label>
      <label class="field">
        <span>展示名称</span>
        <a-input v-model:value="form.displayName" :maxlength="120" placeholder="例如 火山引擎" />
        <small v-if="fieldErrors.displayName" class="field-error">{{ fieldErrors.displayName }}</small>
      </label>
      <label class="field">
        <span>协议类型</span>
        <a-select v-model:value="form.protocolFamily" :options="protocolOptions" />
      </label>
      <label v-if="mode === 'edit'" class="field">
        <span>厂商状态</span>
        <a-select v-model:value="form.status" :options="statusOptions" />
        <small>启用模型前，所属厂商必须先启用。</small>
      </label>
      <label class="field">
        <span>厂商说明</span>
        <a-input v-model:value="form.description" type="textarea" :maxlength="2000" :auto-size="{ minRows: 4, maxRows: 8 }" placeholder="说明服务来源、适用范围或维护备注" />
      </label>
    </form>

    <template v-if="mode !== 'list'" #footer>
      <div class="provider-footer">
        <a-button :disabled="submitting" @click="openList">取消</a-button>
        <a-button type="primary" :loading="submitting" @click="submit">{{ mode === 'create' ? '创建草稿' : '保存修改' }}</a-button>
      </div>
    </template>
  </ADrawer>
</template>

<style scoped>
.provider-heading,
.provider-heading > span,
.provider-toolbar,
.provider-row,
.provider-row__identity,
.provider-row__meta,
.edit-button,
.back-button,
.provider-footer {
  display: flex;
  align-items: center;
}
.provider-heading { gap: 0.7rem; }
.provider-heading > span { width: 2.25rem; height: 2.25rem; justify-content: center; color: var(--lz-color-accent); background: rgba(85, 216, 241, 0.08); border-radius: var(--lz-radius-control); }
.provider-heading > div,
.provider-toolbar > div,
.provider-row__identity > div { display: grid; min-width: 0; }
.provider-heading strong { color: var(--lz-color-text); font-size: 0.95rem; }
.provider-heading small,
.provider-toolbar small { color: var(--lz-color-subtle); font-size: 0.7rem; }
.provider-list-view { display: grid; gap: 1rem; }
.provider-toolbar { gap: 1rem; justify-content: space-between; }
.provider-toolbar strong { color: var(--lz-color-text); font-size: 0.85rem; }
.provider-list { display: grid; gap: 0.65rem; }
.provider-row { min-width: 0; padding: 0.85rem; gap: 0.8rem; background: rgba(140, 177, 218, 0.035); border: 1px solid var(--lz-color-line); border-radius: var(--lz-radius-control); }
.provider-row__identity { min-width: 0; flex: 1; gap: 0.65rem; }
.provider-row__identity > span { display: grid; width: 2.35rem; height: 2.35rem; flex: 0 0 auto; place-items: center; color: var(--lz-color-accent); font-weight: 700; background: rgba(85, 216, 241, 0.08); border-radius: 0.7rem; }
.provider-row__identity strong,
.provider-row__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-row__identity strong { color: var(--lz-color-text); font-size: 0.78rem; }
.provider-row__identity small { color: var(--lz-color-accent); font-family: 'Cascadia Code', Consolas, monospace; font-size: 0.66rem; }
.provider-row__meta { gap: 0.55rem; color: var(--lz-color-subtle); font-size: 0.68rem; }
.tone-badge { padding: 0.22rem 0.5rem; color: var(--lz-color-muted); background: rgba(140, 177, 218, 0.07); border-radius: var(--lz-radius-pill); }
.tone-badge--success { color: var(--lz-color-success); background: rgba(114, 221, 194, 0.08); }
.tone-badge--danger { color: var(--lz-color-danger); background: rgba(255, 171, 148, 0.08); }
.edit-button,
.back-button { gap: 0.35rem; color: var(--lz-color-muted); cursor: pointer; background: transparent; border: 0; }
.edit-button { padding: 0.45rem 0.55rem; font-size: 0.7rem; border-radius: 0.55rem; }
.edit-button:hover { color: var(--lz-color-accent); background: rgba(85, 216, 241, 0.07); }
.provider-empty { display: grid; min-height: 16rem; place-content: center; justify-items: center; color: var(--lz-color-subtle); text-align: center; }
.provider-empty strong { margin-top: 0.6rem; color: var(--lz-color-text); }
.provider-empty span { margin-top: 0.2rem; font-size: 0.72rem; }
.provider-form { display: grid; gap: 1rem; }
.back-button { width: max-content; padding: 0; }
.provider-form header h2 { margin: 0; color: var(--lz-color-text); font-size: 1.1rem; }
.provider-form header p { margin: 0.25rem 0 0; color: var(--lz-color-subtle); font-size: 0.72rem; }
.provider-notice { padding: 0.8rem 0.9rem; color: var(--lz-color-muted); background: rgba(140, 177, 218, 0.06); border-radius: var(--lz-radius-control); }
.provider-notice--success { color: var(--lz-color-success); background: rgba(114, 221, 194, 0.07); }
.provider-notice--error { color: var(--lz-color-danger); background: rgba(255, 171, 148, 0.07); }
.field { display: grid; gap: 0.4rem; color: var(--lz-color-muted); font-size: 0.74rem; }
.field > span:first-child { color: var(--lz-color-text); font-weight: 620; }
.field > small { color: var(--lz-color-subtle); font-size: 0.66rem; }
.field-error { color: var(--lz-color-danger) !important; }
.provider-footer { gap: 0.65rem; justify-content: flex-end; }
@media (max-width: 40rem) {
  .provider-toolbar { align-items: flex-start; }
  .provider-row { display: grid; grid-template-columns: 1fr auto; }
  .provider-row__meta { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; }
  .provider-footer > * { flex: 1; }
}
</style>
