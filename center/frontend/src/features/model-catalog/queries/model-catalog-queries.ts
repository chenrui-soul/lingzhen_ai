import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

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
import type {
  CatalogPublishRequest,
  CreateCatalogModelRequest,
  CreateModelProviderRequest,
  ModelQueryFilters,
  UpdateCatalogModelRequest,
  UpdateModelProviderRequest,
  UpdateTenantModelPolicyRequest,
} from '@/features/model-catalog/types';

export const modelCatalogQueryKeys = {
  root: ['model-catalog'] as const,
  providers: () => [...modelCatalogQueryKeys.root, 'providers'] as const,
  models: (filters: ModelQueryFilters) =>
    [...modelCatalogQueryKeys.root, 'models', filters] as const,
  versions: () => [...modelCatalogQueryKeys.root, 'versions'] as const,
  publishPreview: () => [...modelCatalogQueryKeys.root, 'publish-preview'] as const,
  tenantModels: () => [...modelCatalogQueryKeys.root, 'tenant-models'] as const,
};

export function useModelProvidersQuery() {
  return useQuery({
    queryKey: modelCatalogQueryKeys.providers(),
    queryFn: () => getModelProviders(),
    staleTime: 60_000,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useCatalogModelsQuery(filters: MaybeRefOrGetter<ModelQueryFilters>) {
  const resolvedFilters = computed(() => toValue(filters));
  return useQuery({
    queryKey: computed(() => modelCatalogQueryKeys.models(resolvedFilters.value)),
    queryFn: () => getCatalogModels(resolvedFilters.value),
    placeholderData: (previousData) => previousData,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useCatalogVersionsQuery() {
  return useQuery({
    queryKey: modelCatalogQueryKeys.versions(),
    queryFn: () => getCatalogVersions(),
    staleTime: 30_000,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useCatalogPublishPreviewQuery(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: modelCatalogQueryKeys.publishPreview(),
    queryFn: getCatalogPublishPreview,
    enabled: computed(() => toValue(enabled)),
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useTenantModelsQuery() {
  return useQuery({
    queryKey: modelCatalogQueryKeys.tenantModels(),
    queryFn: getTenantModels,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

function useCatalogWriteInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: modelCatalogQueryKeys.providers() }),
      queryClient.invalidateQueries({ queryKey: modelCatalogQueryKeys.root }),
    ]);
}

export function useCreateModelProviderMutation() {
  const invalidate = useCatalogWriteInvalidation();
  return useMutation({
    mutationFn: (request: CreateModelProviderRequest) => createModelProvider(request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useUpdateModelProviderMutation() {
  const invalidate = useCatalogWriteInvalidation();
  return useMutation({
    mutationFn: ({
      providerId,
      request,
    }: {
      providerId: string;
      request: UpdateModelProviderRequest;
    }) => updateModelProvider(providerId, request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useCreateCatalogModelMutation() {
  const invalidate = useCatalogWriteInvalidation();
  return useMutation({
    mutationFn: (request: CreateCatalogModelRequest) => createCatalogModel(request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useUpdateCatalogModelMutation() {
  const invalidate = useCatalogWriteInvalidation();
  return useMutation({
    mutationFn: ({ modelId, request }: { modelId: string; request: UpdateCatalogModelRequest }) =>
      updateCatalogModel(modelId, request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function usePublishCatalogMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      idempotencyKey,
    }: {
      request: CatalogPublishRequest;
      idempotencyKey: string;
    }) => publishCatalog(request, idempotencyKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: modelCatalogQueryKeys.root }),
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useUpdateTenantModelPolicyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      modelId,
      request,
    }: {
      modelId: string;
      request: UpdateTenantModelPolicyRequest;
    }) => updateTenantModelPolicy(modelId, request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: modelCatalogQueryKeys.root }),
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}
