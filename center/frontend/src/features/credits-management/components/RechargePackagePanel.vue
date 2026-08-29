<script setup lang="ts">
import { PhArrowClockwise, PhCoins, PhPencilSimple, PhPlus, PhPower } from '@phosphor-icons/vue';
import Modal from 'ant-design-vue/es/modal';
import message from 'ant-design-vue/es/message';
import { computed, ref } from 'vue';

import { toAppError } from '@/api/errors';
import AppState from '@/components/AppState.vue';
import RechargePackageDrawer from '@/features/credits-management/components/RechargePackageDrawer.vue';
import {
  billingLabel,
  billingTone,
  formatBillingDate,
  formatCredits,
  formatMoney,
} from '@/features/credits-management/formatters';
import {
  useRechargePackagesQuery,
  useUpdateRechargePackageMutation,
} from '@/features/credits-management/queries/credits-management-queries';
import type { RechargePackage } from '@/features/credits-management/types';

const packagesQuery = useRechargePackagesQuery();
const updateMutation = useUpdateRechargePackageMutation();
const drawerOpen = ref(false);
const selectedPackageId = ref('');
const statusConfirmVisible = ref(false);
const lastTrigger = ref<HTMLElement | null>(null);

const error = computed(() =>
  packagesQuery.error.value ? toAppError(packagesQuery.error.value) : null,
);
const selectedPackage = computed(
  () => packagesQuery.data.value?.items.find((item) => item.id === selectedPackageId.value) ?? null,
);
const packageSummary = computed(() => {
  const items = packagesQuery.data.value?.items ?? [];
  return {
    total: items.length,
    active: items.filter((item) => item.status === 'active').length,
    draft: items.filter((item) => item.status === 'draft').length,
  };
});

