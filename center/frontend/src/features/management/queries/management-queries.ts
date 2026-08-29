import { useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import {
  getManagementDashboard,
  getManagementTenant,
  getManagementUsers,
} from '@/features/management/api/management-api';
import type { UserQueryFilters } from '@/features/management/types';

export const managementQueryKeys = {
  root: ['management'] as const,
  dashboard: () => [...managementQueryKeys.root, 'dashboard'] as const,
  users: (filters: UserQueryFilters) => [...managementQueryKeys.root, 'users', filters] as const,
  tenant: () => [...managementQueryKeys.root, 'tenant'] as const,
};

export function useManagementDashboardQuery() {
  return useQuery({
    queryKey: managementQueryKeys.dashboard(),
    queryFn: getManagementDashboard,
  });
}

export function useManagementUsersQuery(filters: MaybeRefOrGetter<UserQueryFilters>) {
  const resolvedFilters = computed(() => toValue(filters));
  return useQuery({
    queryKey: computed(() => managementQueryKeys.users(resolvedFilters.value)),
    queryFn: () => getManagementUsers(resolvedFilters.value),
    placeholderData: (previousData) => previousData,
  });
}

export function useManagementTenantQuery() {
  return useQuery({
    queryKey: managementQueryKeys.tenant(),
    queryFn: getManagementTenant,
  });
}
