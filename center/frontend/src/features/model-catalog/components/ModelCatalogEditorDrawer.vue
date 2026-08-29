<script setup lang="ts">
import { PhBracketsCurly, PhCheck, PhInfo, PhSlidersHorizontal } from '@phosphor-icons/vue';
import ACheckbox from 'ant-design-vue/es/checkbox';
import ADrawer from 'ant-design-vue/es/drawer';
import AInputNumber from 'ant-design-vue/es/input-number';
import message from 'ant-design-vue/es/message';
import { computed, reactive, ref, watch } from 'vue';

import { toAppError } from '@/api/errors';
import {
  useCreateCatalogModelMutation,
  useUpdateCatalogModelMutation,
} from '@/features/model-catalog/queries/model-catalog-queries';
import type {
  CatalogModel,
  CreateCatalogModelRequest,
  ModelProvider,
  UpdateCatalogModelRequest,
} from '@/features/model-catalog/types';

const props = defineProps<{
  open: boolean;
  model: CatalogModel | null;
  providers: ModelProvider[];
}>();

const emit = defineEmits<{
  close: [];
  saved: [model: CatalogModel];
  conflict: [modelId: string];
  closed: [];
}>();

const createMutation = useCreateCatalogModelMutation();
const updateMutation = useUpdateCatalogModelMutation();
const editing = computed(() => Boolean(props.model));
const submitting = computed(() => createMutation.isPending.value || updateMutation.isPending.value);
const conflictPending = ref(false);
const notice = ref('');
const formError = ref('');
const fieldErrors = reactive<Record<string, string>>({});

const form = reactive({
  providerId: '',
  code: '',
  displayName: '',
  capabilityType: 'video',
  description: '',
  parameterSchemaText: '{\n  "type": "object",\n  "properties": {}\n}',
  defaultParametersText: '{}',
  defaultTenantEnabled: false,
  sortOrder: 0,
  status: 'active',
  baseUrl: '',
  apiKey: '',
  submitPath: '',
  statusPath: '',
  cancelPath: '',
  timeoutSeconds: 120,
  runtimeEnabled: true,
  runtimeRowVersion: 0,
  baseCredits: 0,
  maxReserveCredits: 1,
  priceRowVersion: 0,
});

const capabilityOptions = [
  { value: 'text', label: '文本生成' },
  { value: 'image', label: '图像生成' },
  { value: 'video', label: '视频生成' },
  { value: 'audio', label: '音频生成' },
];
const statusOptions = [
  { value: 'active', label: '启用' },
  { value: 'inactive', label: '停用' },
];
const providerOptions = computed(() =>
  props.providers.map((provider) => ({
    value: provider.id,
    label: `${provider.displayName} (${provider.code})`,
  })),
);

function clearErrors(): void {
  formError.value = '';
  notice.value = '';
  Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
}

function prettyJson(value: Record<string, unknown>): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function populate(model: CatalogModel | null): void {
  clearErrors();
  conflictPending.value = false;
  form.providerId = model?.provider.id ?? props.providers[0]?.id ?? '';
  form.code = model?.code ?? '';
  form.displayName = model?.displayName ?? '';
  form.capabilityType = model?.capabilityType ?? 'video';
  form.description = model?.description ?? '';
  form.parameterSchemaText = prettyJson(
    model?.parameterSchema ?? { type: 'object', properties: {} },
  );
  form.defaultParametersText = prettyJson(model?.defaultParameters ?? {});
  form.defaultTenantEnabled = model?.defaultTenantEnabled ?? false;
  form.sortOrder = model?.sortOrder ?? 0;
  form.status = model?.status === 'inactive' ? 'inactive' : 'active';
  form.baseUrl = model?.baseUrl ?? '';
  form.apiKey = '';
  form.submitPath = model?.submitPath ?? '';
  form.statusPath = model?.statusPath ?? '';
  form.cancelPath = model?.cancelPath ?? '';
  form.timeoutSeconds = model?.timeoutSeconds ?? 120;
  form.runtimeEnabled = model?.runtimeEnabled ?? false;
  form.runtimeRowVersion = model?.runtimeRowVersion ?? 0;
  form.baseCredits = model?.baseCredits ?? 0;
  form.maxReserveCredits = model?.maxReserveCredits ?? 1;
  form.priceRowVersion = model?.priceRowVersion ?? 0;
}

