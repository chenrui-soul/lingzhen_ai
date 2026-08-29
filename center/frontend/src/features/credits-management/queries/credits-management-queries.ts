import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import {
  approveManualRecharge,
  createRechargePackage,
  getCreditLedger,
  getCreditWallets,
  getRechargePackages,
  getRechargeOrders,
  getReservationAnomalies,
  grantAdminCredits,
  rejectManualRecharge,
  simulateSandboxPayment,
  updateRechargePackage,
} from '@/features/credits-management/api/credits-management-api';
import type {
  CreateRechargePackageRequest,
  CreditQueryFilters,
  SandboxPaymentSimulationRequest,
  UpdateRechargePackageRequest,
  AdminCreditGrantRequest,
} from '@/features/credits-management/types';

export const creditsManagementQueryKeys = {
  root: ['credits-management'] as const,
  wallets: (filters: CreditQueryFilters) =>
    [...creditsManagementQueryKeys.root, 'wallets', filters] as const,
  orders: (filters: CreditQueryFilters) =>
    [...creditsManagementQueryKeys.root, 'orders', filters] as const,
  ledger: (filters: CreditQueryFilters) =>
    [...creditsManagementQueryKeys.root, 'ledger', filters] as const,
  anomalies: (filters: CreditQueryFilters) =>
    [...creditsManagementQueryKeys.root, 'anomalies', filters] as const,
  packages: () => [...creditsManagementQueryKeys.root, 'packages'] as const,
};

function queryOptions<T>(
  keyFactory: (filters: CreditQueryFilters) => readonly unknown[],
  queryFn: (filters: CreditQueryFilters) => Promise<T>,
  filters: MaybeRefOrGetter<CreditQueryFilters>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const resolvedFilters = computed(() => toValue(filters));
  return useQuery({
    queryKey: computed(() => keyFactory(resolvedFilters.value)),
    queryFn: () => queryFn(resolvedFilters.value),
    enabled: computed(() => toValue(enabled)),
    placeholderData: (previousData) => previousData,
  });
}

export function useCreditWalletsQuery(
  filters: MaybeRefOrGetter<CreditQueryFilters>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  return queryOptions(creditsManagementQueryKeys.wallets, getCreditWallets, filters, enabled);
}

export function useRechargeOrdersQuery(
  filters: MaybeRefOrGetter<CreditQueryFilters>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  return queryOptions(creditsManagementQueryKeys.orders, getRechargeOrders, filters, enabled);
}

export function useCreditLedgerQuery(
  filters: MaybeRefOrGetter<CreditQueryFilters>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  return queryOptions(creditsManagementQueryKeys.ledger, getCreditLedger, filters, enabled);
}

export function useReservationAnomaliesQuery(
  filters: MaybeRefOrGetter<CreditQueryFilters>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  return queryOptions(
    creditsManagementQueryKeys.anomalies,
    getReservationAnomalies,
    filters,
    enabled,
  );
}

export function useRechargePackagesQuery(enabled: MaybeRefOrGetter<boolean> = true) {
  return useQuery({
    queryKey: creditsManagementQueryKeys.packages(),
    queryFn: getRechargePackages,
    enabled: computed(() => toValue(enabled)),
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

function useCreditsWriteInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: creditsManagementQueryKeys.root });
}

export function useCreateRechargePackageMutation() {
  const invalidate = useCreditsWriteInvalidation();
  return useMutation({
    mutationFn: (request: CreateRechargePackageRequest) => createRechargePackage(request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useUpdateRechargePackageMutation() {
  const invalidate = useCreditsWriteInvalidation();
  return useMutation({
    mutationFn: ({
      packageId,
      request,
    }: {
      packageId: string;
      request: UpdateRechargePackageRequest;
    }) => updateRechargePackage(packageId, request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useSandboxPaymentMutation() {
  const invalidate = useCreditsWriteInvalidation();
  return useMutation({
    mutationFn: ({
      orderId,
      request,
    }: {
      orderId: string;
      request: SandboxPaymentSimulationRequest;
    }) => simulateSandboxPayment(orderId, request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useManualRechargeApproveMutation() {
  const invalidate = useCreditsWriteInvalidation();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      approveManualRecharge(orderId, reason),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useManualRechargeRejectMutation() {
  const invalidate = useCreditsWriteInvalidation();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      rejectManualRecharge(orderId, reason),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}

export function useAdminCreditGrantMutation() {
  const invalidate = useCreditsWriteInvalidation();
  return useMutation({
    mutationFn: (request: AdminCreditGrantRequest) => grantAdminCredits(request),
    onSuccess: invalidate,
    retry: false,
    meta: { handlesErrorLocally: true },
  });
}
