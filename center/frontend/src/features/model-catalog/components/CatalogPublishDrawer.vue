<script setup lang="ts">
import {
  PhCheckCircle,
  PhCloudArrowUp,
  PhInfo,
  PhShieldCheck,
  PhWarningCircle,
} from '@phosphor-icons/vue';
import ADrawer from 'ant-design-vue/es/drawer';
import message from 'ant-design-vue/es/message';
import { computed, ref, watch } from 'vue';

import { toAppError } from '@/api/errors';
import { createRequestId } from '@/api/request-id';
import {
  useCatalogPublishPreviewQuery,
  usePublishCatalogMutation,
} from '@/features/model-catalog/queries/model-catalog-queries';
import type { CatalogPublishResponse } from '@/features/model-catalog/types';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  close: [];
  closed: [];
  published: [response: CatalogPublishResponse];
  previewInvalidated: [];
}>();

const notice = ref('');
const idempotencyKey = ref('');
const previewQuery = useCatalogPublishPreviewQuery(() => props.open);
const publishMutation = usePublishCatalogMutation();
const preview = computed(() => previewQuery.data.value);
const loading = computed(() => previewQuery.isPending.value || previewQuery.isFetching.value);
const publishing = computed(() => publishMutation.isPending.value);
const previewError = computed(() =>
  previewQuery.error.value ? toAppError(previewQuery.error.value) : null,
);
const publishDisabled = computed(
  () => !preview.value?.canPublish || loading.value || publishing.value,
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    notice.value = '';
    idempotencyKey.value = '';
  },
);

async function refreshPreview(): Promise<void> {
  notice.value = '';
  await previewQuery.refetch();
}

async function publish(): Promise<void> {
  if (!preview.value || publishDisabled.value) return;
  if (!idempotencyKey.value) idempotencyKey.value = createRequestId();

  try {
    const response = await publishMutation.mutateAsync({
      request: {
        expectedCurrentVersion: preview.value.currentVersion,
        expectedContentHash: preview.value.contentHash,
      },
      idempotencyKey: idempotencyKey.value,
    });
    message.success(`模型目录 v${response.version} 已正式发布`);
    emit('published', response);
    emit('close');
  } catch (error) {
    const appError = toAppError(error);
    if (
      appError.code === 'MODEL_CATALOG_CURRENT_VERSION_CONFLICT' ||
      appError.code === 'MODEL_CATALOG_PREVIEW_STALE' ||
      appError.code === 'MODEL_CATALOG_PUBLISH_CONFLICT'
    ) {
      idempotencyKey.value = '';
      notice.value = '目录内容已发生变化，已重新获取最新发布预览，请核对后再发布。';
      emit('previewInvalidated');
      await previewQuery.refetch();
      return;
    }
    notice.value = `${appError.title}：${appError.message}`;
  }
}

function handleOpenChange(open: boolean): void {
  if (!open) emit('closed');
}
</script>

