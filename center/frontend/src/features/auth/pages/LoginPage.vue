<script setup lang="ts">
import {
  PhArrowLeft,
  PhArrowRight,
  PhBuildings,
  PhLockKey,
  PhShieldCheck,
} from '@phosphor-icons/vue';
import type { FormInstance, Rule } from 'ant-design-vue/es/form';
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAuthStore } from '@/features/auth/stores/auth-store';

interface LoginForm {
  identity: string;
  password: string;
}

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const formRef = ref<FormInstance>();
const isSubmitting = ref(false);
const selectingTenantId = ref<string | null>(null);
const form = reactive<LoginForm>({
  identity: '',
  password: '',
});

const rules: Record<keyof LoginForm, Rule[]> = {
  identity: [
    { required: true, message: '请输入邮箱或用户名', trigger: 'blur' },
    { max: 320, message: '账号长度不能超过 320 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { max: 128, message: '密码长度不能超过 128 个字符', trigger: 'blur' },
  ],
};

const sessionNotice = computed(() => {
  if (route.query.reason === 'session_expired') {
    return '登录状态已过期，请重新登录后继续。';
  }
  if (route.query.reason === 'session_required') {
    return '请先登录管理中心。';
  }
  return '';
});

async function goToWorkspace(): Promise<void> {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
  await router.replace(redirect);
}

async function handleSubmit(): Promise<void> {
  await formRef.value?.validate();
  isSubmitting.value = true;
  try {
    const result = await authStore.login(form.identity, form.password);
    if (result === 'authenticated') {
      await goToWorkspace();
    }
  } catch {
    // The auth store normalizes expected login errors for the inline alert.
  } finally {
    isSubmitting.value = false;
  }
}

async function handleTenantSelect(tenantId: string): Promise<void> {
  selectingTenantId.value = tenantId;
  try {
    await authStore.selectTenant(tenantId);
    await goToWorkspace();
  } catch {
    // Tenant selection errors are rendered inline from the auth store.
  } finally {
    selectingTenantId.value = null;
  }
}
</script>

<template>
  <div class="login-shell">
    <Transition name="login-step" mode="out-in">
      <section v-if="!authStore.tenantSelection" key="credentials" class="login-card">
        <header class="login-card__header">
          <span class="login-card__icon" aria-hidden="true">
            <PhLockKey :size="24" weight="duotone" />
          </span>
          <div>
            <h1>登录管理中心</h1>
            <p>使用灵帧账号继续。</p>
          </div>
        </header>

        <a-alert
          v-if="sessionNotice"
          class="login-card__notice"
          type="info"
          show-icon
          :message="sessionNotice"
        />

        <a-alert
          v-if="authStore.lastError"
          class="login-card__notice"
          type="error"
          show-icon
          :message="authStore.lastError.message"
        />

        <a-form
          ref="formRef"
          class="login-form"
          layout="vertical"
          :model="form"
          :rules="rules"
          @finish="handleSubmit"
        >
          <a-form-item label="邮箱或用户名" name="identity">
            <a-input
              v-model:value="form.identity"
              size="large"
              autocomplete="username"
              placeholder="请输入邮箱或用户名"
            />
          </a-form-item>

          <a-form-item label="密码" name="password">
            <a-input-password
              v-model:value="form.password"
              size="large"
              autocomplete="current-password"
              placeholder="请输入密码"
            />
          </a-form-item>

          <a-button
            class="login-form__submit"
            type="primary"
            size="large"
            html-type="submit"
            :loading="isSubmitting"
            :disabled="isSubmitting"
          >
            <span>进入管理中心</span>
            <span class="login-form__arrow" aria-hidden="true">
              <PhArrowRight :size="17" weight="bold" />
            </span>
          </a-button>
        </a-form>

        <div class="login-card__security">
          <PhShieldCheck :size="18" weight="duotone" aria-hidden="true" />
          <p>凭据仅用于本次登录。访问令牌不会写入浏览器存储。</p>
        </div>
      </section>

      <section v-else key="tenant" class="login-card login-card--tenant">
        <header class="login-card__header">
          <span class="login-card__icon" aria-hidden="true">
            <PhBuildings :size="24" weight="duotone" />
          </span>
          <div>
            <h1>选择工作空间</h1>
            <p>你的账号关联了多个租户，请选择本次进入的空间。</p>
          </div>
        </header>

        <a-alert
          v-if="authStore.lastError"
          class="login-card__notice"
          type="error"
          show-icon
          :message="authStore.lastError.message"
        />

        <div class="tenant-list" role="list">
          <button
            v-for="tenant in authStore.tenantSelection.tenants"
            :key="tenant.tenantId"
            class="tenant-option"
            type="button"
            :disabled="selectingTenantId !== null"
            @click="handleTenantSelect(tenant.tenantId)"
          >
            <span class="tenant-option__mark" aria-hidden="true">
              {{ tenant.tenantName.slice(0, 1) }}
            </span>
            <span class="tenant-option__copy">
              <strong>{{ tenant.tenantName }}</strong>
              <small>{{ tenant.tenantCode }}</small>
            </span>
            <span class="tenant-option__role">{{ tenant.role }}</span>
            <a-spin v-if="selectingTenantId === tenant.tenantId" size="small" />
            <PhArrowRight v-else :size="17" aria-hidden="true" />
          </button>
        </div>

        <button class="tenant-back" type="button" @click="authStore.cancelTenantSelection()">
          <PhArrowLeft :size="16" aria-hidden="true" />
          返回账号登录
        </button>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.login-shell {
  width: min(100%, 29rem);
}

.login-card {
  width: 100%;
  padding: clamp(1.75rem, 3.5vw, 2.5rem);
  background:
    linear-gradient(145deg, rgba(238, 247, 255, 0.025), transparent 38%), var(--lz-color-surface);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-shell);
  box-shadow:
    var(--lz-shadow-panel),
    inset 0 1px 0 rgba(238, 247, 255, 0.04);
}

