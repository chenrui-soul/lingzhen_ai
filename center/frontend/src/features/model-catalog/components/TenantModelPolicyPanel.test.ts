import { fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { ref } from 'vue';

import { AppError } from '@/api/errors';
import { useAuthStore } from '@/features/auth/stores/auth-store';
import TenantModelPolicyPanel from '@/features/model-catalog/components/TenantModelPolicyPanel.vue';
import type { TenantModel, TenantModelListResponse } from '@/features/model-catalog/types';

const queryMocks = vi.hoisted(() => ({
  tenantModels: vi.fn(),
  updatePolicy: vi.fn(),
}));

vi.mock('@/features/model-catalog/queries/model-catalog-queries', () => ({
  useTenantModelsQuery: queryMocks.tenantModels,
  useUpdateTenantModelPolicyMutation: queryMocks.updatePolicy,
}));

const baseModel: TenantModel = {
  policyId: null,
  modelId: 'model-1',
  provider: { id: 'provider-1', code: 'doubao', displayName: '豆包' },
  code: 'seedance-2.0-fast',
  displayName: 'Seedance 2.0 Fast',
  capabilityType: 'video',
  parameterSchema: {},
  defaultParameters: {},
  defaultTenantEnabled: true,
  policy: 'inherit',
  effectiveEnabled: true,
  rowVersion: null,
};

let pinia: Pinia;
let refetch: ReturnType<typeof vi.fn>;
let mutateAsync: ReturnType<typeof vi.fn>;

function catalog(models: TenantModel[] = [baseModel]): TenantModelListResponse {
  return {
    available: true,
    catalogVersion: 7,
    publishedAt: '2026-08-25T02:30:00Z',
    models,
  };
}

function prepare(options?: {
  data?: TenantModelListResponse;
  permissions?: string[];
  error?: unknown;
  pending?: boolean;
}) {
  refetch = vi.fn().mockResolvedValue(undefined);
  mutateAsync = vi.fn().mockResolvedValue({});
  queryMocks.tenantModels.mockReturnValue({
    data: ref(options?.data ?? catalog()),
    error: ref(options?.error ?? null),
    isPending: ref(options?.pending ?? false),
    isFetching: ref(false),
    refetch,
  });
  queryMocks.updatePolicy.mockReturnValue({
    mutateAsync,
    isPending: ref(false),
  });

  const authStore = useAuthStore();
  authStore.currentUser = {
    userId: 'user-1',
    username: 'tenant-admin',
    tenantId: 'tenant-1',
    tenantName: '灵帧',
    permissions: options?.permissions ?? ['tenant_model.read'],
  } as typeof authStore.currentUser;
}

function renderPanel() {
  return render(TenantModelPolicyPanel, {
    global: {
      stubs: {
        AButton: { template: '<button><slot /></button>' },
        ASelect: { template: '<div />' },
      },
      plugins: [pinia],
    },
  });
}

describe('TenantModelPolicyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it('explains when no published catalog is available', () => {
    prepare({
      data: { available: false, catalogVersion: null, publishedAt: null, models: [] },
    });
    renderPanel();

    expect(screen.getByText('当前还没有发布目录')).toBeInTheDocument();
    expect(
      screen.getByText(
        '当前账号没有平台目录读取或发布权限，无法创建和发布模型目录，请联系管理员开通相应权限。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新检查' })).not.toBeInTheDocument();
  });

  it('guides platform readers to the platform catalog when no version is published', async () => {
    prepare({
      permissions: ['model_catalog.read', 'tenant_model.read'],
      data: { available: false, catalogVersion: null, publishedAt: null, models: [] },
    });
    const rendered = renderPanel();

    await fireEvent.click(screen.getByRole('button', { name: '前往平台目录' }));

    expect(rendered.emitted('goToPlatform')).toHaveLength(1);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('keeps policy controls hidden for read-only users', () => {
    prepare({
      data: catalog([
        {
          ...baseModel,
          policy: 'hidden',
          effectiveEnabled: false,
        },
      ]),
    });
    renderPanel();

    expect(screen.getByText('Seedance 2.0 Fast')).toBeInTheDocument();
    expect(screen.getByText('租户隐藏')).toBeInTheDocument();
    expect(screen.getByText('不可使用')).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Seedance 2.0 Fast 租户策略' }),
    ).not.toBeInTheDocument();
  });

  it('shows an accessible three-state control only with manage permission', () => {
    prepare({ permissions: ['tenant_model.read', 'tenant_model.manage'] });
    renderPanel();

    expect(screen.getByRole('group', { name: 'Seedance 2.0 Fast 租户策略' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继承平台' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '租户启用' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: '租户隐藏' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('sends null rowVersion for the first write and never sends tenantId', async () => {
    prepare({ permissions: ['tenant_model.read', 'tenant_model.manage'] });
    renderPanel();

    await fireEvent.click(screen.getByRole('button', { name: '租户启用' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        modelId: 'model-1',
        request: { policy: 'enabled', rowVersion: null },
      }),
    );
    const submitted = mutateAsync.mock.calls[0]?.[0];
    expect(submitted).not.toHaveProperty('tenantId');
    expect(submitted.request).not.toHaveProperty('tenantId');
    expect(await screen.findByText('策略已保存，最终状态已更新。')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '租户启用' })).toHaveFocus());
  });

  it('sends the latest rowVersion for an existing policy', async () => {
    prepare({
      permissions: ['tenant_model.read', 'tenant_model.manage'],
      data: catalog([
        {
          ...baseModel,
          policyId: 'policy-1',
          policy: 'enabled',
          rowVersion: 4,
        },
      ]),
    });
    renderPanel();

    await fireEvent.click(screen.getByRole('button', { name: '租户隐藏' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        modelId: 'model-1',
        request: { policy: 'hidden', rowVersion: 4 },
      }),
    );
  });

  it('refreshes the tenant catalog after a rowVersion conflict', async () => {
    prepare({ permissions: ['tenant_model.read', 'tenant_model.manage'] });
    mutateAsync.mockRejectedValue(
      new AppError({
        title: '数据状态已变化',
        message: '租户模型策略已被其他操作更新，请刷新后重试',
        code: 'TENANT_MODEL_ROW_VERSION_CONFLICT',
        status: 409,
      }),
    );
    renderPanel();

    await fireEvent.click(screen.getByRole('button', { name: '租户隐藏' }));

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText('策略已被其他管理员更新，已刷新最新状态，请重新选择。'),
    ).toBeInTheDocument();
  });
});
