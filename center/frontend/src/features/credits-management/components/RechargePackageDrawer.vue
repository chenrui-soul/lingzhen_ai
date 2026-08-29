<script setup lang="ts">
import { PhCoins, PhInfo } from '@phosphor-icons/vue';
import ADrawer from 'ant-design-vue/es/drawer';
import AInputNumber from 'ant-design-vue/es/input-number';
import message from 'ant-design-vue/es/message';
import { computed, reactive, ref, watch } from 'vue';

import { toAppError } from '@/api/errors';
import {
  useCreateRechargePackageMutation,
  useUpdateRechargePackageMutation,
} from '@/features/credits-management/queries/credits-management-queries';
import type { RechargePackage } from '@/features/credits-management/types';

const props = defineProps<{
  open: boolean;
  rechargePackage: RechargePackage | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  conflict: [packageId: string];
  closed: [];
}>();

const createMutation = useCreateRechargePackageMutation();
const updateMutation = useUpdateRechargePackageMutation();
const editing = computed(() => Boolean(props.rechargePackage));
const submitting = computed(() => createMutation.isPending.value || updateMutation.isPending.value);
const formError = ref('');
const fieldErrors = reactive<Record<string, string>>({});
const form = reactive({
  code: '',
  displayName: '',
  cashAmountYuan: 9.9,
  creditAmount: 100,
  bonusCredits: 0,
  sortOrder: 0,
  status: 'draft' as RechargePackage['status'],
});

const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '启用' },
  { value: 'inactive', label: '停用' },
];

function resetErrors(): void {
  formError.value = '';
  Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
}

function populate(): void {
  resetErrors();
  const item = props.rechargePackage;
  form.code = item?.code ?? '';
  form.displayName = item?.displayName ?? '';
  form.cashAmountYuan = (item?.cashAmountCents ?? 990) / 100;
  form.creditAmount = item?.creditAmount ?? 100;
  form.bonusCredits = item?.bonusCredits ?? 0;
  form.sortOrder = item?.sortOrder ?? 0;
  form.status = item?.status ?? 'draft';
}

watch(
  () => [props.open, props.rechargePackage?.id, props.rechargePackage?.rowVersion] as const,
  ([open]) => {
    if (open) populate();
  },
  { immediate: true },
);

function validate(): boolean {
  resetErrors();
  if (!form.code.trim()) fieldErrors.code = '请输入套餐代码';
  if (!form.displayName.trim()) fieldErrors.displayName = '请输入套餐名称';
  if (!Number.isFinite(form.cashAmountYuan) || form.cashAmountYuan <= 0) {
    fieldErrors.cashAmountYuan = '请输入有效金额';
  }
  if (!Number.isInteger(form.creditAmount) || form.creditAmount <= 0) {
    fieldErrors.creditAmount = '积分必须是正整数';
  }
  if (!Number.isInteger(form.bonusCredits) || form.bonusCredits < 0) {
    fieldErrors.bonusCredits = '赠送积分不能小于 0';
  }
  return !Object.keys(fieldErrors).length;
}

async function submit(): Promise<void> {
  if (!validate()) return;
  const cashAmountCents = Math.round(form.cashAmountYuan * 100);
  try {
    if (props.rechargePackage) {
      await updateMutation.mutateAsync({
        packageId: props.rechargePackage.id,
        request: {
          displayName: form.displayName.trim(),
          cashAmountCents,
          creditAmount: form.creditAmount,
          bonusCredits: form.bonusCredits,
          status: form.status,
          sortOrder: form.sortOrder,
          rowVersion: props.rechargePackage.rowVersion,
        },
      });
      message.success('充值套餐已更新');
    } else {
      await createMutation.mutateAsync({
        code: form.code.trim().toLowerCase(),
        displayName: form.displayName.trim(),
        cashAmountCents,
        creditAmount: form.creditAmount,
        bonusCredits: form.bonusCredits,
        sortOrder: form.sortOrder,
      });
      message.success('充值套餐已创建为草稿');
    }
    emit('saved');
    emit('close');
  } catch (error) {
    const appError = toAppError(error);
    Object.assign(fieldErrors, appError.fieldErrors);
    if (appError.code === 'RECHARGE_PACKAGE_ROW_VERSION_CONFLICT' && props.rechargePackage) {
      formError.value = '套餐已被其他管理员修改，正在刷新最新内容。';
      emit('conflict', props.rechargePackage.id);
      return;
    }
    formError.value = `${appError.title}：${appError.message}`;
  }
}
</script>

