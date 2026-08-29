<script setup lang="ts">
import {
  PhArrowClockwise,
  PhArrowsLeftRight,
  PhClockCountdown,
  PhCheckCircle,
  PhCoins,
  PhFlask,
  PhMagnifyingGlass,
  PhReceipt,
  PhShieldCheck,
  PhWallet,
  PhXCircle,
} from '@phosphor-icons/vue';
import message from 'ant-design-vue/es/message';
import { computed, nextTick, ref } from 'vue';

import { toAppError } from '@/api/errors';
import AppState from '@/components/AppState.vue';
import RechargePackagePanel from '@/features/credits-management/components/RechargePackagePanel.vue';
import {
  billingLabel,
  billingTone,
  formatBillingDate,
  formatCredits,
  formatMoney,
  formatSignedCredits,
} from '@/features/credits-management/formatters';
import {
  useCreditLedgerQuery,
  useCreditWalletsQuery,
  useAdminCreditGrantMutation,
  useManualRechargeApproveMutation,
  useManualRechargeRejectMutation,
  useRechargeOrdersQuery,
  useReservationAnomaliesQuery,
  useSandboxPaymentMutation,
} from '@/features/credits-management/queries/credits-management-queries';
import type {
  CreditWalletItem,
  RechargeOrderItem,
  SandboxPaymentOutcome,
} from '@/features/credits-management/types';
import { useCursorTableState } from '@/features/credits-management/use-cursor-table-state';

type BillingTab = 'wallets' | 'orders' | 'packages' | 'ledger' | 'anomalies';

const activeTab = ref<BillingTab>('wallets');
const walletState = useCursorTableState();
const orderState = useCursorTableState();
const ledgerState = useCursorTableState();
const anomalyState = useCursorTableState();

const walletsQuery = useCreditWalletsQuery(
  walletState.filters,
  computed(() => activeTab.value === 'wallets'),
);
const ordersQuery = useRechargeOrdersQuery(
  orderState.filters,
  computed(() => activeTab.value === 'orders'),
);
const ledgerQuery = useCreditLedgerQuery(
  ledgerState.filters,
  computed(() => activeTab.value === 'ledger'),
);
const anomaliesQuery = useReservationAnomaliesQuery(
  anomalyState.filters,
  computed(() => activeTab.value === 'anomalies'),
);
const sandboxMutation = useSandboxPaymentMutation();
const sandboxModalOpen = ref(false);
const sandboxOrder = ref<RechargeOrderItem | null>(null);
const sandboxOutcome = ref<SandboxPaymentOutcome>('paid');
const sandboxEventId = ref('');
const sandboxAmount = ref<number | null>(null);
const sandboxError = ref('');
const sandboxTrigger = ref<HTMLElement | null>(null);
const manualApproveMutation = useManualRechargeApproveMutation();
const manualRejectMutation = useManualRechargeRejectMutation();
const manualModalOpen = ref(false);
const manualOrder = ref<RechargeOrderItem | null>(null);
const manualAction = ref<'approve' | 'reject'>('approve');
const manualReason = ref('');
const manualError = ref('');
const manualTrigger = ref<HTMLElement | null>(null);
const grantMutation = useAdminCreditGrantMutation();
const grantModalOpen = ref(false);
const grantWallet = ref<CreditWalletItem | null>(null);
const grantCredits = ref<number | null>(null);
const grantReason = ref('');
const grantError = ref('');

const walletError = computed(() =>
  walletsQuery.error.value ? toAppError(walletsQuery.error.value) : null,
);
const orderError = computed(() =>
  ordersQuery.error.value ? toAppError(ordersQuery.error.value) : null,
);
const ledgerError = computed(() =>
  ledgerQuery.error.value ? toAppError(ledgerQuery.error.value) : null,
);
const anomalyError = computed(() =>
  anomaliesQuery.error.value ? toAppError(anomaliesQuery.error.value) : null,
);

const walletStatuses = [
  { value: 'all', label: '全部用户状态' },
  { value: 'active', label: '正常' },
  { value: 'pending', label: '待激活' },
  { value: 'locked', label: '已锁定' },
  { value: 'disabled', label: '已禁用' },
];
const orderStatuses = [
  { value: 'all', label: '全部订单状态' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'manual_review', label: '人工核对' },
  { value: 'refund_pending', label: '退款处理中' },
  { value: 'refunded', label: '已退款' },
  { value: 'closed', label: '已关闭' },
  { value: 'rejected', label: '已驳回' },
];
const ledgerTypes = [
  { value: 'all', label: '全部流水类型' },
  { value: 'recharge', label: '充值' },
  { value: 'reserve', label: '预占' },
  { value: 'settle', label: '结算' },
  { value: 'release', label: '释放' },
  { value: 'refund', label: '退款' },
  { value: 'manual_adjustment', label: '人工调整' },
  { value: 'reversal', label: '冲正' },
  { value: 'migration', label: '迁移入账' },
];
const anomalyTypes = [
  { value: 'all', label: '全部异常类型' },
  { value: 'expired', label: '已过期' },
  { value: 'stale', label: '长期未更新' },
];
const tabs: { key: BillingTab; label: string; icon: typeof PhWallet }[] = [
  { key: 'wallets', label: '钱包', icon: PhWallet },
  { key: 'orders', label: '充值订单', icon: PhReceipt },
  { key: 'packages', label: '充值套餐', icon: PhCoins },
  { key: 'ledger', label: '积分流水', icon: PhArrowsLeftRight },
  { key: 'anomalies', label: '异常预占', icon: PhClockCountdown },
];

async function activateTab(tab: BillingTab, focus = false): Promise<void> {
  activeTab.value = tab;
  if (focus) {
    await nextTick();
    globalThis.document.getElementById(`credits-${tab}-tab`)?.focus();
  }
}

