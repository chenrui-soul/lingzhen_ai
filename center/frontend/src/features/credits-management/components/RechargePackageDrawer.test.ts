import { fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { ref } from 'vue';

import { AppError } from '@/api/errors';
import RechargePackageDrawer from '@/features/credits-management/components/RechargePackageDrawer.vue';
import type { RechargePackage } from '@/features/credits-management/types';

const mutationMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/features/credits-management/queries/credits-management-queries', () => ({
  useCreateRechargePackageMutation: mutationMocks.create,
  useUpdateRechargePackageMutation: mutationMocks.update,
}));

const rechargePackage: RechargePackage = {
  id: 'package-1',
  code: 'starter_100',
  displayName: 'Starter 100',
  cashAmountCents: 990,
  creditAmount: 100,
  bonusCredits: 10,
  status: 'active',
  sortOrder: 10,
  createdAt: '2026-08-26T00:00:00Z',
  updatedAt: '2026-08-26T00:00:00Z',
  rowVersion: 3,
};

function mutationState(mutateAsync: ReturnType<typeof vi.fn>) {
  return { mutateAsync, isPending: ref(false) };
}

function renderDrawer(item: RechargePackage | null) {
  return render(RechargePackageDrawer, {
    props: { open: true, rechargePackage: item },
    global: {
      stubs: {
        ADrawer: { template: '<div><slot name="title" /><slot /><slot name="footer" /></div>' },
        AButton: { template: '<button><slot /></button>' },
        AInput: true,
        ASelect: true,
        AInputNumber: { template: '<div />' },
        InputNumber: { template: '<div />' },
      },
    },
  });
}

describe('RechargePackageDrawer', () => {
  beforeEach(() => {
    mutationMocks.create.mockReturnValue(mutationState(vi.fn()));
    mutationMocks.update.mockReturnValue(mutationState(vi.fn()));
  });

  it('validates required package fields before creating a draft', async () => {
    const createRequest = vi.fn();
    mutationMocks.create.mockReturnValue(mutationState(createRequest));
    renderDrawer(null);

    await fireEvent.click(screen.getByText('创建草稿'));

    expect(screen.getByText('请输入套餐代码')).toBeInTheDocument();
    expect(screen.getByText('请输入套餐名称')).toBeInTheDocument();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('sends rowVersion and refreshes after an optimistic-lock conflict', async () => {
    const updateRequest = vi.fn().mockRejectedValue(
      new AppError({
        title: '数据状态已变化',
        message: '套餐已被其他管理员修改',
        status: 409,
        code: 'RECHARGE_PACKAGE_ROW_VERSION_CONFLICT',
      }),
    );
    mutationMocks.update.mockReturnValue(mutationState(updateRequest));
    const view = renderDrawer(rechargePackage);

    await fireEvent.click(screen.getByText('保存修改'));

    await waitFor(() => {
      expect(screen.getByText('套餐已被其他管理员修改，正在刷新最新内容。')).toBeInTheDocument();
    });
    expect(updateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: 'package-1',
        request: expect.objectContaining({ rowVersion: 3 }),
      }),
    );
    expect(view.emitted().conflict).toEqual([['package-1']]);
  });
});
