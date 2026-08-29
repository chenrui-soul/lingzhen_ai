const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN');
const MONEY_FORMATTER = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
});
const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const LABELS: Record<string, string> = {
  pending: '待处理',
  draft: '草稿',
  inactive: '已停用',
  active: '正常',
  locked: '已锁定',
  disabled: '已禁用',
  paid: '已支付',
  closed: '已关闭',
  refund_pending: '退款处理中',
  refunded: '已退款',
  manual_review: '人工核对',
  rejected: '已驳回',
  migration: '迁移入账',
  recharge: '充值',
  reserve: '预占',
  settle: '结算',
  release: '释放',
  refund: '退款',
  manual_adjustment: '人工调整',
  reversal: '冲正',
  expired: '已过期',
  stale: '长期未更新',
};

export function formatCredits(value?: number | null): string {
  return NUMBER_FORMATTER.format(value ?? 0);
}

export function formatSignedCredits(value?: number | null): string {
  const resolved = value ?? 0;
  return `${resolved > 0 ? '+' : ''}${NUMBER_FORMATTER.format(resolved)}`;
}

export function formatMoney(cents?: number | null): string {
  return MONEY_FORMATTER.format((cents ?? 0) / 100);
}

export function formatBillingDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : DATE_FORMATTER.format(date);
}

export function billingLabel(value?: string | null): string {
  if (!value) return '未知';
  return LABELS[value] ?? value;
}

export function billingTone(value?: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (['active', 'paid', 'recharge', 'settle', 'released'].includes(value ?? '')) return 'success';
  if (['pending', 'draft', 'refund_pending', 'reserve', 'manual_review'].includes(value ?? '')) {
    return 'warning';
  }
  if (
    [
      'locked',
      'disabled',
      'inactive',
      'closed',
      'rejected',
      'expired',
      'stale',
      'reversal',
    ].includes(value ?? '')
  ) {
    return 'danger';
  }
  return 'neutral';
}