watch(
  () => [props.open, props.model?.id] as const,
  ([open]) => {
    if (open) populate(props.model);
  },
  { immediate: true },
);

watch(
  () => props.model?.rowVersion,
  (nextVersion, previousVersion) => {
    if (
      props.open &&
      editing.value &&
      conflictPending.value &&
      nextVersion !== undefined &&
      nextVersion !== previousVersion
    ) {
      populate(props.model);
      notice.value = '已载入服务器上的最新内容，请核对后重新保存。';
    }
  },
);

function requireField(key: string, value: string, label: string): void {
  if (!value.trim()) fieldErrors[key] = `请输入${label}`;
}

function parseObject(key: string, value: string, label: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      fieldErrors[key] = `${label}必须是 JSON 对象`;
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    fieldErrors[key] = `${label}不是有效的 JSON`;
    return null;
  }
}

async function submit(): Promise<void> {
  clearErrors();
  requireField('providerId', form.providerId, '模型厂商');
  requireField('code', form.code, '模型编码');
  requireField('displayName', form.displayName, '模型名称');
  const parameterSchema = parseObject('parameterSchema', form.parameterSchemaText, '参数 Schema');
  const defaultParameters = parseObject(
    'defaultParameters',
    form.defaultParametersText,
    '默认参数',
  );
  if (Object.keys(fieldErrors).length || !parameterSchema || !defaultParameters) return;
  if (form.maxReserveCredits < 1 || form.maxReserveCredits < form.baseCredits) {
    fieldErrors.baseCredits = '预占积分必须大于 0 且不能小于实际扣除积分';
    return;
  }

  const baseRequest: CreateCatalogModelRequest = {
    providerId: form.providerId,
    code: form.code.trim(),
    displayName: form.displayName.trim(),
    capabilityType: form.capabilityType,
    description: form.description.trim(),
    parameterSchema,
    defaultParameters,
    defaultTenantEnabled: form.defaultTenantEnabled,
    sortOrder: form.sortOrder,
    baseUrl: form.baseUrl.trim() || undefined,
    apiKey: form.apiKey.trim() || undefined,
    submitPath: form.submitPath.trim() || undefined,
    statusPath: form.statusPath.trim() || undefined,
    cancelPath: form.cancelPath.trim() || undefined,
    timeoutSeconds: form.timeoutSeconds,
    runtimeEnabled: form.runtimeEnabled,
    baseCredits: form.baseCredits,
    maxReserveCredits: form.maxReserveCredits,
    status: 'active',
  };

  try {
    let saved = props.model
      ? await updateMutation.mutateAsync({
          modelId: props.model.id,
          request: {
            ...baseRequest,
            status: form.status,
            rowVersion: props.model.rowVersion,
            runtimeRowVersion: props.model.runtimeRowVersion ?? 0,
            priceRowVersion: props.model.priceRowVersion ?? 0,
          } satisfies UpdateCatalogModelRequest,
        })
      : await createMutation.mutateAsync(baseRequest);

    message.success(props.model ? '模型已更新并立即生效' : '模型已创建并立即生效');
    emit('saved', saved);
    emit('close');
  } catch (error) {
    const appError = toAppError(error);
    Object.assign(fieldErrors, appError.fieldErrors);
    if (appError.code === 'MODEL_ROW_VERSION_CONFLICT' && props.model) {
      conflictPending.value = true;
      formError.value = '此模型已被其他管理员修改，正在刷新最新内容。';
      emit('conflict', props.model.id);
      return;
    }
    formError.value = `${appError.title}：${appError.message}`;
  }
}

function handleSubmit(): void {
  void submit();
}

function handleOpenChange(open: boolean): void {
  if (!open) emit('closed');
}
</script>

