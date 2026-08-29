import { computed, ref } from 'vue';

const PAGE_SIZE = 20;

export function useCursorTableState() {
  const keywordDraft = ref('');
  const keyword = ref('');
  const filter = ref('all');
  const cursor = ref<string>();
  const history = ref<(string | undefined)[]>([]);

  const filters = computed(() => ({
    cursor: cursor.value,
    limit: PAGE_SIZE,
    keyword: keyword.value || undefined,
    filter: filter.value,
  }));

  const hasPrevious = computed(() => history.value.length > 0);

  function resetPagination(): void {
    cursor.value = undefined;
    history.value = [];
  }

  function submitSearch(): void {
    keyword.value = keywordDraft.value.trim();
    resetPagination();
  }

  function reset(): void {
    keywordDraft.value = '';
    keyword.value = '';
    filter.value = 'all';
    resetPagination();
  }

  function next(nextCursor?: string | null): void {
    if (!nextCursor) return;
    history.value.push(cursor.value);
    cursor.value = nextCursor;
  }

  function previous(): void {
    if (!history.value.length) return;
    cursor.value = history.value.pop();
  }

  return {
    keywordDraft,
    keyword,
    filter,
    filters,
    hasPrevious,
    resetPagination,
    submitSearch,
    reset,
    next,
    previous,
  };
}
