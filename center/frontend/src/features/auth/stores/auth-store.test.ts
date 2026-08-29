import { createPinia, setActivePinia } from 'pinia';

import { getAccessToken } from '@/api/auth-session';
import { useAuthStore } from '@/features/auth/stores/auth-store';
import * as authApi from '@/features/auth/api/auth-api';
import * as deviceIdentity from '@/utils/device-identity';

const device = {
  deviceHash: 'a'.repeat(64),
  fingerprintVersion: 1,
  displayName: '测试浏览器',
  platform: 'test',
  architecture: 'browser',
  appVersion: '1.0.0',
};

const currentUser = {
  userId: '10000000-0000-0000-0000-000000000001',
  username: 'operator',
  email: 'operator@example.com',
  tenantId: '20000000-0000-0000-0000-000000000001',
  tenantCode: 'team-a',
  tenantName: '灵帧团队',
  membershipId: '30000000-0000-0000-0000-000000000001',
  sessionId: '40000000-0000-0000-0000-000000000001',
  deviceId: '50000000-0000-0000-0000-000000000001',
  clientType: 'management_web' as const,
  role: 'owner',
  permissions: ['management.probe'],
  featurePolicies: {},
  sessionExpiresAt: '2026-08-26T00:00:00Z',
};

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(deviceIdentity, 'createManagementDevice').mockResolvedValue(device);
  });

  it('authenticates a management user and keeps the token in memory', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      status: 'authenticated',
      accessToken: 'access-token',
    });
    vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(currentUser);
    const store = useAuthStore();

    const result = await store.login(' operator@example.com ', 'safe-password');

    expect(result).toBe('authenticated');
    expect(store.isAuthenticated).toBe(true);
    expect(store.currentUser).toEqual(currentUser);
    expect(getAccessToken()).toBe('access-token');
    expect(authApi.login).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'operator@example.com',
        clientType: 'management_web',
        device,
      }),
    );
  });

  it('pauses at tenant selection when multiple memberships are returned', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      status: 'tenant_selection_required',
      tenantSelectionTicket: 'ticket',
      expiresAt: '2026-08-25T12:00:00Z',
      tenants: [
        {
          tenantId: '20000000-0000-0000-0000-000000000001',
          tenantCode: 'team-a',
          tenantName: '灵帧团队',
          role: 'owner',
        },
      ],
    });
    const store = useAuthStore();

    const result = await store.login('operator@example.com', 'safe-password');

    expect(result).toBe('tenant-selection-required');
    expect(store.isAuthenticated).toBe(false);
    expect(store.tenantSelection?.tenants).toHaveLength(1);
  });

  it('treats an expired bootstrap session as anonymous', async () => {
    vi.spyOn(authApi, 'getCurrentUser').mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { message: '登录会话无效或已过期' } },
    });
    const store = useAuthStore();

    await store.bootstrap();

    expect(store.status).toBe('anonymous');
    expect(store.lastError).toBeNull();
  });
});
