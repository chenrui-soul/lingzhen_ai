<script setup lang="ts">
import { PhArrowClockwise, PhMagnifyingGlass, PhUsersThree } from '@phosphor-icons/vue';
import { computed, ref } from 'vue';

import { toAppError } from '@/api/errors';
import AppState from '@/components/AppState.vue';
import { formatDateTime, statusLabel, statusTone } from '@/features/management/formatters';
import { useManagementUsersQuery } from '@/features/management/queries/management-queries';

const PAGE_SIZE = 20;
const page = ref(1);
const keywordDraft = ref('');
const keyword = ref('');
const status = ref('all');

const filters = computed(() => ({
  page: page.value,
  pageSize: PAGE_SIZE,
  keyword: keyword.value || undefined,
  status: status.value,
}));
const usersQuery = useManagementUsersQuery(filters);
const error = computed(() => (usersQuery.error.value ? toAppError(usersQuery.error.value) : null));
const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '正常' },
  { value: 'invited', label: '待加入' },
  { value: 'suspended', label: '已暂停' },
  { value: 'removed', label: '已移除' },
];

function submitSearch(): void {
  keyword.value = keywordDraft.value.trim();
  page.value = 1;
}

function clearSearch(): void {
  keywordDraft.value = '';
  keyword.value = '';
  page.value = 1;
}

function resetFilters(): void {
  keywordDraft.value = '';
  keyword.value = '';
  status.value = 'all';
  page.value = 1;
}

function handleStatusChange(): void {
  page.value = 1;
}

function handlePageChange(nextPage: number): void {
  page.value = nextPage;
}
</script>

