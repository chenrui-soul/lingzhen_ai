import { httpClient } from '@/api/http-client';
import type {
  CatalogPublishPreview,
  CatalogPublishRequest,
  CatalogPublishResponse,
  CatalogVersionPageResponse,
  CatalogModel,
  CreateCatalogModelRequest,
  CreateModelProviderRequest,
  ModelProvider,
  ModelPageResponse,
  ModelProviderPageResponse,
  ModelQueryFilters,
  TenantModelListResponse,
  TenantModelPolicyResponse,
  UpdateCatalogModelRequest,
  UpdateModelProviderRequest,
  UpdateTenantModelPolicyRequest,
} from '@/features/model-catalog/types';

export async function getModelProviders(
  page = 1,
  pageSize = 100,
): Promise<ModelProviderPageResponse> {
  const response = await httpClient.get<ModelProviderPageResponse>(
    '/management/model-catalog/providers',
    { params: { page, pageSize } },
  );
  return response.data;
}

export async function getCatalogModels(filters: ModelQueryFilters): Promise<ModelPageResponse> {
  const response = await httpClient.get<ModelPageResponse>('/management/model-catalog/models', {
    params: {
      page: filters.page,
      pageSize: filters.pageSize,
      keyword: filters.keyword || undefined,
      status: filters.status || 'all',
      capabilityType: filters.capabilityType || 'all',
      providerId: filters.providerId || undefined,
    },
  });
  return response.data;
}

export async function getCatalogVersions(
  page = 1,
  pageSize = 1,
): Promise<CatalogVersionPageResponse> {
  const response = await httpClient.get<CatalogVersionPageResponse>(
    '/management/model-catalog/versions',
    { params: { page, pageSize } },
  );
  return response.data;
}

export async function getCatalogPublishPreview(): Promise<CatalogPublishPreview> {
  const response = await httpClient.get<CatalogPublishPreview>(
    '/management/model-catalog/publish-preview',
  );
  return response.data;
}

export async function publishCatalog(
  request: CatalogPublishRequest,
  idempotencyKey: string,
): Promise<CatalogPublishResponse> {
  const response = await httpClient.post<CatalogPublishResponse>(
    '/management/model-catalog/versions/publish',
    request,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return response.data;
}

export async function getTenantModels(): Promise<TenantModelListResponse> {
  const response = await httpClient.get<TenantModelListResponse>('/management/tenant-models');
  return response.data;
}

export async function updateTenantModelPolicy(
  modelId: string,
  request: UpdateTenantModelPolicyRequest,
): Promise<TenantModelPolicyResponse> {
  const response = await httpClient.put<TenantModelPolicyResponse>(
    `/management/tenant-models/${modelId}`,
    request,
  );
  return response.data;
}

export async function createModelProvider(
  request: CreateModelProviderRequest,
): Promise<ModelProvider> {
  const response = await httpClient.post<ModelProvider>(
    '/management/model-catalog/providers',
    request,
  );
  return response.data;
}

export async function updateModelProvider(
  providerId: string,
  request: UpdateModelProviderRequest,
): Promise<ModelProvider> {
  const response = await httpClient.put<ModelProvider>(
    `/management/model-catalog/providers/${providerId}`,
    request,
  );
  return response.data;
}

export async function createCatalogModel(
  request: CreateCatalogModelRequest,
): Promise<CatalogModel> {
  const response = await httpClient.post<CatalogModel>('/management/model-catalog/models', request);
  return response.data;
}

export async function updateCatalogModel(
  modelId: string,
  request: UpdateCatalogModelRequest,
): Promise<CatalogModel> {
  const response = await httpClient.put<CatalogModel>(
    `/management/model-catalog/models/${modelId}`,
    request,
  );
  return response.data;
}
