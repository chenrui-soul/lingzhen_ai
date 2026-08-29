import {
  capabilityLabel,
  formatCatalogDate,
  policyLabel,
  statusLabel,
  statusTone,
} from '@/features/model-catalog/formatters';

describe('model catalog formatters', () => {
  it('formats known catalog values for administrators', () => {
    expect(capabilityLabel('video')).toBe('视频生成');
    expect(statusLabel('active')).toBe('可用');
    expect(statusTone('deprecated')).toBe('warning');
    expect(policyLabel('inherit')).toBe('跟随平台');
  });

  it('keeps unknown enum values visible for diagnostics', () => {
    expect(capabilityLabel('future_capability')).toBe('future_capability');
    expect(statusLabel('future_status')).toBe('future_status');
    expect(formatCatalogDate(null)).toBe('尚未发布');
  });
});
