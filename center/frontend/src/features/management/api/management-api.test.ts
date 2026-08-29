import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { httpClient } from '@/api/http-client';
import {
  getManagementDashboard,
  getManagementTenant,
  getManagementUsers,
} from '@/features/management/api/management-api';

const originalAdapter = httpClient.defaults.adapter;

function responseAdapter(
  data: unknown,
  inspect?: (config: InternalAxiosRequestConfig) => void,
): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    inspect?.(config);
    const response: AxiosResponse = {
      data,
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config,
    };
    return Promise.resolve(response);
  };
}

describe('management api', () => {
  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
  });

  it('loads dashboard and tenant from the read-only management endpoints', async () => {
    const requestedUrls: string[] = [];
    httpClient.defaults.adapter = responseAdapter({}, (config) => {
      requestedUrls.push(config.url ?? '');
    });

    await getManagementDashboard();
    await getManagementTenant();

    expect(requestedUrls).toEqual(['/management/dashboard', '/management/tenant']);
  });

  it('sends user pagination and filters without a tenant id', async () => {
    let requestConfig: InternalAxiosRequestConfig | undefined;
    httpClient.defaults.adapter = responseAdapter({ items: [], total: 0 }, (config) => {
      requestConfig = config;
    });

    await getManagementUsers({ page: 2, pageSize: 20, keyword: 'alice', status: 'active' });

    expect(requestConfig?.url).toBe('/management/users');
    expect(requestConfig?.params).toEqual({
      page: 2,
      pageSize: 20,
      keyword: 'alice',
      status: 'active',
    });
    expect(requestConfig?.params).not.toHaveProperty('tenantId');
  });
});
