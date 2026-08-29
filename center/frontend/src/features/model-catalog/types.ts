export interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProviderSummary {
  id: string;
  code: string;
  displayName: string;
}

export interface ModelProvider extends ProviderSummary {
  protocolFamily: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export type ModelProviderPageResponse = PageResponse<ModelProvider>;

export interface CatalogModel {
  id: string;
  provider: ProviderSummary;
  code: string;
  displayName: string;
  capabilityType: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  defaultParameters: Record<string, unknown>;
  defaultTenantEnabled: boolean;
  sortOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  baseUrl?: string | null;
  apiKeyConfigured?: boolean;
  submitPath?: string | null;
  statusPath?: string | null;
  cancelPath?: string | null;
  timeoutSeconds?: number;
  runtimeEnabled?: boolean;
  runtimeRowVersion?: number;
  baseCredits: number;
  maxReserveCredits: number;
  priceRowVersion: number;
}

export type ModelPageResponse = PageResponse<CatalogModel>;

export interface CatalogVersion {
  id: string;
  version: number;
  current: boolean;
  contentHash: string;
  publishedByUserId: string;
  publishedByMembershipId: string;
  publishedAt: string;
  createdAt: string;
  modelCount: number;
}

export type CatalogVersionPageResponse = PageResponse<CatalogVersion>;

export interface CatalogPublishBlocker {
  code: string;
  message: string;
}

export interface CatalogPublishPreview {
  currentVersion: number | null;
  currentPublishedAt: string | null;
  nextVersion: number;
  modelCount: number;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  hasChanges: boolean;
  canPublish: boolean;
  contentHash: string;
  blockers: CatalogPublishBlocker[];
}

export interface CatalogPublishRequest {
  expectedCurrentVersion: number | null;
  expectedContentHash: string;
}

export interface CatalogPublishResponse {
  versionId: string;
  version: number;
  current: boolean;
  modelCount: number;
  publishedAt: string;
  idempotentReplay: boolean;
}

export type TenantModelPolicy = 'inherit' | 'enabled' | 'hidden';

export interface TenantModel {
  policyId: string | null;
  modelId: string;
  provider: ProviderSummary;
  code: string;
  displayName: string;
  capabilityType: string;
  parameterSchema: Record<string, unknown>;
  defaultParameters: Record<string, unknown>;
  defaultTenantEnabled: boolean;
  policy: TenantModelPolicy;
  effectiveEnabled: boolean;
  rowVersion: number | null;
}

export interface TenantModelListResponse {
  available: boolean;
  catalogVersion: number | null;
  publishedAt: string | null;
  models: TenantModel[];
}

export interface UpdateTenantModelPolicyRequest {
  policy: TenantModelPolicy;
  rowVersion: number | null;
}

export interface TenantModelPolicyResponse {
  policyId: string | null;
  modelId: string;
  policy: TenantModelPolicy;
  effectiveEnabled: boolean;
  rowVersion: number | null;
  updatedAt: string | null;
}

export interface ModelQueryFilters {
  page: number;
  pageSize: number;
  keyword?: string;
  status: string;
  capabilityType: string;
  providerId?: string;
}

export interface CreateModelProviderRequest {
  code: string;
  displayName: string;
  protocolFamily: string;
  description: string;
}

export interface UpdateModelProviderRequest {
  displayName: string;
  protocolFamily: string;
  description: string;
  status: string;
  rowVersion: number;
}

export interface CreateCatalogModelRequest {
  providerId: string;
  code: string;
  displayName: string;
  capabilityType: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  defaultParameters: Record<string, unknown>;
  defaultTenantEnabled: boolean;
  sortOrder: number;
  baseUrl?: string;
  apiKey?: string;
  submitPath?: string;
  statusPath?: string;
  cancelPath?: string;
  timeoutSeconds?: number;
  runtimeEnabled?: boolean;
  baseCredits?: number;
  maxReserveCredits?: number;
}

export interface UpdateCatalogModelRequest extends CreateCatalogModelRequest {
  status: string;
  rowVersion: number;
  runtimeRowVersion?: number;
  priceRowVersion?: number;
}
