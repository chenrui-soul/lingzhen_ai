import { httpClient } from '@/api/http-client';
import type {
  ManagementDashboardResponse,
  ManagementTenantResponse,
  ManagementUserPageResponse,
  UserQueryFilters,
} from '@/features/management/types';

export async function getManagementDashboard(): Promise<ManagementDashboardResponse> {
  const response = await httpClient.get<ManagementDashboardResponse>('/management/dashboard');
  return response.data;
}

export async function getManagementUsers(
  filters: UserQueryFilters,
): Promise<ManagementUserPageResponse> {
  const response = await httpClient.get<ManagementUserPageResponse>('/management/users', {
    params: {
      page: filters.page,
      pageSize: filters.pageSize,
      keyword: filters.keyword || undefined,
      status: filters.status || 'all',
    },
  });
  return response.data;
}

export async function getManagementTenant(): Promise<ManagementTenantResponse> {
  const response = await httpClient.get<ManagementTenantResponse>('/management/tenant');
  return response.data;
}
