import {
  billingLabel,
  billingTone,
  formatBillingDate,
  formatCredits,
  formatMoney,
  formatSignedCredits,
} from '@/features/credits-management/formatters';

describe('credits management formatters', () => {
  it('formats credits, money and signed deltas for Chinese management UI', () => {
    expect(formatCredits(12345)).toBe('12,345');
    expect(formatSignedCredits(12)).toBe('+12');
    expect(formatSignedCredits(-8)).toBe('-8');
    expect(formatMoney(990)).toContain('9.90');
  });

  it('maps audit states and keeps invalid timestamps safe', () => {
    expect(billingLabel('manual_review')).toBe('人工核对');
    expect(billingTone('expired')).toBe('danger');
    expect(formatBillingDate('invalid')).toBe('时间未知');
  });
});