<template>
  <div class="users-page">
    <header class="page-heading">
      <div>
        <span>成员目录</span>
        <h1>用户管理</h1>
        <p>仅展示当前租户的成员身份、角色和在线会话，不会读取其他租户数据。</p>
      </div>
      <button type="button" aria-label="刷新用户列表" @click="usersQuery.refetch()">
        <PhArrowClockwise :size="18" />
      </button>
    </header>

    <section class="filter-panel" aria-label="用户筛选">
      <label class="search-field">
        <span class="sr-only">搜索用户名或邮箱</span>
        <PhMagnifyingGlass :size="18" aria-hidden="true" />
        <input
          v-model="keywordDraft"
          type="search"
          maxlength="100"
          placeholder="搜索用户名或邮箱"
          @keyup.enter="submitSearch"
        />
      </label>
      <a-button type="primary" @click="submitSearch">查询</a-button>
      <a-button v-if="keyword" type="text" @click="clearSearch">清除</a-button>
      <a-select
        v-model:value="status"
        class="status-select"
        :options="statusOptions"
        aria-label="成员状态"
        @change="handleStatusChange"
      />
      <span class="filter-panel__count">
        <PhUsersThree :size="17" />
        {{ usersQuery.data.value?.total ?? 0 }} 位成员
      </span>
    </section>

    <section class="users-panel" :aria-busy="usersQuery.isFetching.value">
      <AppState
        v-if="usersQuery.isPending.value"
        kind="loading"
        title="正在加载成员目录"
        description="正在从当前租户读取成员数据。"
      />
      <AppState
        v-else-if="error"
        :kind="error.status === 403 ? 'forbidden' : 'error'"
        :title="error.title"
        :description="error.message"
        action-label="重新加载"
        @action="usersQuery.refetch()"
      />
      <AppState
        v-else-if="!usersQuery.data.value?.items?.length"
        kind="empty"
        title="没有匹配的成员"
        description="可以调整搜索内容或状态筛选后再次查询。"
        :action-label="keyword || status !== 'all' ? '清除筛选' : ''"
        @action="resetFilters"
      />
      <template v-else>
        <div v-if="usersQuery.isFetching.value" class="table-progress" role="status">
          正在更新列表…
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">用户</th>
                <th scope="col">角色</th>
                <th scope="col">成员状态</th>
                <th scope="col">账号状态</th>
                <th scope="col">活跃会话</th>
                <th scope="col">最近登录</th>
                <th scope="col">加入时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in usersQuery.data.value.items" :key="item.membershipId">
                <td>
                  <div class="user-cell">
                    <span class="user-cell__avatar">{{ (item.username ?? 'U').slice(0, 1) }}</span>
                    <span>
                      <strong>{{ item.username ?? '未设置用户名' }}</strong>
                      <small>{{ item.email ?? '未绑定邮箱' }}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <strong class="role-name">{{
                    item.roleName ?? item.roleCode ?? '未分配'
                  }}</strong>
                </td>
                <td>
                  <span
                    class="state-badge"
                    :class="`state-badge--${statusTone(item.membershipStatus)}`"
                  >
                    {{ statusLabel(item.membershipStatus) }}
                  </span>
                </td>
                <td>
                  <span class="state-badge" :class="`state-badge--${statusTone(item.userStatus)}`">
                    {{ statusLabel(item.userStatus) }}
                  </span>
                </td>
                <td>{{ item.activeSessions ?? 0 }}</td>
                <td>{{ formatDateTime(item.lastLoginAt) }}</td>
                <td>{{ formatDateTime(item.joinedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="users-panel__footer">
          <span>第 {{ usersQuery.data.value.page ?? page }} 页</span>
          <a-pagination
            :current="page"
            :page-size="PAGE_SIZE"
            :total="usersQuery.data.value.total ?? 0"
            :show-size-changer="false"
            :show-less-items="true"
            @change="handlePageChange"
          />
        </footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.users-page {
  width: min(100%, 92rem);
  margin: 0 auto;
}

.page-heading {
  display: flex;
  padding: 0.5rem 0 1.5rem;
  gap: 2rem;
  align-items: flex-start;
  justify-content: space-between;
}

.page-heading > div > span {
  color: var(--lz-color-accent);
  font-size: 0.7rem;
  font-weight: 680;
  letter-spacing: 0.08em;
}

.page-heading h1 {
  margin: 0.35rem 0 0;
  color: var(--lz-color-text);
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  letter-spacing: -0.04em;
}

.page-heading p {
  margin: 0.65rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.84rem;
}

.page-heading button {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  place-items: center;
  color: var(--lz-color-muted);
  cursor: pointer;
  background: rgba(140, 177, 218, 0.07);
  border: 1px solid var(--lz-color-line);
  border-radius: 0.7rem;
}

.filter-panel {
  display: flex;
  padding: 0.85rem;
  gap: 0.65rem;
  align-items: center;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}

.search-field {
  display: flex;
  width: min(26rem, 100%);
  min-width: 13rem;
  height: 2.75rem;
  padding: 0 0.85rem;
  gap: 0.6rem;
  align-items: center;
  color: var(--lz-color-subtle);
  background: var(--lz-color-field);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-control);
}

.search-field:focus-within {
  border-color: var(--lz-color-line-strong);
}

.search-field input {
  min-width: 0;
  flex: 1;
  color: var(--lz-color-text);
  outline: 0;
  background: transparent;
  border: 0;
}

.search-field input::placeholder {
  color: var(--lz-color-subtle);
}

.status-select {
  width: 9rem;
  margin-left: auto;
}

.filter-panel__count {
  display: inline-flex;
  gap: 0.4rem;
  align-items: center;
  color: var(--lz-color-muted);
  font-size: 0.74rem;
  white-space: nowrap;
}

.users-panel {
  position: relative;
  min-height: 24rem;
  margin-top: 1rem;
  overflow: hidden;
  background: var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}

.table-progress {
  position: absolute;
  top: 0;
  right: 1rem;
  z-index: 1;
  padding: 0.35rem 0.55rem;
  color: var(--lz-color-accent);
  font-size: 0.68rem;
  background: var(--lz-color-surface-strong);
  border-radius: 0 0 0.55rem 0.55rem;
}

.table-scroll {
  overflow-x: auto;
  scrollbar-color: rgba(85, 216, 241, 0.35) rgba(140, 177, 218, 0.06);
  scrollbar-width: thin;
}

.table-scroll::-webkit-scrollbar {
  height: 0.45rem;
}

.table-scroll::-webkit-scrollbar-track {
  background: rgba(140, 177, 218, 0.06);
}

.table-scroll::-webkit-scrollbar-thumb {
  background: rgba(85, 216, 241, 0.3);
  border-radius: var(--lz-radius-pill);
}

table {
  width: 100%;
  min-width: 58rem;
  border-collapse: collapse;
}

th,
td {
  padding: 1rem 1.1rem;
  text-align: left;
  border-bottom: 1px solid rgba(140, 177, 218, 0.1);
}

th {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.05em;
  background: rgba(140, 177, 218, 0.025);
}

td {
  color: var(--lz-color-muted);
  font-size: 0.75rem;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr:hover td {
  background: rgba(85, 216, 241, 0.025);
}

.user-cell {
  display: flex;
  min-width: 14rem;
  gap: 0.7rem;
  align-items: center;
}

.user-cell__avatar {
  display: grid;
  width: 2.4rem;
  height: 2.4rem;
  flex: 0 0 auto;
  place-items: center;
  color: var(--lz-color-accent);
  font-weight: 700;
  background: rgba(85, 216, 241, 0.08);
  border: 1px solid rgba(85, 216, 241, 0.14);
  border-radius: 0.75rem;
}

.user-cell > span:last-child {
  display: grid;
  min-width: 0;
}

.user-cell strong,
.user-cell small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-cell strong,
.role-name {
  color: var(--lz-color-text);
  font-size: 0.77rem;
}

.user-cell small {
  color: var(--lz-color-subtle);
  font-size: 0.68rem;
}

.state-badge {
  display: inline-flex;
  padding: 0.25rem 0.52rem;
  color: var(--lz-color-muted);
  font-size: 0.68rem;
  font-weight: 620;
  background: rgba(140, 177, 218, 0.07);
  border-radius: var(--lz-radius-pill);
}

.state-badge--success {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.08);
}

.state-badge--warning {
  color: var(--lz-color-warning);
  background: rgba(255, 189, 118, 0.08);
}

.state-badge--danger {
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.08);
}

.users-panel__footer {
  display: flex;
  padding: 1rem 1.1rem;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(140, 177, 218, 0.1);
}

.users-panel__footer > span {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}

@media (max-width: 48rem) {
  .filter-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .search-field {
    grid-column: 1 / -1;
    width: 100%;
  }

  .status-select {
    width: 100%;
    margin-left: 0;
  }

  .filter-panel__count {
    justify-self: end;
  }
}

@media (max-width: 40rem) {
  .page-heading {
    gap: 1rem;
  }

  .users-panel__footer {
    display: grid;
    justify-items: center;
  }
}
</style>
