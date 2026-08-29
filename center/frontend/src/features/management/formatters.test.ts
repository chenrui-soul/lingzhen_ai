import { formatDateTime, statusLabel, statusTone } from '@/features/management/formatters';

describe('management formatters', () => {
  it('formats known states into readable labels and tones', () => {
    expect(statusLabel('active')).toBe('正常');
    expect(statusTone('active')).toBe('success');
    expect(statusLabel('suspended')).toBe('已暂停');
    expect(statusTone('suspended')).toBe('danger');
  });

  it('handles missing and invalid dates without rendering Invalid Date', () => {
    expect(formatDateTime()).toBe('暂无记录');
    expect(formatDateTime('not-a-date')).toBe('时间未知');
  });
});
