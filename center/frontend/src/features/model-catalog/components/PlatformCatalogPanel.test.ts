import { fireEvent, render, screen } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

import { AppError } from '@/api/errors';
import { useAuthStore } from '@/features/auth/stores/auth-store';
import PlatformCatalogPanel from '@/features/model-catalog/components/PlatformCatalogPanel.vue';

const queryMocks = vi.hoisted(() => ({
  models: vi.fn(),
  providers: vi.fn(),
  versions: vi.fn(),
  updateModel: vi.fn(),
}));

vi.mock('@/features/model-catalog/queries/model-catalog-queries', () => ({
  useCatalogModelsQuery: queryMocks.models,
  useModelProvidersQuery: queryMocks.providers,
  useCatalogVersionsQuery: queryMocks.versions,
  useUpdateCatalogModelMutation: queryMocks.updateModel,
}));

const pinia = createPinia();

function queryState(data: unknown, error: unknown = null, pending = false) {
  return {
    data: ref(data),
    error: ref(error),
    isPending: ref(pending),
    isFetching: ref(false),
    refetch: vi.fn(),
  };
}

function prepareQueries(options?: { error?: unknown; pending?: boolean }) {
  queryMocks.models.mockReturnValue(
    queryState(
      { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 },
      options?.error,
      options?.pending,
    ),
  );
  queryMocks.providers.mockReturnValue(
    queryState({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }),
  );
  queryMocks.versions.mockReturnValue(
    queryState({ items: [], page: 1, pageSize: 1, total: 0, totalPages: 0 }),
  );
  queryMocks.updateModel.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: ref(false),
  });
}

function renderPanel() {
  return render(PlatformCatalogPanel, {
    global: {
      stubs: {
        AButton: { template: '<button><slot /></button>' },
        ASelect: { template: '<div />' },
        APagination: { template: '<div />' },
        CatalogPublishDrawer: {
          props: ['open'],
          emits: ['close', 'closed'],
          template:
            '<button v-if="open" @click="$emit(\'close\'); $emit(\'closed\')">关闭发布抽屉</button>',
        },
        ModelCatalogEditorDrawer: true,
        ProviderManagerDrawer: true,
      },
      plugins: [pinia],
    },
  });
}

describe('PlatformCatalogPanel', () => {
  beforeEach(() => {
    setActivePinia(pinia);
    const authStore = useAuthStore();
    authStore.currentUser = {
      userId: 'user-1',
      username: 'reader',
      tenantId: 'tenant-1',
      tenantName: '灵帧',
      permissions: ['model_catalog.read'],
    } as typeof authStore.currentUser;
  });

  it('shows a stable loading state', () => {
    prepareQueries({ pending: true });
    renderPanel();

    expect(screen.getByText('正在读取平台目录')).toBeInTheDocument();
  });

  it('distinguishes forbidden responses from ordinary errors', () => {
    prepareQueries({
      error: new AppError({
        title: '暂无访问权限',
        message: '缺少平台目录读取权限。',
        status: 403,
      }),
    });
    renderPanel();

    expect(screen.getByText('暂无访问权限')).toBeInTheDocument();
    expect(screen.getByText('缺少平台目录读取权限。')).toBeInTheDocument();
  });

  it('shows the empty catalog state without exposing internal fields', () => {
    prepareQueries();
    const { container } = renderPanel();

    expect(screen.getByText('没有匹配的模型')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('contentHash');
    expect(container).not.toHaveTextContent('rowVersion');
    expect(container).not.toHaveTextContent('parameterSchema');
  });

  it('keeps write actions hidden for read-only users', () => {
    prepareQueries();
    renderPanel();

    expect(screen.queryByText('厂商管理')).not.toBeInTheDocument();
    expect(screen.queryByText('新增模型')).not.toBeInTheDocument();
    expect(screen.queryByText('发布目录')).not.toBeInTheDocument();
  });

  it('shows the catalog write entry only with model_catalog.manage', () => {
    const authStore = useAuthStore();
    if (authStore.currentUser) {
      authStore.currentUser.permissions = ['model_catalog.read', 'model_catalog.manage'];
    }
    prepareQueries();
    renderPanel();

    expect(screen.getByText('厂商管理')).toBeInTheDocument();
    expect(screen.getByText('新增模型')).toBeInTheDocument();
    expect(screen.getByText('草稿维护与正式发布分离，发布前会先校验目录差异。')).toBeInTheDocument();
  });

  it('shows the publish entry only with model_catalog.publish', () => {
    const authStore = useAuthStore();
    if (authStore.currentUser) {
      authStore.currentUser.permissions = ['model_catalog.read', 'model_catalog.publish'];
    }
    prepareQueries();
    renderPanel();

    expect(screen.getByText('发布目录')).toBeInTheDocument();
    expect(screen.queryByText('厂商管理')).not.toBeInTheDocument();
    expect(screen.queryByText('新增模型')).not.toBeInTheDocument();
  });

  it('restores focus to the publish trigger after the drawer closes', async () => {
    const authStore = useAuthStore();
    if (authStore.currentUser) {
      authStore.currentUser.permissions = ['model_catalog.read', 'model_catalog.publish'];
    }
    prepareQueries();
    renderPanel();

    const publishButton = screen.getByRole('button', { name: '发布目录' });
    await fireEvent.click(publishButton);
    await fireEvent.click(screen.getByRole('button', { name: '关闭发布抽屉' }));

    expect(publishButton).toHaveFocus();
  });
});
