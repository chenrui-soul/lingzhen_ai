import { httpClient } from '@/api/http-client';
import type {
  CreditLedgerPage,
  CreditQueryFilters,
  CreditReservationAnomalyPage,
  CreditWalletPage,
  ManualRechargeReviewResponse,
  AdminCreditGrantRequest,
  AdminCreditGrantResponse,
  CreateRechargePackageRequest,
  RechargePackage,
  RechargePackageList,
  RechargeOrderPage,
  SandboxPaymentSimulationRequest,
  SandboxPaymentSimulationResponse,
  UpdateRechargePackageRequest,
} from '@/features/credits-management/types';

function pageParams(filters: CreditQueryFilters) {
  return {
    cursor: filters.cursor || undefined,
    limit: filters.limit,
    keyword: filters.keyword || undefined,
  };
}

export async function getCreditWallets(filters: CreditQueryFilters): Promise<CreditWalletPage> {
  const response = await httpClient.get<CreditWalletPage>('/management/credits/wallets', {
    params: { ...pageParams(filters), status: filters.filter || 'all' },
  });
  return response.data;
}

export async function getRechargeOrders(filters: CreditQueryFilters): Promise<RechargeOrderPage> {
  const response = await httpClient.get<RechargeOrderPage>('/management/credits/orders', {
    params: { ...pageParams(filters), status: filters.filter || 'all' },
  });
  return response.data;
}

export async function getCreditLedger(filters: CreditQueryFilters): Promise<CreditLedgerPage> {
  const response = await httpClient.get<CreditLedgerPage>('/management/credits/ledger', {
    params: { ...pageParams(filters), entryType: filters.filter || 'all' },
  });
  return response.data;
}

export async function getReservationAnomalies(
  filters: CreditQueryFilters,
): Promise<CreditReservationAnomalyPage> {
  const response = await httpClient.get<CreditReservationAnomalyPage>(
    '/management/credits/reservations/anomalies',
    { params: { ...pageParams(filters), anomalyType: filters.filter || 'all' } },
  );
  return response.data;
}

export async function getRechargePackages(): Promise<RechargePackageList> {
  const response = await httpClient.get<RechargePackageList>('/management/credits/packages');
  return response.data;
}

export async function createRechargePackage(
  request: CreateRechargePackageRequest,
): Promise<RechargePackage> {
  const response = await httpClient.post<RechargePackage>('/management/credits/packages', request);
  return response.data;
}

export async function updateRechargePackage(
  packageId: string,
  request: UpdateRechargePackageRequest,
): Promise<RechargePackage> {
  const response = await httpClient.put<RechargePackage>(
    `/management/credits/packages/${packageId}`,
    request,
  );
  return response.data;
}

export async function simulateSandboxPayment(
  orderId: string,
  request: SandboxPaymentSimulationRequest,
): Promise<SandboxPaymentSimulationResponse> {
  const response = await httpClient.post<SandboxPaymentSimulationResponse>(
    `/management/credits/sandbox/orders/${orderId}/events`,
    request,
  );
  return response.data;
}

export async function approveManualRecharge(
  orderId: string,
  reason: string,
): Promise<ManualRechargeReviewResponse> {
  const response = await httpClient.post<ManualRechargeReviewResponse>(
    `/management/credits/manual/orders/${orderId}/approve`,
    { reason },
  );
  return response.data;
}

export async function rejectManualRecharge(
  orderId: string,
  reason: string,
): Promise<ManualRechargeReviewResponse> {
  const response = await httpClient.post<ManualRechargeReviewResponse>(
    `/management/credits/manual/orders/${orderId}/reject`,
    { reason },
  );
  return response.data;
}

export async function grantAdminCredits(
  request: AdminCreditGrantRequest,
): Promise<AdminCreditGrantResponse> {
  const response = await httpClient.post<AdminCreditGrantResponse>('/management/credits/grants', request);
  return response.data;
}
