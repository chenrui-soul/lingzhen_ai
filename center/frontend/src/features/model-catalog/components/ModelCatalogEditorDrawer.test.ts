import { fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { ref } from 'vue';

import { AppError } from '@/api/errors';
import ModelCatalogEditorDrawer from '@/features/model-catalog/components/ModelCatalogEditorDrawer.vue';
import type { CatalogModel, ModelProvider } from '@/features/model-catalog/types';

const mutationMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/features/model-catalog/queries/model-catalog-queries', () => ({
  useCreateCatalogModelMutation: mutationMocks.create,
  useUpdateCatalogModelMutation: mutationMocks.update,
}));

const provider: ModelProvider = {
  id: 'provider-1',
  code: 'volcengine',
  displayName: '火山引擎',
  protocolFamily: 'openai_compatible',
  description: '模型厂商',
  status: 'active',
  createdAt: '2026-08-25T00:00:00Z',
  updatedAt: '2026-08-25T00:00:00Z',
  rowVersion: 2,
};

const model: CatalogModel = {
  id: 'model-1',
  provider,
  code: 'seedance-2.0-mini',
  displayName: 'Seedance 2.0 Mini',
  capabilityType: 'video',
  description: '视频模型',
  parameterSchema: { type: 'object' },
  defaultParameters: { duration: 10 },
  defaultTenantEnabled: false,
  sortOrder: 20,
  status: 'active',
  createdAt: '2026-08-25T00:00:00Z',
  updatedAt: '2026-08-25T00:00:00Z',
  rowVersion: 4,
  baseCredits: 20,
  maxReserveCredits: 30,
  priceRowVersion: 1,
};

function mutationState(mutateAsync: ReturnType<typeof vi.fn>) {
  return { mutateAsync, isPending: ref(false) };
}

function renderDrawer(currentModel: CatalogModel | null) {
  return render(ModelCatalogEditorDrawer, {
    props: { open: true, model: currentModel, providers: [provider] },
    global: {
      stubs: {
        ADrawer: {
          template: '<div><slot name="title" /><slot /><slot name="footer" /></div>',
        },
        AButton: { template: '<button><slot /></button>' },
        AInput: true,
        ASelect: true,
        AInputNumber: { template: '<div />' },
        ACheckbox: { template: '<div />' },
        InputNumber: { template: '<div />' },
        Checkbox: { template: '<div />' },
      },
    },
  });
}

describe('ModelCatalogEditorDrawer', () => {
  beforeEach(() => {
    mutationMocks.create.mockReturnValue(mutationState(vi.fn()));
    mutationMocks.update.mockReturnValue(mutationState(vi.fn()));
  });

  it('validates required create fields before sending a request', async () => {
    const createRequest = vi.fn();
    mutationMocks.create.mockReturnValue(mutationState(createRequest));
    renderDrawer(null);

    await fireEvent.click(screen.getByText('保存并生效'));

    expect(screen.getByText('请输入模型编码')).toBeInTheDocument();
    expect(screen.getByText('请输入模型名称')).toBeInTheDocument();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('reports an optimistic-lock conflict and requests the latest model', async () => {
    const updateRequest = vi.fn().mockRejectedValue(
      new AppError({
        title: '数据状态已变化',
        message: '模型已被其他管理员修改',
        status: 409,
        code: 'MODEL_ROW_VERSION_CONFLICT',
      }),
    );
    mutationMocks.update.mockReturnValue(mutationState(updateRequest));
    const view = renderDrawer(model);

    await fireEvent.click(screen.getByText('保存并生效'));

    await waitFor(() => {
      expect(screen.getByText('此模型已被其他管理员修改，正在刷新最新内容。')).toBeInTheDocument();
    });
    expect(view.emitted().conflict).toEqual([['model-1']]);
    expect(updateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'model-1',
        request: expect.objectContaining({ rowVersion: 4 }),
      }),
    );
  });

  it('saves a model through one primary action', async () => {
    const updateRequest = vi.fn().mockResolvedValue({ ...model, status: 'active', rowVersion: 5 });
    mutationMocks.update.mockReturnValue(mutationState(updateRequest));
    const view = renderDrawer(model);

    await fireEvent.click(screen.getByRole('button', { name: '保存并生效' }));

    await waitFor(() => expect(updateRequest).toHaveBeenCalledTimes(1));
    expect(updateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'model-1',
        request: expect.objectContaining({ status: 'active', rowVersion: 4 }),
      }),
    );
    expect(view.emitted().saved).toHaveLength(1);
    expect(view.emitted().close).toHaveLength(1);
  });

  it('exposes the asynchronous task query address directly on the model form', () => {
    renderDrawer(model);

    expect(screen.getByText('任务查询地址（可选）')).toBeInTheDocument();
    expect(screen.getByText(/系统不会自动补路径/)).toBeInTheDocument();
  });
});