function moveTab(direction: 1 | -1): void {
  const index = tabs.findIndex((tab) => tab.key === activeTab.value);
  const nextIndex = (index + direction + tabs.length) % tabs.length;
  void activateTab(tabs[nextIndex]!.key, true);
}

function userName(username?: string | null, email?: string | null): string {
  return username || email || '未命名用户';
}

function paymentChannelLabel(channel: string): string {
  if (channel === 'manual_transfer') return '人工充值';
  if (channel === 'sandbox') return 'Sandbox';
  return channel;
}

function createSandboxEventId(): string {
  return `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openSandbox(order: RechargeOrderItem, event: Event): void {
  if (sandboxModalOpen.value || manualModalOpen.value) return;
  sandboxTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  sandboxOrder.value = order;
  sandboxOutcome.value = 'paid';
  sandboxEventId.value = createSandboxEventId();
  sandboxAmount.value = order.cashAmountCents;
  sandboxError.value = '';
  sandboxModalOpen.value = true;
}

function closeSandbox(): void {
  if (sandboxMutation.isPending.value) return;
  sandboxModalOpen.value = false;
}

function sandboxClosed(): void {
  sandboxOrder.value = null;
  sandboxError.value = '';
  sandboxTrigger.value?.focus();
  sandboxTrigger.value = null;
}

async function submitSandbox(): Promise<void> {
  if (!sandboxOrder.value) return;
  sandboxError.value = '';
  try {
    const response = await sandboxMutation.mutateAsync({
      orderId: sandboxOrder.value.id,
      request: {
        outcome: sandboxOutcome.value,
        eventId: sandboxEventId.value,
        cashAmountCents:
          sandboxOutcome.value === 'paid' ? (sandboxAmount.value ?? undefined) : undefined,
      },
    });
    const labels: Record<string, string> = {
      paid: response.idempotentReplay ? '成功事件已验证，未重复入账' : 'Sandbox 支付已成功入账',
      failed: '订单已按支付失败关闭',
      cancelled: '订单已按用户取消关闭',
      expired: '订单已过期关闭，未增加积分',
      closed: '订单已经关闭',
    };
    message.success(labels[response.result] ?? 'Sandbox 事件已处理');
    sandboxModalOpen.value = false;
  } catch (error) {
    const appError = toAppError(error);
    sandboxError.value = `${appError.title}：${appError.message}`;
  }
}

function openManualReview(
  order: RechargeOrderItem,
  action: 'approve' | 'reject',
  event: Event,
): void {
  if (manualModalOpen.value || sandboxModalOpen.value) return;
  manualTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  manualOrder.value = order;
  manualAction.value = action;
  manualReason.value = action === 'approve' ? '已核实线下款项到账' : '';
  manualError.value = '';
  manualModalOpen.value = true;
}

function closeManualReview(): void {
  if (manualApproveMutation.isPending.value || manualRejectMutation.isPending.value) return;
  manualModalOpen.value = false;
}

function manualReviewClosed(): void {
  manualOrder.value = null;
  manualReason.value = '';
  manualError.value = '';
  manualTrigger.value?.focus();
  manualTrigger.value = null;
}

async function submitManualReview(): Promise<void> {
  if (!manualOrder.value) return;
  const reason = manualReason.value.trim();
  if (reason.length < 2) {
    manualError.value = '请填写至少 2 个字符的审核说明。';
    return;
  }
  manualError.value = '';
  try {
    const mutation =
      manualAction.value === 'approve' ? manualApproveMutation : manualRejectMutation;
    await mutation.mutateAsync({ orderId: manualOrder.value.id, reason });
    message.success(
      manualAction.value === 'approve' ? '充值已确认到账并完成积分入账' : '充值申请已驳回',
    );
    manualModalOpen.value = false;
  } catch (error) {
    const appError = toAppError(error);
    manualError.value = `${appError.title}：${appError.message}`;
  }
}

function openGrant(wallet: CreditWalletItem): void {
  if (grantModalOpen.value || manualModalOpen.value || sandboxModalOpen.value) return;
  grantWallet.value = wallet;
  grantCredits.value = null;
  grantReason.value = '';
  grantError.value = '';
  grantModalOpen.value = true;
}

async function submitGrant(): Promise<void> {
  if (!grantWallet.value) return;
  const credits = Number(grantCredits.value);
  const reason = grantReason.value.trim();
  if (!Number.isSafeInteger(credits) || credits <= 0) {
    grantError.value = '请输入大于 0 的整数积分。';
    return;
  }
  if (reason.length < 2) {
    grantError.value = '请填写至少 2 个字符的充值说明。';
    return;
  }
  grantError.value = '';
  try {
    const result = await grantMutation.mutateAsync({
      userId: grantWallet.value.userId,
      credits,
      reason,
      idempotencyKey: `admin-grant-${globalThis.crypto.randomUUID()}`,
    });
    message.success(
      `已为 ${userName(grantWallet.value.username, grantWallet.value.email)} 增加 ${formatCredits(credits)} 积分`,
    );
    grantModalOpen.value = false;
    if (result.idempotentReplay) message.info('该充值请求已处理过，未重复入账');
  } catch (error) {
    const appError = toAppError(error);
    grantError.value = `${appError.title}：${appError.message}`;
  }
}
</script>

<template>
  <div class="credits-page">
    <header class="credits-heading">
      <div>
        <span>平台账务管理</span>
        <h1>积分与充值</h1>
        <p>维护充值套餐，核对钱包、订单、积分流水和未闭环预占。</p>
      </div>
    </header>

    <aside class="credits-safety-note">
      <PhShieldCheck :size="21" weight="duotone" />
      <div>
        <strong>桌面端申请，管理端核对</strong>
        <span
          >用户在桌面端选择套餐并提交申请；管理员确认线下款项到账后，系统原子入账并生成不可变流水。</span
        >
      </div>
    </aside>

    <div class="credits-tabs" role="tablist" aria-label="账务审计视图">
      <button
        v-for="tab in tabs"
        :id="`credits-${tab.key}-tab`"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key"
        :aria-controls="`credits-${tab.key}-panel`"
        :tabindex="activeTab === tab.key ? 0 : -1"
        @click="activateTab(tab.key)"
        @keydown.right.prevent="moveTab(1)"
        @keydown.left.prevent="moveTab(-1)"
        @keydown.home.prevent="activateTab(tabs[0]!.key, true)"
        @keydown.end.prevent="activateTab(tabs[tabs.length - 1]!.key, true)"
      >
        <component :is="tab.icon" :size="18" />
        {{ tab.label }}
      </button>
    </div>

    <section
      v-if="activeTab === 'wallets'"
      id="credits-wallets-panel"
      class="credits-panel"
      role="tabpanel"
      aria-labelledby="credits-wallets-tab"
      :aria-busy="walletsQuery.isFetching.value"
    >
      <div class="credits-toolbar">
        <label class="credits-search">
          <span class="sr-only">搜索用户名、邮箱或用户 ID</span>
          <PhMagnifyingGlass :size="18" />
          <input
            v-model="walletState.keywordDraft.value"
            type="search"
            maxlength="120"
            placeholder="搜索用户名、邮箱或用户 ID"
            @keyup.enter="walletState.submitSearch"
          />
        </label>
        <a-button type="primary" @click="walletState.submitSearch">查询</a-button>
        <a-select
          v-model:value="walletState.filter.value"
          :options="walletStatuses"
          aria-label="用户状态"
          @change="walletState.resetPagination"
        />
        <a-button type="text" @click="walletState.reset">重置</a-button>
        <button
          class="refresh-button"
          type="button"
          aria-label="刷新钱包"
          @click="walletsQuery.refetch()"
        >
          <PhArrowClockwise :size="18" />
        </button>
      </div>

      <AppState
        v-if="walletsQuery.isPending.value"
        kind="loading"
        title="正在读取钱包"
        description="正在汇总平台用户的可用积分与预占积分。"
      />
      <AppState
        v-else-if="walletError"
        :kind="walletError.status === 403 ? 'forbidden' : 'error'"
        :title="walletError.title"
        :description="walletError.message"
        action-label="重新加载"
        @action="walletsQuery.refetch()"
      />
      <AppState
        v-else-if="!walletsQuery.data.value?.items.length"
        kind="empty"
        title="没有匹配的钱包"
        description="当前筛选条件下没有钱包记录。"
        action-label="清除筛选"
        @action="walletState.reset"
      />
      <template v-else>
        <div v-if="walletsQuery.isFetching.value" class="fetch-progress" role="status">
          正在更新…
        </div>
        <div class="credits-table-wrap">
          <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>可用积分</th>
                <th>预占积分</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="wallet in walletsQuery.data.value.items" :key="wallet.userId">
                <td data-label="用户">
                  <div class="identity-cell">
                    <strong>{{ userName(wallet.username, wallet.email) }}</strong
                    ><small>{{ wallet.email }}</small
                    ><code>{{ wallet.userId }}</code>
                  </div>
                </td>
                <td data-label="可用积分">
                  <strong class="credit-value">{{ formatCredits(wallet.availableBalance) }}</strong>
                </td>
                <td data-label="预占积分">{{ formatCredits(wallet.reservedBalance) }}</td>
                <td data-label="状态">
                  <span :class="['tone-badge', `tone-badge--${billingTone(wallet.userStatus)}`]">{{
                    billingLabel(wallet.userStatus)
                  }}</span>
                </td>
                <td data-label="更新时间">{{ formatBillingDate(wallet.updatedAt) }}</td>
                <td data-label="操作">
                  <a-button type="primary" size="small" @click="openGrant(wallet)">充值积分</a-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="cursor-footer">
          <span>当前页 {{ walletsQuery.data.value.items.length }} 条</span>
          <div>
            <a-button :disabled="!walletState.hasPrevious.value" @click="walletState.previous"
              >上一页</a-button
            ><a-button
              :disabled="!walletsQuery.data.value.nextCursor"
              @click="walletState.next(walletsQuery.data.value.nextCursor)"
              >下一页</a-button
            >
          </div>
        </footer>
      </template>
    </section>

    <section
      v-else-if="activeTab === 'orders'"
      id="credits-orders-panel"
      class="credits-panel"
      role="tabpanel"
      aria-labelledby="credits-orders-tab"
      :aria-busy="ordersQuery.isFetching.value"
    >
      <div class="credits-toolbar">
        <label class="credits-search"
          ><span class="sr-only">搜索订单号、用户名或邮箱</span
          ><PhMagnifyingGlass :size="18" /><input
            v-model="orderState.keywordDraft.value"
            type="search"
            maxlength="120"
            placeholder="搜索订单号、用户名或邮箱"
            @keyup.enter="orderState.submitSearch"
        /></label>
        <a-button type="primary" @click="orderState.submitSearch">查询</a-button>
        <a-select
          v-model:value="orderState.filter.value"
          :options="orderStatuses"
          aria-label="订单状态"
          @change="orderState.resetPagination"
        />
        <a-button type="text" @click="orderState.reset">重置</a-button>
        <button
          class="refresh-button"
          type="button"
          aria-label="刷新充值订单"
          @click="ordersQuery.refetch()"
        >
          <PhArrowClockwise :size="18" />
        </button>
      </div>
      <AppState
        v-if="ordersQuery.isPending.value"
        kind="loading"
        title="正在读取充值订单"
        description="正在加载充值金额、积分和订单状态。"
      />
      <AppState
        v-else-if="orderError"
        :kind="orderError.status === 403 ? 'forbidden' : 'error'"
        :title="orderError.title"
        :description="orderError.message"
        action-label="重新加载"
        @action="ordersQuery.refetch()"
      />
      <AppState
        v-else-if="!ordersQuery.data.value?.items.length"
        kind="empty"
        title="没有匹配的订单"
        description="当前筛选条件下没有充值订单。"
        action-label="清除筛选"
        @action="orderState.reset"
      />
      <template v-else>
        <div v-if="ordersQuery.isFetching.value" class="fetch-progress" role="status">
          正在更新…
        </div>
        <div class="credits-table-wrap">
          <table class="orders-table">
            <thead>
              <tr>
                <th>订单</th>
                <th>用户</th>
                <th>支付金额</th>
                <th>到账积分</th>
                <th>渠道</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in ordersQuery.data.value.items" :key="order.id">
                <td data-label="订单">
                  <div class="identity-cell">
                    <strong>{{ order.orderNo }}</strong
                    ><small>{{ order.packageCode }}</small
                    ><small v-if="order.submissionNote" class="order-note"
                      >用户备注：{{ order.submissionNote }}</small
                    >
                  </div>
                </td>
                <td data-label="用户">
                  <div class="identity-cell">
                    <strong>{{ userName(order.username, order.email) }}</strong
                    ><small>{{ order.email }}</small>
                  </div>
                </td>
                <td data-label="支付金额">{{ formatMoney(order.cashAmountCents) }}</td>
                <td data-label="到账积分">
                  <strong class="credit-value">{{
                    formatCredits(order.creditAmount + order.bonusCredits)
                  }}</strong
                  ><small v-if="order.bonusCredits" class="bonus-copy"
                    >含赠送 {{ formatCredits(order.bonusCredits) }}</small
                  >
                </td>
                <td data-label="渠道">{{ paymentChannelLabel(order.paymentChannel) }}</td>
                <td data-label="状态">
                  <span :class="['tone-badge', `tone-badge--${billingTone(order.status)}`]">{{
                    billingLabel(order.status)
                  }}</span
                  ><small v-if="order.reviewReason" class="review-copy"
                    >{{ order.reviewReason
                    }}<template v-if="order.reviewedAt">
                      · {{ formatBillingDate(order.reviewedAt) }}</template
                    ></small
                  >
                </td>
                <td data-label="创建时间">{{ formatBillingDate(order.createdAt) }}</td>
                <td data-label="操作">
                  <div
                    v-if="
                      order.paymentChannel === 'manual_transfer' && order.status === 'manual_review'
                    "
                    class="review-actions"
                  >
                    <button
                      class="review-button review-button--approve"
                      type="button"
                      @click="openManualReview(order, 'approve', $event)"
                    >
                      <PhCheckCircle :size="16" />确认到账
                    </button>
                    <button
                      class="review-button review-button--reject"
                      type="button"
                      @click="openManualReview(order, 'reject', $event)"
                    >
                      <PhXCircle :size="16" />驳回
                    </button>
                  </div>
                  <button
                    v-else-if="order.paymentChannel === 'sandbox' && order.status === 'pending'"
                    class="sandbox-button"
                    type="button"
                    @click="openSandbox(order, $event)"
                  >
                    <PhFlask :size="16" />模拟支付
                  </button>
                  <span v-else class="no-action">无需处理</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="cursor-footer">
          <span>当前页 {{ ordersQuery.data.value.items.length }} 条</span>
          <div>
            <a-button :disabled="!orderState.hasPrevious.value" @click="orderState.previous"
              >上一页</a-button
            ><a-button
              :disabled="!ordersQuery.data.value.nextCursor"
              @click="orderState.next(ordersQuery.data.value.nextCursor)"
              >下一页</a-button
            >
          </div>
        </footer>
      </template>
    </section>

    <section
      v-else-if="activeTab === 'packages'"
      id="credits-packages-panel"
      role="tabpanel"
      aria-labelledby="credits-packages-tab"
    >
      <RechargePackagePanel />
    </section>

    <section
      v-else-if="activeTab === 'ledger'"
      id="credits-ledger-panel"
      class="credits-panel"
      role="tabpanel"
      aria-labelledby="credits-ledger-tab"
      :aria-busy="ledgerQuery.isFetching.value"
    >
      <div class="credits-toolbar">
        <label class="credits-search"
          ><span class="sr-only">搜索用户或业务标识</span><PhMagnifyingGlass :size="18" /><input
            v-model="ledgerState.keywordDraft.value"
            type="search"
            maxlength="120"
            placeholder="搜索用户、业务类型或业务标识"
            @keyup.enter="ledgerState.submitSearch"
        /></label>
        <a-button type="primary" @click="ledgerState.submitSearch">查询</a-button>
        <a-select
          v-model:value="ledgerState.filter.value"
          :options="ledgerTypes"
          aria-label="流水类型"
          @change="ledgerState.resetPagination"
        />
        <a-button type="text" @click="ledgerState.reset">重置</a-button>
        <button
          class="refresh-button"
          type="button"
          aria-label="刷新积分流水"
          @click="ledgerQuery.refetch()"
        >
          <PhArrowClockwise :size="18" />
        </button>
      </div>
      <AppState
        v-if="ledgerQuery.isPending.value"
        kind="loading"
        title="正在读取积分流水"
        description="正在加载不可变账务流水。"
      />
      <AppState
        v-else-if="ledgerError"
        :kind="ledgerError.status === 403 ? 'forbidden' : 'error'"
        :title="ledgerError.title"
        :description="ledgerError.message"
        action-label="重新加载"
        @action="ledgerQuery.refetch()"
      />
      <AppState
        v-else-if="!ledgerQuery.data.value?.items.length"
        kind="empty"
        title="没有匹配的流水"
        description="当前筛选条件下没有积分流水。"
        action-label="清除筛选"
        @action="ledgerState.reset"
      />
      <template v-else>
        <div v-if="ledgerQuery.isFetching.value" class="fetch-progress" role="status">
          正在更新…
        </div>
        <div class="credits-table-wrap">
          <table class="ledger-table">
            <thead>
              <tr>
                <th>用户 / 租户</th>
                <th>类型</th>
                <th>可用变动</th>
                <th>预占变动</th>
                <th>变动后余额</th>
                <th>业务标识</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in ledgerQuery.data.value.items" :key="entry.id">
                <td data-label="用户 / 租户">
                  <div class="identity-cell">
                    <strong>{{ userName(entry.username, entry.email) }}</strong
                    ><small>{{ entry.tenantName || '全局个人账务' }}</small>
                  </div>
                </td>
                <td data-label="类型">
                  <span :class="['tone-badge', `tone-badge--${billingTone(entry.entryType)}`]">{{
                    billingLabel(entry.entryType)
                  }}</span>
                </td>
                <td data-label="可用变动">
                  <strong
                    :class="[
                      'delta-value',
                      entry.availableDelta < 0 ? 'delta-value--negative' : '',
                    ]"
                    >{{ formatSignedCredits(entry.availableDelta) }}</strong
                  >
                </td>
                <td data-label="预占变动">{{ formatSignedCredits(entry.reservedDelta) }}</td>
                <td data-label="变动后余额">
                  {{ formatCredits(entry.availableAfter) }} /
                  {{ formatCredits(entry.reservedAfter) }}
                </td>
                <td data-label="业务标识">
                  <div class="identity-cell">
                    <strong>{{ entry.businessType }}</strong
                    ><code>{{ entry.businessId }}</code
                    ><small v-if="entry.reason">{{ entry.reason }}</small>
                  </div>
                </td>
                <td data-label="时间">{{ formatBillingDate(entry.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="cursor-footer">
          <span>当前页 {{ ledgerQuery.data.value.items.length }} 条</span>
          <div>
            <a-button :disabled="!ledgerState.hasPrevious.value" @click="ledgerState.previous"
              >上一页</a-button
            ><a-button
              :disabled="!ledgerQuery.data.value.nextCursor"
              @click="ledgerState.next(ledgerQuery.data.value.nextCursor)"
              >下一页</a-button
            >
          </div>
        </footer>
      </template>
    </section>

    <section
      v-else
      id="credits-anomalies-panel"
      class="credits-panel credits-panel--anomaly"
      role="tabpanel"
      aria-labelledby="credits-anomalies-tab"
      :aria-busy="anomaliesQuery.isFetching.value"
    >
      <div class="anomaly-definition">
        <PhClockCountdown :size="20" />
        <div>
          <strong>异常识别规则</strong
          ><span>已超过 expiresAt，或未设置过期时间且连续 2 小时没有更新的 reserved 预占。</span>
        </div>
      </div>
      <div class="credits-toolbar">
        <label class="credits-search"
          ><span class="sr-only">搜索用户、任务或尝试标识</span
          ><PhMagnifyingGlass :size="18" /><input
            v-model="anomalyState.keywordDraft.value"
            type="search"
            maxlength="120"
            placeholder="搜索用户、任务 ID 或尝试 ID"
            @keyup.enter="anomalyState.submitSearch"
        /></label>
        <a-button type="primary" @click="anomalyState.submitSearch">查询</a-button>
        <a-select
          v-model:value="anomalyState.filter.value"
          :options="anomalyTypes"
          aria-label="异常类型"
          @change="anomalyState.resetPagination"
        />
        <a-button type="text" @click="anomalyState.reset">重置</a-button>
        <button
          class="refresh-button"
          type="button"
          aria-label="刷新异常预占"
          @click="anomaliesQuery.refetch()"
        >
          <PhArrowClockwise :size="18" />
        </button>
      </div>
      <AppState
        v-if="anomaliesQuery.isPending.value"
        kind="loading"
        title="正在检测异常预占"
        description="正在核对尚未结算或释放的积分预占。"
      />
      <AppState
        v-else-if="anomalyError"
        :kind="anomalyError.status === 403 ? 'forbidden' : 'error'"
        :title="anomalyError.title"
        :description="anomalyError.message"
        action-label="重新加载"
        @action="anomaliesQuery.refetch()"
      />
      <AppState
        v-else-if="!anomaliesQuery.data.value?.items.length"
        kind="empty"
        title="没有异常预占"
        description="当前规则与筛选条件下没有待核对记录。"
        action-label="清除筛选"
        @action="anomalyState.reset"
      />
      <template v-else>
        <div v-if="anomaliesQuery.isFetching.value" class="fetch-progress" role="status">
          正在更新…
        </div>
        <div class="credits-table-wrap">
          <table class="anomaly-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>用户 / 租户</th>
                <th>预占积分</th>
                <th>异常类型</th>
                <th>过期时间</th>
                <th>最后更新</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="reservation in anomaliesQuery.data.value.items" :key="reservation.id">
                <td data-label="任务">
                  <div class="identity-cell">
                    <strong>{{ reservation.taskId }}</strong
                    ><code>{{ reservation.attemptId }}</code>
                  </div>
                </td>
                <td data-label="用户 / 租户">
                  <div class="identity-cell">
                    <strong>{{ userName(reservation.username, reservation.email) }}</strong
                    ><small>{{ reservation.tenantName }}</small>
                  </div>
                </td>
                <td data-label="预占积分">
                  <strong class="credit-value">{{
                    formatCredits(reservation.reservedCredits)
                  }}</strong>
                </td>
                <td data-label="异常类型">
                  <span class="tone-badge tone-badge--danger">{{
                    billingLabel(reservation.anomalyType)
                  }}</span>
                </td>
                <td data-label="过期时间">{{ formatBillingDate(reservation.expiresAt) }}</td>
                <td data-label="最后更新">{{ formatBillingDate(reservation.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="cursor-footer">
          <span>当前页 {{ anomaliesQuery.data.value.items.length }} 条</span>
          <div>
            <a-button :disabled="!anomalyState.hasPrevious.value" @click="anomalyState.previous"
              >上一页</a-button
            ><a-button
              :disabled="!anomaliesQuery.data.value.nextCursor"
              @click="anomalyState.next(anomaliesQuery.data.value.nextCursor)"
              >下一页</a-button
            >
          </div>
        </footer>
      </template>
    </section>

    <a-modal
      v-model:open="grantModalOpen"
      title="管理员充值积分"
      :confirm-loading="grantMutation.isPending.value"
      :mask-closable="!grantMutation.isPending.value"
      :keyboard="!grantMutation.isPending.value"
      ok-text="确认入账"
      cancel-text="取消"
      centered
      @ok="submitGrant"
    >
      <div class="manual-form">
        <div class="manual-note manual-note--approve">
          <PhShieldCheck :size="20" />
          <span>该操作会立即增加用户可用积分，并写入不可变积分流水。</span>
        </div>
        <dl v-if="grantWallet" class="manual-summary">
          <div><dt>用户</dt><dd>{{ userName(grantWallet.username, grantWallet.email) }}</dd></div>
          <div><dt>当前余额</dt><dd>{{ formatCredits(grantWallet.availableBalance) }}</dd></div>
          <div><dt>用户 ID</dt><dd>{{ grantWallet.userId }}</dd></div>
        </dl>
        <div v-if="grantError" class="sandbox-error" role="alert">{{ grantError }}</div>
        <label>
          <span>充值积分</span>
          <a-input-number v-model:value="grantCredits" :min="1" :precision="0" style="width: 100%" />
        </label>
        <label>
          <span>充值说明</span>
          <a-textarea
            v-model:value="grantReason"
            :maxlength="500"
            :rows="3"
            placeholder="例如：运营补偿、测试账号充值"
          />
        </label>
      </div>
    </a-modal>

    <a-modal
      v-model:open="sandboxModalOpen"
      :title="`Sandbox 支付模拟${sandboxOrder ? `：${sandboxOrder.orderNo}` : ''}`"
      :confirm-loading="sandboxMutation.isPending.value"
      :mask-closable="!sandboxMutation.isPending.value"
      :keyboard="!sandboxMutation.isPending.value"
      ok-text="提交事件"
      cancel-text="取消"
      centered
      @ok="submitSandbox"
      @cancel="closeSandbox"
      @after-close="sandboxClosed"
    >
      <div class="sandbox-form">
        <div class="sandbox-note">
          <PhShieldCheck :size="19" />
          <span>只模拟平台内部回调，不会发起真实支付，也不会联系任何第三方渠道。</span>
        </div>
        <div v-if="sandboxError" class="sandbox-error" role="alert">{{ sandboxError }}</div>
        <label>
          <span>处理结果</span>
          <a-radio-group v-model:value="sandboxOutcome" button-style="solid">
            <a-radio-button value="paid">支付成功</a-radio-button>
            <a-radio-button value="failed">支付失败</a-radio-button>
            <a-radio-button value="cancelled">用户取消</a-radio-button>
          </a-radio-group>
        </label>
        <label>
          <span>事件标识</span>
          <a-input v-model:value="sandboxEventId" :maxlength="120" />
          <small>同一个成功事件重复提交时，钱包和流水只处理一次。</small>
        </label>
        <label v-if="sandboxOutcome === 'paid'">
          <span>支付金额（分）</span>
          <a-input-number v-model:value="sandboxAmount" :min="1" :precision="0" />
          <small
            >订单金额为 {{ sandboxOrder?.cashAmountCents ?? 0 }} 分；金额不一致会被拒绝。</small
          >
        </label>
      </div>
    </a-modal>

    <a-modal
      v-model:open="manualModalOpen"
      :title="`${manualAction === 'approve' ? '确认充值到账' : '驳回充值申请'}${manualOrder ? `：${manualOrder.orderNo}` : ''}`"
      :confirm-loading="
        manualApproveMutation.isPending.value || manualRejectMutation.isPending.value
      "
      :mask-closable="
        !(manualApproveMutation.isPending.value || manualRejectMutation.isPending.value)
      "
      :keyboard="!(manualApproveMutation.isPending.value || manualRejectMutation.isPending.value)"
      :ok-text="manualAction === 'approve' ? '确认到账并入账' : '确认驳回'"
      cancel-text="取消"
      centered
      @ok="submitManualReview"
      @cancel="closeManualReview"
      @after-close="manualReviewClosed"
    >
      <div class="manual-form">
        <div :class="['manual-note', `manual-note--${manualAction}`]">
          <component :is="manualAction === 'approve' ? PhCheckCircle : PhXCircle" :size="20" />
          <span v-if="manualAction === 'approve'"
            >确认后将立即增加用户积分并写入充值流水，此操作不能撤销或重复入账。</span
          >
          <span v-else>驳回后不会增加积分，用户可在桌面端查看原因并重新提交充值申请。</span>
        </div>
        <dl v-if="manualOrder" class="manual-summary">
          <div>
            <dt>用户</dt>
            <dd>{{ userName(manualOrder.username, manualOrder.email) }}</dd>
          </div>
          <div>
            <dt>支付金额</dt>
            <dd>{{ formatMoney(manualOrder.cashAmountCents) }}</dd>
          </div>
          <div>
            <dt>到账积分</dt>
            <dd>{{ formatCredits(manualOrder.creditAmount + manualOrder.bonusCredits) }}</dd>
          </div>
          <div v-if="manualOrder.submissionNote">
            <dt>用户备注</dt>
            <dd>{{ manualOrder.submissionNote }}</dd>
          </div>
        </dl>
        <div v-if="manualError" class="sandbox-error" role="alert">{{ manualError }}</div>
        <label>
          <span>审核说明</span>
          <a-textarea
            v-model:value="manualReason"
            :maxlength="300"
            :rows="4"
            placeholder="填写到账核对信息或驳回原因"
          />
          <small>{{ manualReason.trim().length }}/300，至少填写 2 个字符。</small>
        </label>
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.credits-page {
  width: min(100%, 98rem);
  margin: 0 auto;
}
.credits-heading {
  display: flex;
  padding: 0.35rem 0 1.25rem;
  gap: 2rem;
  align-items: flex-start;
  justify-content: space-between;
}
.credits-heading > div:first-child > span {
  color: var(--lz-color-accent);
  font-size: 0.7rem;
  font-weight: 680;
  letter-spacing: 0.08em;
}
.credits-heading h1 {
  margin: 0.3rem 0 0;
  color: var(--lz-color-text);
  font-size: clamp(1.75rem, 3vw, 2.45rem);
  letter-spacing: -0.04em;
}
.credits-heading p {
  margin: 0.55rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.84rem;
}
.credits-safety-note,
.anomaly-definition {
  display: flex;
  padding: 0.9rem 1rem;
  gap: 0.7rem;
  align-items: center;
  border-radius: 0.9rem;
}
.credits-safety-note {
  margin-bottom: 1rem;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.04);
  border: 1px solid rgba(85, 216, 241, 0.12);
}
.credits-safety-note div,
.anomaly-definition div {
  display: grid;
}
.credits-safety-note strong,
.anomaly-definition strong {
  color: var(--lz-color-text);
  font-size: 0.76rem;
}
.credits-safety-note span,
.anomaly-definition span {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
}
.credits-tabs {
  display: grid;
  margin-bottom: 1rem;
  padding: 0.25rem;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  background: rgba(140, 177, 218, 0.05);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.9rem;
}
.credits-tabs button {
  display: inline-flex;
  min-height: 2.7rem;
  padding: 0 1rem;
  gap: 0.45rem;
  align-items: center;
  justify-content: center;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 0.68rem;
  transition:
    color 220ms var(--lz-motion-standard),
    background-color 220ms var(--lz-motion-standard);
}
.credits-tabs button[aria-selected='true'] {
  color: var(--lz-color-text);
  font-weight: 650;
  background: rgba(85, 216, 241, 0.1);
  box-shadow: inset 0 0 0 1px rgba(85, 216, 241, 0.1);
}
.credits-panel {
  position: relative;
  min-height: 31rem;
  overflow: hidden;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
  box-shadow: var(--lz-shadow-panel);
}
.credits-panel--anomaly {
  display: flex;
  flex-direction: column;
}
.anomaly-definition {
  margin: 0.85rem 0.85rem 0;
  color: var(--lz-color-warning);
  background: rgba(255, 189, 118, 0.045);
  border: 1px solid rgba(255, 189, 118, 0.13);
}
.credits-toolbar {
  display: grid;
  padding: 0.85rem;
  grid-template-columns: minmax(16rem, 1fr) auto minmax(10rem, 0.32fr) auto auto;
  gap: 0.6rem;
  align-items: center;
  border-bottom: 1px solid rgba(140, 177, 218, 0.1);
}
.credits-search {
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
.credits-search:focus-within {
  border-color: var(--lz-color-line-strong);
}
.credits-search input {
  min-width: 0;
  flex: 1;
  color: var(--lz-color-text);
  outline: 0;
  background: transparent;
  border: 0;
}
.credits-search input::placeholder {
  color: var(--lz-color-subtle);
}
.refresh-button {
  display: grid;
  width: 2.7rem;
  height: 2.7rem;
  padding: 0;
  place-items: center;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: rgba(140, 177, 218, 0.055);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-control);
}
.refresh-button:hover {
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.07);
}
.fetch-progress {
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
.credits-table-wrap {
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(85, 216, 241, 0.35) rgba(140, 177, 218, 0.06);
}
table {
  width: 100%;
  min-width: 62rem;
  border-collapse: collapse;
}
.orders-table,
.ledger-table {
  min-width: 76rem;
}
.anomaly-table {
  min-width: 68rem;
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
.identity-cell {
  display: grid;
  min-width: 10rem;
  max-width: 18rem;
}
.identity-cell strong {
  overflow: hidden;
  color: var(--lz-color-text);
  font-size: 0.77rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.identity-cell small,
.bonus-copy {
  color: var(--lz-color-subtle);
  font-size: 0.66rem;
}
.order-note,
.review-copy {
  margin-top: 0.22rem;
  line-height: 1.45;
  white-space: normal;
}
.order-note {
  color: var(--lz-color-muted) !important;
}
.review-copy {
  display: block;
  max-width: 12rem;
  color: var(--lz-color-subtle);
  font-size: 0.65rem;
}
.identity-cell code {
  overflow: hidden;
  color: var(--lz-color-accent);
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.62rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.credit-value,
.delta-value {
  color: var(--lz-color-success);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.delta-value--negative {
  color: var(--lz-color-danger);
}
.bonus-copy {
  display: block;
}
.sandbox-button {
  display: inline-flex;
  min-height: 2.1rem;
  padding: 0.35rem 0.55rem;
  gap: 0.35rem;
  align-items: center;
  color: var(--lz-color-accent);
  font-size: 0.7rem;
  cursor: pointer;
  background: rgba(85, 216, 241, 0.065);
  border: 1px solid rgba(85, 216, 241, 0.13);
  border-radius: 0.55rem;
  transition:
    transform 180ms var(--lz-motion-standard),
    background-color 180ms var(--lz-motion-standard);
}
.review-actions {
  display: flex;
  min-width: 10.5rem;
  gap: 0.45rem;
  align-items: center;
}
.review-button {
  display: inline-flex;
  min-height: 2.1rem;
  padding: 0.35rem 0.58rem;
  gap: 0.3rem;
  align-items: center;
  font-size: 0.7rem;
  cursor: pointer;
  border-radius: 0.55rem;
  transition:
    transform 180ms var(--lz-motion-standard),
    background-color 180ms var(--lz-motion-standard);
}
.review-button--approve {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.07);
  border: 1px solid rgba(114, 221, 194, 0.16);
}
.review-button--reject {
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.06);
  border: 1px solid rgba(255, 171, 148, 0.14);
}
.review-button:hover {
  background-color: rgba(140, 177, 218, 0.12);
}
.review-button:active {
  transform: translateY(1px);
}
.sandbox-button:hover {
  background: rgba(85, 216, 241, 0.11);
}
.sandbox-button:active {
  transform: translateY(1px);
}
.no-action {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
}
.sandbox-form {
  display: grid;
  gap: 1rem;
  padding-top: 0.3rem;
}
.manual-form {
  display: grid;
  gap: 1rem;
  padding-top: 0.3rem;
}
.manual-form label {
  display: grid;
  gap: 0.45rem;
  color: var(--lz-color-muted);
  font-size: 0.74rem;
}
.manual-form label > span:first-child {
  color: var(--lz-color-text);
  font-weight: 620;
}
.manual-form label > small {
  color: var(--lz-color-subtle);
  font-size: 0.66rem;
}
.manual-note {
  display: flex;
  padding: 0.8rem 0.9rem;
  gap: 0.6rem;
  align-items: flex-start;
  border-radius: var(--lz-radius-control);
}
.manual-note span {
  color: var(--lz-color-muted);
  font-size: 0.71rem;
  line-height: 1.55;
}
.manual-note--approve {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.065);
}
.manual-note--reject {
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.065);
}
.manual-summary {
  display: grid;
  margin: 0;
  padding: 0.85rem 0.95rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
  background: rgba(140, 177, 218, 0.045);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-control);
}
.manual-summary div {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
}
.manual-summary div:last-child:nth-child(4) {
  grid-column: 1 / -1;
}
.manual-summary dt {
  color: var(--lz-color-subtle);
  font-size: 0.65rem;
}
.manual-summary dd {
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--lz-color-text);
  font-size: 0.75rem;
}
.sandbox-form label {
  display: grid;
  gap: 0.45rem;
  color: var(--lz-color-muted);
  font-size: 0.74rem;
}
.sandbox-form label > span:first-child {
  color: var(--lz-color-text);
  font-weight: 620;
}
.sandbox-form label > small {
  color: var(--lz-color-subtle);
  font-size: 0.66rem;
}
.sandbox-form :deep(.ant-input-number) {
  width: 100%;
}
.sandbox-note {
  display: flex;
  padding: 0.8rem 0.9rem;
  gap: 0.6rem;
  align-items: flex-start;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.055);
  border-radius: var(--lz-radius-control);
}
.sandbox-note span {
  color: var(--lz-color-muted);
  font-size: 0.71rem;
  line-height: 1.55;
}
.sandbox-error {
  padding: 0.75rem 0.85rem;
  color: var(--lz-color-danger);
  font-size: 0.72rem;
  background: rgba(255, 171, 148, 0.07);
  border-radius: var(--lz-radius-control);
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
.cursor-footer {
  display: flex;
  min-height: 4.3rem;
  padding: 0.8rem 1rem;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(140, 177, 218, 0.1);
}
.cursor-footer > span {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}
.cursor-footer > div {
  display: flex;
  gap: 0.55rem;
}
@media (max-width: 68rem) {
  .credits-toolbar {
    grid-template-columns: minmax(0, 1fr) auto minmax(10rem, 0.45fr) auto auto;
  }
}
@media (max-width: 48rem) {
  .credits-heading {
    display: grid;
    gap: 0.8rem;
  }
  .credits-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .credits-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .credits-toolbar :deep(.ant-select) {
    width: 100%;
    grid-column: 1 / -1;
  }
  .credits-toolbar > :nth-child(4) {
    justify-self: start;
  }
  .credits-toolbar > :last-child {
    justify-self: end;
  }
  .credits-table-wrap {
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
    gap: 0.75rem 1rem;
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
    font-size: 0.61rem;
    content: attr(data-label);
  }
  td:first-child {
    grid-column: 1 / -1;
  }
  .sandbox-button {
    min-height: 2.75rem;
    padding-inline: 0.8rem;
  }
  .review-actions {
    min-width: 0;
    flex-wrap: wrap;
  }
  .review-button {
    min-height: 2.75rem;
    padding-inline: 0.8rem;
  }
  .manual-summary {
    grid-template-columns: 1fr;
  }
  .manual-summary div:last-child:nth-child(4) {
    grid-column: auto;
  }
  .identity-cell {
    min-width: 0;
    max-width: none;
  }
  .cursor-footer {
    display: grid;
    justify-items: center;
  }
  .credits-safety-note,
  .anomaly-definition {
    align-items: flex-start;
  }
}
@media (max-width: 24rem) {
  .credits-tabs button {
    padding-inline: 0.5rem;
  }
  tr {
    grid-template-columns: 1fr;
  }
  td:first-child {
    grid-column: auto;
  }
}
</style>
