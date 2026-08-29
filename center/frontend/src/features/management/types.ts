import type { components } from '@/api/generated/schema';

export type ManagementDashboardResponse = components['schemas']['ManagementDashboardResponse'];
export type ManagementUserPageResponse = components['schemas']['ManagementUserPageResponse'];
export type ManagementTenantResponse = components['schemas']['ManagementTenantResponse'];
export type ManagementUserItem = components['schemas']['UserItem'];

export interface UserQueryFilters {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}
