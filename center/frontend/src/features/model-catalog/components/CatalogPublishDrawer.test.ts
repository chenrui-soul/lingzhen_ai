import { fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { ref } from 'vue';

import { AppError } from '@/api/errors';
import CatalogPublishDrawer from '@/features/model-catalog/components/CatalogPublishDrawer.vue';
import type { CatalogPublishPreview } from '@/features/model-catalog/types';

const queryMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@/features/model-catalog/queries/model-catalog-queries', () => ({
  useCatalogPublishPreviewQuery: queryMocks.preview,
  usePublishCatalogMutation: queryMocks.publish,
}));

const readyPreview: CatalogPublishPreview = {
  currentVersion: 7,
  currentPublishedAt: '2026-08-25T00:00:00Z',
  nextVersion: 8,
  modelCount: 12,
  addedCount: 2,
  modifiedCount: 1,
  removedCount: 0,
  hasChanges: true,
  canPublish: true,
  contentHash: 'a'.repeat(64),
  blockers: [],
};

function prepare(preview: CatalogPublishPreview, mutateAsync = vi.fn()) {
  const refetch = vi.fn();
  queryMocks.preview.mockReturnValue({
    data: ref(preview),
    error: ref(null),
    isPending: ref(false),
    isFetching: ref(false),
    refetch,
  });
  queryMocks.publish.mockReturnValue({
    mutateAsync,
    isPending: ref(false),
  });
  return { refetch };
}

function renderDrawer() {
  return render(CatalogPublishDrawer, {
    props: { open: true },
    global: {
      stubs: {
        ADrawer: {
          template: '<div><slot name="title" /><slot /><slot name="footer" /></div>',
        },
        AButton: {
          props: ['disabled', 'loading'],
          template: '<button :disabled="disabled"><slot /></button>',
        },
        ASpin: { template: '<span>loading</span>' },
      },
    },
  });
}

describe('CatalogPublishDrawer', () => {
  it('disables publication when the catalog has no changes', () => {
    prepare({
      ...readyPreview,
      hasChanges: false,
      canPublish: false,
      addedCount: 0,
      modifiedCount: 0,
    });
    renderDrawer();

    expect(screen.getByText('当前目录已经是最新版本')).toBeInTheDocument();
    expect(screen.getByText('确认发布并上线')).toBeDisabled();
  });

  it('shows blockers and keeps the publish action disabled', () => {
    prepare({
      ...readyPreview,
      canPublish: false,
      blockers: [{ code: 'MODEL_CATALOG_EMPTY', message: '目录至少需要一个可发布模型' }],
    });
    renderDrawer();

    expect(screen.getByText('发布前需要处理')).toBeInTheDocument();
    expect(screen.getByText('目录至少需要一个可发布模型')).toBeInTheDocument();
    expect(screen.getByText('确认发布并上线')).toBeDisabled();
  });

  it('uses one drawer for preview and confirmation before publishing', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      versionId: 'version-8',
      version: 8,
      current: true,
      modelCount: 12,
      publishedAt: '2026-08-25T01:00:00Z',
      idempotentReplay: false,
    });
    prepare(readyPreview, mutateAsync);
    const view = renderDrawer();

    await fireEvent.click(screen.getByRole('button', { name: '确认发布并上线' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      request: {
        expectedCurrentVersion: 7,
        expectedContentHash: 'a'.repeat(64),
      },
      idempotencyKey: expect.any(String),
    });
    expect(view.emitted().published).toHaveLength(1);
    expect(view.emitted().close).toHaveLength(1);
  });

  it('returns to a refreshed preview when the preview becomes stale', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(
      new AppError({
        title: '数据状态已变化',
        message: '目录草稿已变化',
        code: 'MODEL_CATALOG_PREVIEW_STALE',
        status: 409,
      }),
    );
    const { refetch } = prepare(readyPreview, mutateAsync);
    const view = renderDrawer();

    await fireEvent.click(screen.getByRole('button', { name: '确认发布并上线' }));

    await waitFor(() => {
      expect(
        screen.getByText('目录内容已发生变化，已重新获取最新发布预览，请核对后再发布。'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('本次发布内容')).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(view.emitted().previewInvalidated).toHaveLength(1);
  });
});