<template>
  <ADrawer
    :open="open"
    :width="'min(44rem, 100vw)'"
    :keyboard="!submitting"
    :mask-closable="!submitting"
    :closable="!submitting"
    class="catalog-editor-drawer"
    placement="right"
    @close="emit('close')"
    @after-open-change="handleOpenChange"
  >
    <template #title>
      <div class="drawer-heading">
        <span><PhSlidersHorizontal :size="19" /></span>
        <div>
          <strong>{{ editing ? '编辑模型' : '新增模型' }}</strong>
          <small>{{ editing ? '保存时校验数据版本' : '填写基础信息即可快速上线' }}</small>
        </div>
      </div>
    </template>

    <form id="catalog-model-form" class="catalog-form" @submit.prevent="handleSubmit">
      <div v-if="notice" class="form-notice form-notice--success" role="status">
        <PhCheck :size="18" />
        <span>{{ notice }}</span>
      </div>
      <div v-if="formError" class="form-notice form-notice--error" role="alert">
        <PhInfo :size="18" />
        <span>{{ formError }}</span>
      </div>

      <section class="form-section">
        <div class="form-section__heading">
          <h2>模型信息</h2>
          <p>填写基础信息并保存，模型会立即同步到桌面端。</p>
        </div>
        <div class="form-grid">
          <label class="field field--wide">
            <span>模型厂商</span>
            <a-select
              v-model:value="form.providerId"
              :options="providerOptions"
              placeholder="选择模型厂商"
              show-search
              option-filter-prop="label"
            />
            <small v-if="fieldErrors.providerId" class="field-error">{{
              fieldErrors.providerId
            }}</small>
          </label>
          <label class="field">
            <span>模型编码</span>
            <a-input
              v-model:value="form.code"
              :maxlength="128"
              placeholder="例如 seedance-2.0-mini"
            />
            <small v-if="fieldErrors.code" class="field-error">{{ fieldErrors.code }}</small>
          </label>
          <label class="field">
            <span>展示名称</span>
            <a-input
              v-model:value="form.displayName"
              :maxlength="160"
              placeholder="例如 Seedance 2.0 Mini"
            />
            <small v-if="fieldErrors.displayName" class="field-error">{{
              fieldErrors.displayName
            }}</small>
          </label>
          <label class="field">
            <span>能力类型</span>
            <a-select v-model:value="form.capabilityType" :options="capabilityOptions" />
          </label>
          <label class="field field--wide">
            <span>模型说明</span>
            <a-input
              v-model:value="form.description"
              type="textarea"
              :maxlength="4000"
              :auto-size="{ minRows: 3, maxRows: 6 }"
              placeholder="说明适用场景、限制或维护备注"
            />
          </label>
          <label class="checkbox-field field--wide">
            <ACheckbox v-model:checked="form.defaultTenantEnabled" />
            <span>
              <strong>默认开放给租户</strong>
              <small>保存后，租户无需额外配置即可看到此模型。</small>
            </span>
          </label>
        </div>
      </section>

      <details class="runtime-section" open>
        <summary>
          <span>调用配置（管理员）</span>
          <small>当前模型的地址和密钥仅用于平台代理执行</small>
        </summary>
        <div class="runtime-grid">
          <label class="field runtime-field--wide">
            <span>调用地址</span>
            <a-input v-model:value="form.baseUrl" placeholder="例如 https://api.example.com" />
          </label>
          <label class="field runtime-field--wide">
            <span>调用密钥</span>
            <a-input-password
              v-model:value="form.apiKey"
              :placeholder="props.model?.apiKeyConfigured ? '已配置，留空表示不修改' : '输入管理员密钥'"
            />
          </label>
          <label class="field">
            <span>请求超时（秒）</span>
            <AInputNumber v-model:value="form.timeoutSeconds" :min="1" :max="600" :precision="0" />
          </label>
          <label class="checkbox-field">
            <ACheckbox v-model:checked="form.runtimeEnabled" />
            <span><strong>启用平台代理</strong><small>关闭后不会调用当前模型。</small></span>
          </label>
          <label class="field">
            <span>提交路径</span>
            <a-input v-model:value="form.submitPath" placeholder="按管理员配置填写；不填写则使用调用地址本身" />
          </label>
          <label class="field runtime-field--wide">
            <span>任务查询地址（可选）</span>
            <a-input v-model:value="form.statusPath" placeholder="完整地址，例如 https://api.example.com/v1/videos/{id}" />
            <small>用于异步任务查询；支持完整 HTTP/HTTPS 地址，系统不会自动补路径。</small>
          </label>
          <label class="field runtime-field--wide">
            <span>任务取消地址（可选）</span>
            <a-input v-model:value="form.cancelPath" placeholder="完整地址，例如 https://api.example.com/v1/videos/{id}/cancel" />
          </label>
        </div>
      </details>

      <section class="form-section price-section">
        <div class="form-section__heading">
          <h2>模型价格</h2>
          <p>价格直接归属于当前模型；任务提交时会固定价格版本，避免后续改价影响历史任务。</p>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>实际扣除积分</span>
            <AInputNumber v-model:value="form.baseCredits" :min="0" :precision="0" style="width: 100%" />
            <small v-if="fieldErrors.baseCredits" class="field-error">{{ fieldErrors.baseCredits }}</small>
          </label>
          <label class="field">
            <span>任务预占积分</span>
            <AInputNumber v-model:value="form.maxReserveCredits" :min="1" :precision="0" style="width: 100%" />
            <small>提交任务时先预占，成功结算差额，失败或取消释放。</small>
          </label>
        </div>
      </section>

      <details class="advanced-section">
        <summary>
          <span>高级参数（可选）</span>
          <small>参数 Schema、默认参数、状态和排序</small>
        </summary>
        <section class="form-section">
          <div class="form-grid advanced-grid">
            <label class="field">
              <span>排序值</span>
              <AInputNumber v-model:value="form.sortOrder" :min="0" :precision="0" />
            </label>
            <label v-if="editing" class="field">
              <span>目录状态</span>
              <a-select v-model:value="form.status" :options="statusOptions" />
              <small>停用后会立即从桌面端可用模型中移除。</small>
            </label>
          </div>
          <div class="form-section__heading form-section__heading--icon">
            <span><PhBracketsCurly :size="19" /></span>
            <div>
              <h2>参数契约</h2>
              <p>只接受 JSON 对象，敏感字段、超深结构和原型污染键会被后端拒绝。</p>
            </div>
          </div>
          <div class="json-grid">
            <label class="field">
              <span>参数 Schema</span>
              <a-input
                v-model:value="form.parameterSchemaText"
                class="json-input"
                type="textarea"
                :auto-size="{ minRows: 10, maxRows: 18 }"
                spellcheck="false"
              />
              <small v-if="fieldErrors.parameterSchema" class="field-error">{{
                fieldErrors.parameterSchema
              }}</small>
            </label>
            <label class="field">
              <span>默认参数</span>
              <a-input
                v-model:value="form.defaultParametersText"
                class="json-input"
                type="textarea"
                :auto-size="{ minRows: 10, maxRows: 18 }"
                spellcheck="false"
              />
              <small v-if="fieldErrors.defaultParameters" class="field-error">{{
                fieldErrors.defaultParameters
              }}</small>
            </label>
          </div>
        </section>
      </details>
    </form>

    <template #footer>
      <div class="drawer-footer">
        <a-button :disabled="submitting" @click="emit('close')">取消</a-button>
        <a-button type="primary" :loading="submitting" @click="submit()">
          保存并生效
        </a-button>
      </div>
    </template>
  </ADrawer>