.login-card__header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1.75rem;
}

.login-card__icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  flex: 0 0 auto;
  place-items: center;
  color: var(--lz-color-accent);
  background: rgba(85, 216, 241, 0.09);
  border: 1px solid rgba(85, 216, 241, 0.16);
  border-radius: 0.9rem;
}

.login-card__header h1 {
  margin: 0;
  color: var(--lz-color-text);
  font-size: 1.6rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.3;
}

.login-card__header p {
  margin: 0.35rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.86rem;
}

.login-card__notice {
  margin-bottom: 1rem;
}

.login-form :deep(.ant-form-item) {
  margin-bottom: 1.25rem;
}

.login-form :deep(.ant-form-item-label > label) {
  color: #c7d5e5;
  font-size: 0.82rem;
  font-weight: 580;
}

.login-form :deep(.ant-input),
.login-form :deep(.ant-input-affix-wrapper) {
  background: var(--lz-color-field);
  border-color: var(--lz-color-line);
  box-shadow: var(--lz-shadow-control);
}

.login-form :deep(.ant-input:hover),
.login-form :deep(.ant-input-affix-wrapper:hover) {
  border-color: rgba(91, 218, 241, 0.38);
}

.login-form :deep(.ant-input:focus),
.login-form :deep(.ant-input-affix-wrapper-focused) {
  border-color: var(--lz-color-line-strong);
  box-shadow: 0 0 0 3px rgba(85, 216, 241, 0.08);
}

.login-form__submit {
  display: flex;
  width: 100%;
  height: 3rem;
  margin-top: 0.4rem;
  padding: 0 0.5rem 0 1.15rem;
  align-items: center;
  justify-content: space-between;
  color: #04131e;
  font-weight: 730;
  border: 0;
  box-shadow: 0 1rem 2rem rgba(33, 174, 203, 0.16);
  transition:
    transform 320ms var(--lz-motion-standard),
    box-shadow 320ms var(--lz-motion-standard),
    background-color 320ms var(--lz-motion-standard);
}

.login-form__submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 1.25rem 2.5rem rgba(33, 174, 203, 0.22);
}

.login-form__submit:active:not(:disabled) {
  transform: scale(0.985);
}

.login-form__arrow {
  display: grid;
  width: 2.05rem;
  height: 2.05rem;
  place-items: center;
  color: #061824;
  background: rgba(4, 19, 30, 0.1);
  border-radius: 0.65rem;
  transition: transform 320ms var(--lz-motion-standard);
}

.login-form__submit:hover .login-form__arrow {
  transform: translateX(2px);
}

.login-card__security {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  margin-top: 1.4rem;
  color: var(--lz-color-subtle);
}

.login-card__security svg {
  flex: 0 0 auto;
  margin-top: 0.1rem;
  color: var(--lz-color-success);
}

.login-card__security p {
  margin: 0;
  font-size: 0.73rem;
  line-height: 1.65;
}

.tenant-list {
  display: grid;
  max-height: 18rem;
  gap: 0.65rem;
  overflow-y: auto;
}

.tenant-option {
  display: grid;
  width: 100%;
  min-height: 4.5rem;
  padding: 0.75rem;
  grid-template-columns: 2.75rem minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  color: var(--lz-color-muted);
  text-align: left;
  cursor: pointer;
  background: var(--lz-color-field);
  border: 1px solid var(--lz-color-line);
  border-radius: var(--lz-radius-control);
  transition:
    transform 280ms var(--lz-motion-standard),
    border-color 280ms var(--lz-motion-standard),
    background-color 280ms var(--lz-motion-standard);
}

.tenant-option:hover:not(:disabled) {
  background: var(--lz-color-surface-strong);
  border-color: rgba(85, 216, 241, 0.34);
  transform: translateY(-1px);
}

.tenant-option:disabled {
  cursor: wait;
  opacity: 0.68;
}

.tenant-option__mark {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  color: var(--lz-color-accent);
  font-weight: 720;
  background: rgba(85, 216, 241, 0.09);
  border-radius: 0.8rem;
}

.tenant-option__copy {
  display: grid;
  min-width: 0;
}

.tenant-option__copy strong,
.tenant-option__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tenant-option__copy strong {
  color: var(--lz-color-text);
  font-size: 0.86rem;
}

.tenant-option__copy small {
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}

.tenant-option__role {
  padding: 0.25rem 0.5rem;
  color: var(--lz-color-muted);
  font-size: 0.66rem;
  background: rgba(140, 177, 218, 0.08);
  border-radius: var(--lz-radius-pill);
}

.tenant-back {
  display: inline-flex;
  min-height: 2.75rem;
  margin-top: 1rem;
  padding: 0 0.5rem;
  gap: 0.45rem;
  align-items: center;
  color: var(--lz-color-subtle);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.tenant-back:hover {
  color: var(--lz-color-text);
}

.login-step-enter-active,
.login-step-leave-active {
  transition:
    opacity 220ms var(--lz-motion-standard),
    transform 220ms var(--lz-motion-standard);
}

.login-step-enter-from,
.login-step-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}

@media (max-height: 43rem) and (min-width: 48.01rem) {
  .login-card {
    padding: 1.45rem 1.75rem;
  }

  .login-card__header {
    margin-bottom: 1.15rem;
  }

  .login-form :deep(.ant-form-item) {
    margin-bottom: 0.85rem;
  }

  .login-card__security {
    margin-top: 0.9rem;
  }
}
</style>
