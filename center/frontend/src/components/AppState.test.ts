import { fireEvent, render, screen } from '@testing-library/vue';

import AppState from '@/components/AppState.vue';

describe('AppState', () => {
  it('renders an actionable error state', async () => {
    const { emitted } = render(AppState, {
      props: {
        kind: 'error',
        title: '加载失败',
        description: '服务暂时不可用',
        actionLabel: '重新加载',
      },
      global: {
        stubs: {
          'a-button': {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    });

    expect(screen.getByRole('heading', { name: '加载失败' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(emitted().action).toBeTruthy();
  });

  it('marks loading state as busy', () => {
    render(AppState, {
      props: {
        kind: 'loading',
        title: '正在加载',
        description: '请稍候',
      },
      global: {
        stubs: {
          'a-button': true,
        },
      },
    });

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