</template>

<style scoped>
.drawer-heading,
.drawer-heading > span,
.form-section__heading--icon,
.form-notice,
.checkbox-field,
.drawer-footer {
  display: flex;
  align-items: center;
}
.drawer-heading {
  gap: 0.7rem;
}
.drawer-heading > span,
.form-section__heading--icon > span {
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 auto;
  justify-content: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.08);
  border-radius: var(--lz-radius-control);
}
.drawer-heading > div {
  display: grid;
}
.drawer-heading strong {
  color: var(--lz-color-text);
  font-size: 0.95rem;
}
.drawer-heading small {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}
.catalog-form {
  display: grid;
  gap: 1rem;
  padding-bottom: 0.5rem;
}
.advanced-section {
  overflow: hidden;
  background: rgba(140, 177, 218, 0.025);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}
.advanced-section summary {
  display: flex;
  min-height: 3.25rem;
  padding: 0.8rem 1rem;
  gap: 0.65rem;
  align-items: center;
  color: var(--lz-color-text);
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
  list-style: none;
}
.advanced-section summary::-webkit-details-marker {
  display: none;
}
.advanced-section summary::after {
  margin-left: auto;
  color: var(--lz-color-subtle);
  content: '+';
  font-size: 1.15rem;
  font-weight: 400;
}
.advanced-section[open] summary::after {
  content: '−';
}
.runtime-section { overflow: hidden; border: 1px solid var(--lz-color-line); border-radius: var(--lz-radius-card); background: rgba(140, 177, 218, 0.025); }
.runtime-section summary { display: flex; align-items: center; gap: 0.6rem; min-height: 3.2rem; padding: 0.8rem 1rem; cursor: pointer; list-style: none; color: var(--lz-color-text); font-size: 0.78rem; font-weight: 650; }
.runtime-section summary::-webkit-details-marker { display: none; }
.runtime-section summary::after { margin-left: auto; content: '+'; color: var(--lz-color-subtle); font-size: 1.1rem; font-weight: 400; }
.runtime-section[open] summary::after { content: '−'; }
.runtime-section summary small { color: var(--lz-color-subtle); font-size: 0.66rem; font-weight: 450; }
.runtime-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.85rem; padding: 0.85rem 1rem 1rem; border-top: 1px solid var(--lz-color-line); }
.runtime-field--wide { grid-column: 1 / -1; }
.runtime-grid .checkbox-field { min-height: 2.4rem; }
.advanced-section summary small {
  color: var(--lz-color-subtle);
  font-size: 0.67rem;
  font-weight: 450;
}
.advanced-section > .form-section {
  margin: 0 0.7rem 0.7rem;
  padding: 0.85rem;
}
.form-notice {
  padding: 0.8rem 0.9rem;
  gap: 0.6rem;
  color: var(--lz-color-muted);
  background: rgba(140, 177, 218, 0.06);
  border-radius: var(--lz-radius-control);
}
.form-notice--success {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.07);
}
.form-notice--error {
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.07);
}
.form-section {
  padding: 1rem;
  background: rgba(140, 177, 218, 0.035);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}