<template>
  <ADrawer
    :open="open"
    :width="'min(36rem, 100vw)'"
    :keyboard="!publishing"
    :mask-closable="!publishing"
    :closable="!publishing"
    class="catalog-publish-drawer"
    placement="right"
    @close="emit('close')"
    @after-open-change="handleOpenChange"
  >
    <template #title>
      <div class="publish-heading">
        <span><PhCloudArrowUp :size="20" /></span>
        <div>
          <strong>发布模型目录</strong>
          <small>核对本次变更，确认后立即切换桌面端目录版本</small>
        </div>
      </div>
    </template>

    <div class="publish-content" :aria-busy="loading || publishing">
      <div v-if="notice" class="publish-notice" role="alert">
        <PhInfo :size="18" />
        <span>{{ notice }}</span>
      </div>

      <div v-if="loading && !preview" class="publish-state" role="status">
        <a-spin />
        <strong>正在计算发布差异</strong>
        <span>系统正在对比当前版本与最新目录草稿。</span>
      </div>

      <div v-else-if="previewError && !preview" class="publish-state publish-state--error">
        <PhWarningCircle :size="30" />
        <strong>{{ previewError.title }}</strong>
        <span>{{ previewError.message }}</span>
        <a-button @click="refreshPreview">重新加载</a-button>
      </div>

      <template v-else-if="preview">
        <section class="version-route" aria-label="目录版本变化">
          <div>
            <small>当前版本</small>
            <strong>{{
              preview.currentVersion ? `v${preview.currentVersion}` : '尚未发布'
            }}</strong>
          </div>
          <span aria-hidden="true">→</span>
          <div class="version-route__next">
            <small>发布后版本</small>
            <strong>v{{ preview.nextVersion }}</strong>
          </div>
        </section>

        <section class="preview-step">
          <header class="section-heading">
            <div>
              <strong>本次发布内容</strong>
              <span>共 {{ preview.modelCount }} 个可发布模型</span>
            </div>
            <span :class="['readiness', preview.canPublish ? 'readiness--ready' : '']">
              {{ preview.canPublish ? '可以发布' : '暂不可发布' }}
            </span>
          </header>

          <div class="change-grid">
            <article>
              <small>新增</small>
              <strong>+{{ preview.addedCount }}</strong>
            </article>
            <article>
              <small>修改</small>
              <strong>{{ preview.modifiedCount }}</strong>
            </article>
            <article>
              <small>移除</small>
              <strong>-{{ preview.removedCount }}</strong>
            </article>
          </div>

          <div v-if="preview.blockers.length" class="blocker-panel" role="alert">
            <div><PhWarningCircle :size="19" /><strong>发布前需要处理</strong></div>
            <ul>
              <li v-for="blocker in preview.blockers" :key="blocker.code">
                {{ blocker.message }}
              </li>
            </ul>
          </div>

          <div v-else-if="!preview.hasChanges" class="no-change-panel" role="status">
            <PhCheckCircle :size="20" />
            <div>
              <strong>当前目录已经是最新版本</strong>
              <span>草稿内容与已发布版本一致，不需要重复发布。</span>
            </div>
          </div>

          <div class="publish-guardrail">
            <PhShieldCheck :size="20" />
            <div>
              <strong>发布安全规则</strong>
              <span
                >正式发布会再次校验版本和目录内容；若其他管理员已修改，系统会中止并刷新预览。</span
              >
            </div>
          </div>
          <div class="confirm-warning">
            确认后将发布 v{{ preview.nextVersion }}，共
            {{ preview.modelCount }} 个模型。版本快照不可编辑或删除，后续变更需要发布新版本。
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="publish-footer">
        <a-button :disabled="publishing" @click="emit('close')">取消</a-button>
        <a-button type="primary" :disabled="publishDisabled" :loading="publishing" @click="publish">
          确认发布并上线
        </a-button>
      </div>
    </template>
  </ADrawer>
</template>

