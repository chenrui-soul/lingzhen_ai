export interface CursorPage<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface CreditQueryFilters {
  cursor?: string;
  limit: number;
  keyword?: string;
  filter?: string;
}

export interface CreditWalletItem {
  userId: string;
  username: string;
  email: string;
  userStatus: string;
  availableBalance: number;
  reservedBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface RechargeOrderItem {
  id: string;
  orderNo: string;
  userId: string;
  username: string;
  email: string;
  packageCode: string;
  cashAmountCents: number;
  creditAmount: number;
  bonusCredits: number;
  paymentChannel: string;
  status: string;
  expiresAt: string;
  paidAt?: string | null;
  closedAt?: string | null;
  submissionNote?: string | null;
  reviewReason?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RechargePackage {
  id: string;
  code: string;
  displayName: string;
  cashAmountCents: number;
  creditAmount: number;
  bonusCredits: number;
  status: 'draft' | 'active' | 'inactive';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface RechargePackageList {
  items: RechargePackage[];
}

export interface CreateRechargePackageRequest {
  code: string;
  displayName: string;
  cashAmountCents: number;
  creditAmount: number;
  bonusCredits: number;
  sortOrder: number;
}

export interface UpdateRechargePackageRequest {
  displayName: string;
  cashAmountCents: number;
  creditAmount: number;
  bonusCredits: number;
  status: RechargePackage['status'];
  sortOrder: number;
  rowVersion: number;
}

export type SandboxPaymentOutcome = 'paid' | 'failed' | 'cancelled';

export interface SandboxPaymentSimulationRequest {
  outcome: SandboxPaymentOutcome;
  eventId: string;
  cashAmountCents?: number;
}

export interface SandboxPaymentSimulationResponse {
  result: 'paid' | 'failed' | 'cancelled' | 'expired' | 'closed';
  idempotentReplay: boolean;
  availableBalance?: number | null;
  order: {
    id: string;
    orderNo: string;
    packageId: string;
    packageCode: string;
    cashAmountCents: number;
    creditAmount: number;
    bonusCredits: number;
    paymentChannel: string;
    status: string;
    expiresAt: string;
    paidAt?: string | null;
    closedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    idempotentReplay: boolean;
  };
}

export interface ManualRechargeReviewResponse {
  result: 'approved' | 'rejected';
  idempotentReplay: boolean;
  availableBalance?: number | null;
  order: {
    id: string;
    orderNo: string;
    paymentChannel: string;
    status: string;
    reviewReason?: string | null;
    reviewedAt?: string | null;
    paidAt?: string | null;
    closedAt?: string | null;
  };
}

export interface AdminCreditGrantRequest {
  userId: string;
  credits: number;
  reason: string;
  idempotencyKey: string;
}

export interface AdminCreditGrantResponse {
  result: string;
  idempotentReplay: boolean;
  availableBalance: number;
  reservedBalance: number;
}

export interface CreditLedgerItem {
  id: string;
  userId: string;
  username: string;
  email: string;
  tenantId?: string | null;
  tenantName?: string | null;
  entryType: string;
  availableDelta: number;
  reservedDelta: number;
  availableAfter: number;
  reservedAfter: number;
  businessType: string;
  businessId: string;
  reason?: string | null;
  createdAt: string;
}

export interface CreditReservationAnomalyItem {
  id: string;
  userId: string;
  username: string;
  email: string;
  tenantId: string;
  tenantName: string;
  taskId: string;
  attemptId: string;
  reservedCredits: number;
  settledCredits: number;
  releasedCredits: number;
  status: string;
  anomalyType: string;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreditWalletPage = CursorPage<CreditWalletItem>;
export type RechargeOrderPage = CursorPage<RechargeOrderItem>;
export type CreditLedgerPage = CursorPage<CreditLedgerItem>;
export type CreditReservationAnomalyPage = CursorPage<CreditReservationAnomalyItem>;
