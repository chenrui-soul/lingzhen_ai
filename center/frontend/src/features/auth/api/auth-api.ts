import { httpClient } from '@/api/http-client';
import type {
  AuthResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  SelectTenantRequest,
} from '@/features/auth/types';

export async function login(request: LoginRequest): Promise<LoginResponse> {
  const response = await httpClient.post<LoginResponse>('/auth/login', request);
  return response.data;
}

export async function selectTenant(request: SelectTenantRequest): Promise<AuthResponse> {
  const response = await httpClient.post<AuthResponse>('/auth/select-tenant', request);
  return response.data;
}

export async function getCurrentUser(): Promise<MeResponse> {
  const response = await httpClient.get<MeResponse>('/auth/me');
  return response.data;
}

export async function logout(): Promise<void> {
  await httpClient.post('/auth/logout');
}
