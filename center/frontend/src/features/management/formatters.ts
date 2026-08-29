const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  invited: '待加入',
  suspended: '已暂停',
  removed: '已移除',
  pending: '待激活',
  locked: '已锁定',
  disabled: '已禁用',
  closed: '已关闭',
};

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return '暂无记录';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : DATE_TIME_FORMATTER.format(date);
}

export function statusLabel(status?: string | null): string {
  if (!status) {
    return '未知';
  }
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status?: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'invited' || status === 'pending') {
    return 'warning';
  }
  if (
    status === 'suspended' ||
    status === 'locked' ||
    status === 'disabled' ||
    status === 'closed'
  ) {
    return 'danger';
  }
  return 'neutral';
}
