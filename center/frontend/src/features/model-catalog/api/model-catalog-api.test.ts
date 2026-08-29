import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { httpClient } from '@/api/http-client';
import {
  createCatalogModel,
  createModelProvider,
  getCatalogPublishPreview,
  getCatalogModels,
  getCatalogVersions,
  getModelProviders,
  getTenantModels,
  publishCatalog,
  updateCatalogModel,
  updateModelProvider,
  updateTenantModelPolicy,
} from '@/features/model-catalog/api/model-catalog-api';

const originalAdapter = httpClient.defaults.adapter;

function responseAdapter(inspect: (config: InternalAxiosRequestConfig) => void): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    inspect(config);
    const response: AxiosResponse = {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config,
    };
    return Promise.resolve(response);
  };
}

describe('model catalog api', () => {
  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
  });

  it('uses the model catalog read endpoints', async () => {
    const urls: string[] = [];
    httpClient.defaults.adapter = responseAdapter((config) => urls.push(config.url ?? ''));

    await getModelProviders();
    await getCatalogVersions();
    await getCatalogPublishPreview();
    await getTenantModels();

    expect(urls).toEqual([
      '/management/model-catalog/providers',
      '/management/model-catalog/versions',
      '/management/model-catalog/publish-preview',
      '/management/tenant-models',
    ]);
  });

  it('publishes with an idempotency key and without tenant fields', async () => {
    let requestConfig: InternalAxiosRequestConfig | undefined;
    document.cookie = 'LZ_CSRF=catalog-publish-csrf; Path=/';
    httpClient.defaults.adapter = responseAdapter((config) => {
      requestConfig = config;
    });

    await publishCatalog(
      {
        expectedCurrentVersion: 7,
        expectedContentHash: 'a'.repeat(64),
      },
      'publish-attempt-8',
    );

    expect(requestConfig?.method).toBe('post');
    expect(requestConfig?.url).toBe('/management/model-catalog/versions/publish');
    expect(requestConfig?.headers.get('Idempotency-Key')).toBe('publish-attempt-8');
    expect(requestConfig?.headers.get('X-CSRF-Token')).toBe('catalog-publish-csrf');
    expect(JSON.parse(String(requestConfig?.data))).toEqual({
      expectedCurrentVersion: 7,
      expectedContentHash: 'a'.repeat(64),
    });
    expect(JSON.parse(String(requestConfig?.data))).not.toHaveProperty('tenantId');
    document.cookie = 'LZ_CSRF=; Max-Age=0; Path=/';
  });

  it('sends supported filters and never accepts a tenant id', async () => {
    let requestConfig: InternalAxiosRequestConfig | undefined;
    httpClient.defaults.adapter = responseAdapter((config) => {
      requestConfig = config;
    });

    await getCatalogModels({
      page: 2,
      pageSize: 20,
      keyword: 'seedance',
      status: 'active',
      capabilityType: 'video',
      providerId: 'provider-1',
    });

    expect(requestConfig?.url).toBe('/management/model-catalog/models');
    expect(requestConfig?.params).toEqual({
      page: 2,
      pageSize: 20,
      keyword: 'seedance',
      status: 'active',
      capabilityType: 'video',
      providerId: 'provider-1',
    });
    expect(requestConfig?.params).not.toHaveProperty('tenantId');
  });

  it('uses the provider write contract without tenant fields', async () => {
    const requests: InternalAxiosRequestConfig[] = [];
    document.cookie = 'LZ_CSRF=catalog-write-csrf; Path=/';
    httpClient.defaults.adapter = responseAdapter((config) => requests.push(config));

    await createModelProvider({
      code: 'volcengine',
      displayName: '火山引擎',
      protocolFamily: 'openai_compatible',
      description: '视频模型厂商',
    });
    await updateModelProvider('provider-1', {
      displayName: '火山引擎',
      protocolFamily: 'openai_compatible',
      description: '已更新',
      status: 'active',
      rowVersion: 3,
    });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['post', '/management/model-catalog/providers'],
      ['put', '/management/model-catalog/providers/provider-1'],
    ]);
    for (const request of requests) {
      expect(JSON.parse(String(request.data))).not.toHaveProperty('tenantId');
      expect(request.headers.get('X-CSRF-Token')).toBe('catalog-write-csrf');
    }
    expect(JSON.parse(String(requests[1]?.data))).toMatchObject({ rowVersion: 3 });
    document.cookie = 'LZ_CSRF=; Max-Age=0; Path=/';
  });

  it('uses rowVersion for model updates and never sends tenantId', async () => {
    const requests: InternalAxiosRequestConfig[] = [];
    httpClient.defaults.adapter = responseAdapter((config) => requests.push(config));
    const baseRequest = {
      providerId: 'provider-1',
      code: 'seedance-2.0-mini',
      displayName: 'Seedance 2.0 Mini',
      capabilityType: 'video',
      description: '视频生成模型',
      parameterSchema: { type: 'object' },
      defaultParameters: { duration: 10 },
      defaultTenantEnabled: false,
      sortOrder: 20,
    };

    await createCatalogModel(baseRequest);
    await updateCatalogModel('model-1', {
      ...baseRequest,
      status: 'inactive',
      rowVersion: 7,
    });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['post', '/management/model-catalog/models'],
      ['put', '/management/model-catalog/models/model-1'],
    ]);
    expect(JSON.parse(String(requests[0]?.data))).not.toHaveProperty('rowVersion');
    expect(JSON.parse(String(requests[1]?.data))).toMatchObject({
      status: 'inactive',
      rowVersion: 7,
    });
    expect(JSON.parse(String(requests[1]?.data))).not.toHaveProperty('tenantId');
  });

  it('writes the current tenant policy with csrf and without tenantId', async () => {
    let requestConfig: InternalAxiosRequestConfig | undefined;
    document.cookie = 'LZ_CSRF=tenant-policy-csrf; Path=/';
    httpClient.defaults.adapter = responseAdapter((config) => {
      requestConfig = config;
    });

    await updateTenantModelPolicy('model-1', {
      policy: 'enabled',
      rowVersion: null,
    });

    expect(requestConfig?.method).toBe('put');
    expect(requestConfig?.url).toBe('/management/tenant-models/model-1');
    expect(requestConfig?.headers.get('X-CSRF-Token')).toBe('tenant-policy-csrf');
    expect(JSON.parse(String(requestConfig?.data))).toEqual({
      policy: 'enabled',
      rowVersion: null,
    });
    expect(JSON.parse(String(requestConfig?.data))).not.toHaveProperty('tenantId');
    document.cookie = 'LZ_CSRF=; Max-Age=0; Path=/';
  });
});