<style scoped>
.publish-heading,
.publish-heading > span,
.publish-notice,
.version-route,
.section-heading,
.blocker-panel > div,
.no-change-panel,
.publish-guardrail,
.publish-footer {
  display: flex;
  align-items: center;
}
.publish-heading {
  gap: 0.7rem;
}
.publish-heading > span {
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 auto;
  justify-content: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.08);
  border-radius: var(--lz-radius-control);
}
.publish-heading > div {
  display: grid;
  min-width: 0;
}
.publish-heading strong {
  color: var(--lz-color-text);
  font-size: 0.95rem;
}
.publish-heading small {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}
.publish-content {
  display: grid;
  gap: 1rem;
}
.publish-notice {
  padding: 0.8rem 0.9rem;
  gap: 0.6rem;
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.07);
  border-radius: var(--lz-radius-control);
}
.publish-state {
  display: grid;
  min-height: 20rem;
  place-content: center;
  justify-items: center;
  gap: 0.55rem;
  color: var(--lz-color-subtle);
  text-align: center;
}
.publish-state strong {
  color: var(--lz-color-text);
}
.publish-state span {
  max-width: 22rem;
  font-size: 0.74rem;
}
.publish-state--error > svg {
  color: var(--lz-color-danger);
}
.version-route {
  padding: 1rem;
  justify-content: space-between;
  color: var(--lz-color-subtle);
  background: rgba(140, 177, 218, 0.035);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-card);
}
.version-route > div {
  display: grid;
  min-width: 8rem;
}
.version-route > div:last-child {
  text-align: right;
}
.version-route small {
  font-size: 0.69rem;
}
.version-route strong {
  color: var(--lz-color-text);
  font-size: 1.12rem;
}
.version-route__next strong {
  color: var(--lz-color-accent);
}
.preview-step {
  display: grid;
  gap: 1rem;
}
.section-heading {
  justify-content: space-between;
  gap: 1rem;
}
.section-heading > div {
  display: grid;
}
.section-heading strong {
  color: var(--lz-color-text);
  font-size: 0.86rem;
}
.section-heading span {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}
.readiness {
  padding: 0.28rem 0.58rem;
  color: var(--lz-color-danger) !important;
  background: rgba(255, 171, 148, 0.08);
  border-radius: var(--lz-radius-pill);
}
.readiness--ready {
  color: var(--lz-color-success) !important;
  background: rgba(114, 221, 194, 0.08);
}
.change-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.7rem;
}
.change-grid article {
  display: grid;
  min-height: 5rem;
  padding: 0.85rem;
  align-content: center;
  background: var(--lz-color-field);
  border-radius: var(--lz-radius-control);
}
.change-grid small {
  color: var(--lz-color-subtle);
  font-size: 0.69rem;
}
.change-grid strong {
  color: var(--lz-color-text);
  font-size: 1.05rem;
}
.blocker-panel,
.no-change-panel,
.publish-guardrail,
.confirm-warning {
  padding: 0.9rem;
  border-radius: var(--lz-radius-control);
}
.blocker-panel {
  color: var(--lz-color-danger);
  background: rgba(255, 171, 148, 0.07);
}
.blocker-panel > div {
  gap: 0.5rem;
}
.blocker-panel ul {
  margin: 0.6rem 0 0;
  padding-left: 1.25rem;
}
.blocker-panel li {
  margin-top: 0.3rem;
  color: var(--lz-color-muted);
  font-size: 0.72rem;
}
.no-change-panel,
.publish-guardrail {
  gap: 0.7rem;
}
.no-change-panel {
  color: var(--lz-color-success);
  background: rgba(114, 221, 194, 0.07);
}
.no-change-panel > div,
.publish-guardrail > div {
  display: grid;
}
.no-change-panel strong,
.publish-guardrail strong {
  color: var(--lz-color-text);
  font-size: 0.76rem;
}
.no-change-panel span,
.publish-guardrail span {
  color: var(--lz-color-subtle);
  font-size: 0.69rem;
  line-height: 1.55;
}
.publish-guardrail {
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.055);
}
.confirm-step {
  display: grid;
  padding: 1.5rem 0.4rem;
  gap: 1rem;
  justify-items: center;
  text-align: center;
}
.confirm-mark {
  display: grid;
  width: 4rem;
  height: 4rem;
  place-items: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.08);
  border-radius: 1.2rem;
}
.confirm-step h2 {
  margin: 0;
  color: var(--lz-color-text);
  font-size: 1.08rem;
}
.confirm-step p {
  max-width: 28rem;
  margin: 0.45rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.76rem;
  line-height: 1.65;
}
.confirm-step p span {
  white-space: nowrap;
}
.confirm-warning {
  width: 100%;
  color: var(--lz-color-danger);
  font-size: 0.72rem;
  background: rgba(255, 171, 148, 0.07);
}
.publish-footer {
  gap: 0.65rem;
  justify-content: flex-end;
}
@media (max-width: 40rem) {
  .publish-heading small {
    white-space: normal;
  }
  .change-grid {
    gap: 0.45rem;
  }
  .change-grid article {
    min-height: 4.5rem;
    padding: 0.7rem;
  }
  .publish-footer > * {
    flex: 1;
  }
}
</style>