<template>
  <ADrawer
    :open="open"
    :width="'min(36rem, 100vw)'"
    :keyboard="!submitting"
    :mask-closable="!submitting"
    :closable="!submitting"
    placement="right"
    @close="emit('close')"
    @after-open-change="(value: boolean) => !value && emit('closed')"
  >
    <template #title>
      <div class="drawer-heading">
        <span><PhCoins :size="19" /></span>
        <div>
          <strong>{{ editing ? '编辑充值套餐' : '新增充值套餐' }}</strong>
          <small>{{ editing ? '保存时校验数据版本' : '新套餐默认保存为草稿' }}</small>
        </div>
      </div>
    </template>

    <form class="package-form" @submit.prevent="submit">
      <div v-if="formError" class="form-notice" role="alert">
        <PhInfo :size="18" />
        <span>{{ formError }}</span>
      </div>
      <label class="field field--wide">
        <span>套餐代码</span>
        <a-input
          v-model:value="form.code"
          :disabled="editing"
          :maxlength="64"
          placeholder="例如 starter_100"
        />
        <small v-if="editing">创建后不可修改，用于订单快照和接口识别。</small>
        <small v-if="fieldErrors.code" class="field-error">{{ fieldErrors.code }}</small>
      </label>
      <label class="field field--wide">
        <span>套餐名称</span>
        <a-input
          v-model:value="form.displayName"
          :maxlength="120"
          placeholder="例如 新手 100 积分"
        />
        <small v-if="fieldErrors.displayName" class="field-error">{{
          fieldErrors.displayName
        }}</small>
      </label>
      <label class="field">
        <span>支付金额（元）</span>
        <AInputNumber v-model:value="form.cashAmountYuan" :min="0.01" :precision="2" />
        <small v-if="fieldErrors.cashAmountYuan" class="field-error">{{
          fieldErrors.cashAmountYuan
        }}</small>
      </label>
      <label class="field">
        <span>基础积分</span>
        <AInputNumber v-model:value="form.creditAmount" :min="1" :precision="0" />
        <small v-if="fieldErrors.creditAmount" class="field-error">{{
          fieldErrors.creditAmount
        }}</small>
      </label>
      <label class="field">
        <span>赠送积分</span>
        <AInputNumber v-model:value="form.bonusCredits" :min="0" :precision="0" />
        <small v-if="fieldErrors.bonusCredits" class="field-error">{{
          fieldErrors.bonusCredits
        }}</small>
      </label>
      <label class="field">
        <span>排序值</span>
        <AInputNumber v-model:value="form.sortOrder" :precision="0" />
      </label>
      <label v-if="editing" class="field field--wide">
        <span>套餐状态</span>
        <a-select v-model:value="form.status" :options="statusOptions" />
        <small>只有启用状态会出现在桌面充值套餐列表。</small>
      </label>
    </form>

    <template #footer>
      <div class="drawer-footer">
        <a-button :disabled="submitting" @click="emit('close')">取消</a-button>
        <a-button type="primary" :loading="submitting" @click="submit">
          {{ editing ? '保存修改' : '创建草稿' }}
        </a-button>
      </div>
    </template>
  </ADrawer>
</template>

<style scoped>
.drawer-heading,
.drawer-heading > span,
.form-notice,
.drawer-footer {
  display: flex;
  align-items: center;
}
.drawer-heading {
  gap: 0.7rem;
}
.drawer-heading > span {
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
.package-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.form-notice {
  grid-column: 1 / -1;
  padding: 0.8rem 0.9rem;
  gap: 0.6rem;
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.07);
  border-radius: var(--lz-radius-control);
}
.field {
  display: grid;
  min-width: 0;
  gap: 0.42rem;
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
.field :deep(.ant-input-number) {
  width: 100%;
}
.field-error {
  color: var(--lz-color-danger) !important;
}
.drawer-footer {
  gap: 0.65rem;
  justify-content: flex-end;
}
@media (max-width: 36rem) {
  .package-form {
    grid-template-columns: 1fr;
  }
  .field--wide,
  .form-notice {
    grid-column: auto;
  }
  .drawer-footer > * {
    flex: 1;
  }
}
</style>
