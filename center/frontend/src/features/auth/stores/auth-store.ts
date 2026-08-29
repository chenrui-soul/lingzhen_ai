import { defineStore } from 'pinia';

import { clearSessionSecrets, setAccessToken } from '@/api/auth-session';
import { AppError, toAppError } from '@/api/errors';
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  selectTenant as selectTenantRequest,
} from '@/features/auth/api/auth-api';
import {
  isTenantSelectionResponse,
  type AuthResponse,
  type MeResponse,
  type TenantSelectionResponse,
} from '@/features/auth/types';
import { createManagementDevice } from '@/utils/device-identity';

export type AuthStatus = 'idle' | 'checking' | 'authenticated' | 'anonymous';
export type LoginResult = 'authenticated' | 'tenant-selection-required';

interface AuthState {
  status: AuthStatus;
  currentUser: MeResponse | null;
  tenantSelection: TenantSelectionResponse | null;
  lastError: AppError | null;
}

function requireAccessToken(response: AuthResponse): string {
  if (!response.accessToken) {
    throw new AppError({
      title: '登录响应不完整',
      message: '服务未返回可用的访问凭据，请联系管理员检查认证服务。',
      code: 'MISSING_ACCESS_TOKEN',
    });
  }
  return response.accessToken;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    status: 'idle',
    currentUser: null,
    tenantSelection: null,
    lastError: null,
  }),
  getters: {
    isAuthenticated: (state): boolean => state.status === 'authenticated',
    displayName: (state): string => state.currentUser?.username ?? '管理用户',
    tenantName: (state): string => state.currentUser?.tenantName ?? '未选择租户',
  },
  actions: {
    async bootstrap(): Promise<void> {
      if (this.status === 'checking' || this.status === 'authenticated') {
        return;
      }

      this.status = 'checking';
      this.lastError = null;
      try {
        this.currentUser = await getCurrentUser();
        this.status = 'authenticated';
      } catch (error) {
        const appError = toAppError(error);
        clearSessionSecrets();
        this.currentUser = null;
        this.status = 'anonymous';
        if (appError.status !== 401) {
          this.lastError = appError;
        }
      }
    },

    async login(identity: string, password: string): Promise<LoginResult> {
      this.lastError = null;
      this.tenantSelection = null;
      try {
        const device = await createManagementDevice();
        const response = await loginRequest({
          identity: identity.trim(),
          password,
          clientType: 'management_web',
          device,
        });

        if (isTenantSelectionResponse(response)) {
          this.tenantSelection = response;
          return 'tenant-selection-required';
        }

        setAccessToken(requireAccessToken(response));
        this.currentUser = await getCurrentUser();
        this.status = 'authenticated';
        return 'authenticated';
      } catch (error) {
        this.lastError = toAppError(error);
        throw this.lastError;
      }
    },

    async selectTenant(tenantId: string): Promise<void> {
      if (!this.tenantSelection) {
        throw new AppError({
          title: '租户选择已失效',
          message: '请返回登录页重新登录。',
          code: 'TENANT_SELECTION_MISSING',
        });
      }

      try {
        const response = await selectTenantRequest({
          tenantSelectionTicket: this.tenantSelection.tenantSelectionTicket,
          tenantId,
          device: await createManagementDevice(),
        });
        setAccessToken(requireAccessToken(response));
        this.currentUser = await getCurrentUser();
        this.tenantSelection = null;
        this.status = 'authenticated';
      } catch (error) {
        this.lastError = toAppError(error);
        throw this.lastError;
      }
    },

    cancelTenantSelection(): void {
      this.tenantSelection = null;
      this.lastError = null;
    },

    expireSession(): void {
      clearSessionSecrets();
      this.currentUser = null;
      this.tenantSelection = null;
      this.status = 'anonymous';
    },

    async logout(): Promise<void> {
      try {
        await logoutRequest();
      } finally {
        this.expireSession();
      }
    },
  },
});
