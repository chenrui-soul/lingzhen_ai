import type { components } from '@/api/generated/schema';

export type AuthResponse = components['schemas']['AuthResponse'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type MeResponse = components['schemas']['MeResponse'];
export type SelectTenantRequest = components['schemas']['SelectTenantRequest'];

export interface TenantOption {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  role: string;
}

export interface TenantSelectionResponse {
  status: 'tenant_selection_required';
  tenantSelectionTicket: string;
  expiresAt: string;
  tenants: TenantOption[];
}

export type LoginResponse = AuthResponse | TenantSelectionResponse;

export function isTenantSelectionResponse(
  response: LoginResponse,
): response is TenantSelectionResponse {
  return response.status === 'tenant_selection_required';
}
