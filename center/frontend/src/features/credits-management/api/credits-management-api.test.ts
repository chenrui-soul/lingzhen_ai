import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { httpClient } from '@/api/http-client';
import {
  approveManualRecharge,
  createRechargePackage,
  getCreditLedger,
  getCreditWallets,
  getRechargePackages,
  getRechargeOrders,
  getReservationAnomalies,
  rejectManualRecharge,
  simulateSandboxPayment,
  updateRechargePackage,
} from '@/features/credits-management/api/credits-management-api';

const originalAdapter = httpClient.defaults.adapter;

function responseAdapter(inspect: (config: InternalAxiosRequestConfig) => void): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    inspect(config);
    const response: AxiosResponse = {
      data: { items: [], nextCursor: null },
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config,
    };
    return Promise.resolve(response);
  };
}

describe('credits management api', () => {
  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
  });

  it('uses the four management-only read endpoints', async () => {
    const urls: string[] = [];
    httpClient.defaults.adapter = responseAdapter((config) => urls.push(config.url ?? ''));

    const filters = { limit: 20, filter: 'all' };
    await getCreditWallets(filters);
    await getRechargeOrders(filters);
    await getCreditLedger(filters);
    await getReservationAnomalies(filters);

    expect(urls).toEqual([
      '/management/credits/wallets',
      '/management/credits/orders',
      '/management/credits/ledger',
      '/management/credits/reservations/anomalies',
    ]);
  });

  it('sends cursor and view-specific filters without accepting user or tenant scope', async () => {
    const requests: InternalAxiosRequestConfig[] = [];
    httpClient.defaults.adapter = responseAdapter((config) => requests.push(config));
    const filters = { cursor: 'cursor-1', limit: 100, keyword: 'alice', filter: 'paid' };

    await getCreditWallets(filters);
    await getCreditLedger({ ...filters, filter: 'recharge' });
    await getReservationAnomalies({ ...filters, filter: 'expired' });

    expect(requests[0]?.params).toEqual({
      cursor: 'cursor-1',
      limit: 100,
      keyword: 'alice',
      status: 'paid',
    });
    expect(requests[1]?.params.entryType).toBe('recharge');
    expect(requests[2]?.params.anomalyType).toBe('expired');
    for (const request of requests) {
      expect(request.params).not.toHaveProperty('userId');
      expect(request.params).not.toHaveProperty('tenantId');
    }
  });

  it('uses management package, Sandbox and manual review endpoints without tenant scope', async () => {
    const requests: InternalAxiosRequestConfig[] = [];
    httpClient.defaults.adapter = responseAdapter((config) => requests.push(config));

    await getRechargePackages();
    await createRechargePackage({
      code: 'starter_100',
      displayName: 'Starter 100',
      cashAmountCents: 990,
      creditAmount: 100,
      bonusCredits: 10,
      sortOrder: 10,
    });
    await updateRechargePackage('package-1', {
      displayName: 'Starter 110',
      cashAmountCents: 990,
      creditAmount: 100,
      bonusCredits: 10,
      status: 'active',
      sortOrder: 10,
      rowVersion: 2,
    });
    await simulateSandboxPayment('order-1', {
      outcome: 'paid',
      eventId: 'event-00000001',
      cashAmountCents: 990,
    });
    await approveManualRecharge('order-2', '已核实到账');
    await rejectManualRecharge('order-3', '未查询到款项');

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'get:/management/credits/packages',
      'post:/management/credits/packages',
      'put:/management/credits/packages/package-1',
      'post:/management/credits/sandbox/orders/order-1/events',
      'post:/management/credits/manual/orders/order-2/approve',
      'post:/management/credits/manual/orders/order-3/reject',
    ]);
    expect(JSON.parse(String(requests[2]?.data))).toMatchObject({ rowVersion: 2 });
    expect(JSON.parse(String(requests[3]?.data))).toMatchObject({
      outcome: 'paid',
      eventId: 'event-00000001',
    });
    expect(JSON.parse(String(requests[4]?.data))).toEqual({ reason: '已核实到账' });
    expect(JSON.parse(String(requests[5]?.data))).toEqual({ reason: '未查询到款项' });
    for (const request of requests) {
      const body = request.data ? JSON.parse(String(request.data)) : {};
      expect(body).not.toHaveProperty('tenantId');
      expect(body).not.toHaveProperty('userId');
    }
  });
});
