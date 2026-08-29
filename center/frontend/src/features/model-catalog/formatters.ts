const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const CAPABILITY_LABELS: Record<string, string> = {
  text: '文本生成',
  image: '图像生成',
  video: '视频生成',
  audio: '音频生成',
  embedding: '向量嵌入',
  multimodal: '多模态',
};

const STATUS_LABELS: Record<string, string> = {
  active: '可用',
  inactive: '停用',
  deprecated: '已弃用',
  draft: '草稿',
};

const POLICY_LABELS = {
  inherit: '跟随平台',
  enabled: '租户启用',
  hidden: '租户隐藏',
} as const;

export function formatCatalogDate(value: string | null | undefined): string {
  if (!value) return '尚未发布';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : DATE_TIME_FORMATTER.format(date);
}

export function capabilityLabel(value: string): string {
  return CAPABILITY_LABELS[value.toLowerCase()] ?? value;
}

export function statusLabel(value: string): string {
  return STATUS_LABELS[value.toLowerCase()] ?? value;
}

export function statusTone(value: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const normalized = value.toLowerCase();
  if (normalized === 'active') return 'success';
  if (normalized === 'deprecated') return 'warning';
  if (normalized === 'inactive') return 'danger';
  return 'neutral';
}

export function policyLabel(value: keyof typeof POLICY_LABELS): string {
  return POLICY_LABELS[value];
}