function rememberTrigger(event?: Event): void {
  lastTrigger.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

function openCreate(event?: Event): void {
  if (drawerOpen.value || statusConfirmVisible.value) return;
  rememberTrigger(event);
  selectedPackageId.value = '';
  drawerOpen.value = true;
}

function openEdit(item: RechargePackage, event: Event): void {
  if (drawerOpen.value || statusConfirmVisible.value) return;
  rememberTrigger(event);
  selectedPackageId.value = item.id;
  drawerOpen.value = true;
}

function closeDrawer(): void {
  drawerOpen.value = false;
}

function restoreTriggerFocus(): void {
  lastTrigger.value?.focus();
  lastTrigger.value = null;
}

async function refresh(): Promise<void> {
  await packagesQuery.refetch();
}

async function handleConflict(packageId: string): Promise<void> {
  await refresh();
  selectedPackageId.value = packageId;
}

function toggleStatus(item: RechargePackage, event: Event): void {
  if (drawerOpen.value || statusConfirmVisible.value) return;
  rememberTrigger(event);
  statusConfirmVisible.value = true;
  const targetStatus = item.status === 'active' ? 'inactive' : 'active';
  Modal.confirm({
    title: targetStatus === 'active' ? '启用这个充值套餐？' : '停用这个充值套餐？',
    content:
      targetStatus === 'active'
        ? `启用后，${item.displayName} 会出现在桌面端可选套餐中。`
        : `停用后，${item.displayName} 不再接受新充值订单，已有订单不受影响。`,
    okText: targetStatus === 'active' ? '确认启用' : '确认停用',
    cancelText: '取消',
    centered: true,
    async onOk() {
      try {
        await updateMutation.mutateAsync({
          packageId: item.id,
          request: {
            displayName: item.displayName,
            cashAmountCents: item.cashAmountCents,
            creditAmount: item.creditAmount,
            bonusCredits: item.bonusCredits,
            status: targetStatus,
            sortOrder: item.sortOrder,
            rowVersion: item.rowVersion,
          },
        });
        message.success(targetStatus === 'active' ? '充值套餐已启用' : '充值套餐已停用');
        await refresh();
      } catch (caught) {
        const appError = toAppError(caught);
        if (appError.code === 'RECHARGE_PACKAGE_ROW_VERSION_CONFLICT') {
          await refresh();
          message.warning('套餐已被其他管理员修改，列表已刷新，请重新操作。');
          return;
        }
        message.error(`${appError.title}：${appError.message}`);
        throw caught;
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
  <div class="package-panel" :aria-busy="packagesQuery.isFetching.value">
    <section class="package-summary" aria-label="充值套餐概况">
      <article>
        <span><PhCoins :size="20" /></span>
        <div>
          <small>套餐总数</small><strong>{{ packageSummary.total }}</strong>
        </div>
      </article>
      <article>
        <span><PhPower :size="20" /></span>
        <div>
          <small>桌面可用</small><strong>{{ packageSummary.active }}</strong>
        </div>
      </article>
      <article>
        <div>
          <small>待完善草稿</small><strong>{{ packageSummary.draft }}</strong>
        </div>
        <button type="button" aria-label="刷新充值套餐" @click="refresh">
          <PhArrowClockwise :size="18" />
        </button>
      </article>
    </section>

    <section class="package-actions">
      <div>
        <strong>套餐维护</strong>
        <span>金额和积分由服务端套餐决定，桌面端不能自行声明到账数量。</span>
      </div>
      <a-button type="primary" @click="openCreate"><PhPlus :size="17" />新增套餐</a-button>
    </section>

    <section class="package-results">
      <AppState
        v-if="packagesQuery.isPending.value"
        kind="loading"
        title="正在读取充值套餐"
        description="正在加载金额、积分和启停状态。"
      />
      <AppState
        v-else-if="error"
        :kind="error.status === 403 ? 'forbidden' : 'error'"
        :title="error.title"
        :description="error.message"
        action-label="重新加载"
        @action="refresh"
      />
      <AppState
        v-else-if="!packagesQuery.data.value?.items.length"
        kind="empty"
        title="还没有充值套餐"
        description="先创建一个草稿，核对金额和积分后再启用。"
        action-label="新增套餐"
        @action="openCreate"
      />
      <template v-else>
        <div v-if="packagesQuery.isFetching.value" class="package-progress" role="status">
          正在更新…
        </div>
        <div class="package-table-wrap">
          <table>
            <thead>
              <tr>
                <th>套餐</th>
                <th>支付金额</th>
                <th>到账积分</th>
                <th>状态</th>
                <th>排序</th>
                <th>更新时间</th>
                <th class="action-column">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in packagesQuery.data.value.items" :key="item.id">
                <td data-label="套餐">
                  <div class="package-identity">
                    <strong>{{ item.displayName }}</strong>
                    <code>{{ item.code }}</code>
                  </div>
                </td>
                <td data-label="支付金额">{{ formatMoney(item.cashAmountCents) }}</td>
                <td data-label="到账积分">
                  <strong class="credit-value">{{
                    formatCredits(item.creditAmount + item.bonusCredits)
                  }}</strong>
                  <small v-if="item.bonusCredits"
                    >含赠送 {{ formatCredits(item.bonusCredits) }}</small
                  >
                </td>
                <td data-label="状态">
                  <span :class="['tone-badge', `tone-badge--${billingTone(item.status)}`]">
                    {{ billingLabel(item.status) }}
                  </span>
                </td>
                <td data-label="排序">{{ item.sortOrder }}</td>
                <td data-label="更新时间">{{ formatBillingDate(item.updatedAt) }}</td>
                <td data-label="操作">
                  <div class="row-actions">
                    <button type="button" @click="openEdit(item, $event)">
                      <PhPencilSimple :size="16" />编辑
                    </button>
                    <button
                      type="button"
                      :class="item.status === 'active' ? 'row-actions__danger' : ''"
                      @click="toggleStatus(item, $event)"
                    >
                      <PhPower :size="16" />{{ item.status === 'active' ? '停用' : '启用' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <RechargePackageDrawer
      :open="drawerOpen"
      :recharge-package="selectedPackage"
      @close="closeDrawer"
      @closed="restoreTriggerFocus"
      @saved="refresh"
      @conflict="handleConflict"
    />
  </div>
</template>

<style scoped>
.package-panel {
  display: grid;
  gap: 1rem;
}
.package-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 0.7fr)) minmax(15rem, 1.4fr);
  gap: 0.75rem;
}
.package-summary article {
  display: flex;
  min-height: 5.2rem;
  padding: 1rem;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: 1rem;
}
.package-summary article > span,
.package-summary article > button {
  display: grid;
  width: 2.45rem;
  height: 2.45rem;
  flex: 0 0 auto;
  place-items: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.08);
  border: 0;
  border-radius: 0.75rem;
}
.package-summary article > button {
  cursor: pointer;
  border: 1px solid var(--lz-color-line);
}
.package-summary article > div {
  display: grid;
  min-width: 0;
}
.package-summary small {
  color: var(--lz-color-subtle);
  font-size: 0.69rem;
}
.package-summary strong {
  color: var(--lz-color-text);
  font-size: 1.05rem;
}
.package-actions {
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
.package-actions > div {
  display: grid;
}
.package-actions strong {
  color: var(--lz-color-text);
  font-size: 0.78rem;
}
.package-actions span {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
}
.package-results {
  position: relative;
  min-height: 24rem;
  overflow: hidden;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}
.package-progress {
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
.package-table-wrap {
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(85, 216, 241, 0.35) rgba(140, 177, 218, 0.06);
}
table {
  width: 100%;
  min-width: 62rem;
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
.package-identity {
  display: grid;
  min-width: 10rem;
}
.package-identity strong {
  color: var(--lz-color-text);
  font-size: 0.78rem;
}
.package-identity code {
  color: var(--lz-color-accent);
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.65rem;
}
.credit-value {
  display: block;
  color: var(--lz-color-success);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
td small {
  color: var(--lz-color-subtle);
  font-size: 0.66rem;
}
.tone-badge {
  display: inline-flex;
  padding: 0.25rem 0.52rem;
  white-space: nowrap;
  color: var(--lz-color-muted);
  background: rgba(140, 177, 218, 0.07);
  border-radius: var(--lz-radius-pill);
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
.action-column {
  width: 10rem;
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
@media (max-width: 48rem) {
  .package-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .package-summary article:last-child {
    grid-column: 1 / -1;
  }
  .package-actions {
    display: grid;
    align-items: start;
  }
  .package-table-wrap {
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
    min-width: 0;
    padding: 0;
    gap: 0.15rem;
    border: 0;
  }
  td::before {
    color: var(--lz-color-subtle);
    font-size: 0.62rem;
    content: attr(data-label);
  }
  td:first-child,
  td:last-child {
    grid-column: 1 / -1;
  }
  .row-actions button {
    min-height: 2.75rem;
    padding-inline: 0.8rem;
  }
}
@media (max-width: 24rem) {
  .package-summary,
  tr {
    grid-template-columns: 1fr;
  }
  .package-summary article:last-child,
  td:first-child,
  td:last-child {
    grid-column: auto;
  }
}
</style>
