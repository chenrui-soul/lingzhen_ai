import {
  MutationCache,
  QueryCache,
  QueryClient,
  type VueQueryPluginOptions,
} from '@tanstack/vue-query';

import { showGlobalError } from '@/app/error-handler';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.handlesErrorLocally) {
        return;
      }
      showGlobalError(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.handlesErrorLocally) {
        return;
      }
      showGlobalError(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        const status =
          typeof error === 'object' && error !== null && 'status' in error
            ? Number(error.status)
            : 0;
        return status >= 400 && status < 500 ? false : failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export const queryPluginOptions: VueQueryPluginOptions = {
  queryClient,
};