.form-section__heading {
  margin-bottom: 1rem;
}
.form-section__heading--icon {
  gap: 0.7rem;
  align-items: flex-start;
}
.form-section__heading h2 {
  margin: 0;
  color: var(--lz-color-text);
  font-size: 0.9rem;
}
.form-section__heading p {
  margin: 0.2rem 0 0;
  color: var(--lz-color-subtle);
  font-size: 0.71rem;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}
.field {
  display: grid;
  min-width: 0;
  gap: 0.4rem;
  color: var(--lz-color-muted);
  font-size: 0.74rem;
}
.field > span:first-child {
  color: var(--lz-color-text);
  font-weight: 620;
}
.field > small {
  color: var(--lz-color-subtle);
  font-size: 0.66rem;
}
.field--wide {
  grid-column: 1 / -1;
}
.field-error {
  color: var(--lz-color-danger) !important;
}
.checkbox-field {
  padding: 0.85rem;
  gap: 0.7rem;
  background: var(--lz-color-field);
  border-radius: var(--lz-radius-control);
}
.checkbox-field > span {
  display: grid;
}
.checkbox-field strong {
  color: var(--lz-color-text);
  font-size: 0.76rem;
}
.checkbox-field small {
  color: var(--lz-color-subtle);
  font-size: 0.67rem;
}
.json-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}
.json-input :deep(textarea),
.json-input:deep(textarea) {
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.72rem;
  line-height: 1.55;
  tab-size: 2;
}
.drawer-footer {
  gap: 0.65rem;
  justify-content: flex-end;
}
@media (max-width: 40rem) {
  .form-grid,
  .json-grid {
    grid-template-columns: 1fr;
  }
  .field--wide {
    grid-column: auto;
  }
  .form-section {
    padding: 0.85rem;
  }
  .runtime-grid { grid-template-columns: 1fr; }
  .runtime-field--wide { grid-column: auto; }
  .drawer-footer > * {
    flex: 1;
  }
}
</style>
