<script setup lang="ts">
import AppLogo from '@/components/AppLogo.vue';
</script>

<template>
  <main class="auth-layout">
    <section class="auth-layout__story" aria-label="管理中心介绍">
      <AppLogo />

      <div class="auth-layout__message">
        <span class="auth-layout__label">统一管理入口</span>
        <h1>让权限、模型与服务状态保持清晰。</h1>
        <p>集中管理灵帧账号、租户和平台能力。桌面端专注创作，管理操作在这里完成。</p>
      </div>

      <div class="auth-layout__assurance" aria-label="安全说明">
        <span>安全会话</span>
        <span>租户隔离</span>
        <span>操作留痕</span>
      </div>
    </section>

    <section class="auth-layout__workspace" aria-label="登录区域">
      <div class="auth-layout__mobile-brand">
        <AppLogo />
      </div>
      <RouterView />
      <p class="auth-layout__footer">灵帧管理中心</p>
    </section>
  </main>
</template>

<style scoped>
.auth-layout {
  display: grid;
  width: 100%;
  min-height: 100dvh;
  max-height: 100dvh;
  grid-template-columns: minmax(25rem, 0.92fr) minmax(34rem, 1.08fr);
  overflow: hidden;
  background:
    radial-gradient(circle at 8% 16%, rgba(85, 216, 241, 0.1), transparent 28rem),
    linear-gradient(145deg, var(--lz-color-bg-deep), var(--lz-color-bg));
}

.auth-layout__story {
  position: relative;
  display: flex;
  min-width: 0;
  padding: clamp(2.25rem, 4vw, 4.5rem);
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  background:
    linear-gradient(150deg, rgba(14, 29, 49, 0.92), rgba(5, 12, 23, 0.84)), var(--lz-color-bg-deep);
  border-right: 1px solid var(--lz-color-line);
}

.auth-layout__story::before {
  position: absolute;
  right: -9rem;
  bottom: -8rem;
  width: 29rem;
  height: 29rem;
  content: '';
  border: 1px solid rgba(85, 216, 241, 0.09);
  border-radius: 50%;
  box-shadow:
    0 0 0 4.5rem rgba(85, 216, 241, 0.018),
    0 0 0 9rem rgba(85, 216, 241, 0.012);
  pointer-events: none;
}

.auth-layout__message {
  position: relative;
  z-index: 1;
  max-width: 35rem;
  margin-top: auto;
  margin-bottom: auto;
  padding: 3rem 0;
}

.auth-layout__label {
  display: inline-flex;
  margin-bottom: 1.35rem;
  color: var(--lz-color-accent);
  font-size: 0.72rem;
  font-weight: 680;
  letter-spacing: 0.12em;
}

.auth-layout__message h1 {
  max-width: 32rem;
  margin: 0;
  color: var(--lz-color-text);
  font-size: clamp(2.15rem, 3.4vw, 3.85rem);
  font-weight: 660;
  letter-spacing: -0.045em;
  line-height: 1.12;
}

.auth-layout__message p {
  max-width: 31rem;
  margin: 1.5rem 0 0;
  color: var(--lz-color-muted);
  font-size: 0.98rem;
  line-height: 1.85;
}

.auth-layout__assurance {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 1.5rem;
  color: var(--lz-color-subtle);
  font-size: 0.75rem;
}

.auth-layout__assurance span {
  position: relative;
}

.auth-layout__assurance span + span::before {
  position: absolute;
  top: 50%;
  left: -0.8rem;
  width: 1px;
  height: 0.75rem;
  content: '';
  background: var(--lz-color-line);
  transform: translateY(-50%);
}

.auth-layout__workspace {
  display: grid;
  min-width: 0;
  padding: clamp(2rem, 5vw, 5rem);
  place-items: center;
  align-content: center;
  background: rgba(7, 17, 30, 0.72);
}

.auth-layout__mobile-brand {
  display: none;
}

.auth-layout__footer {
  position: absolute;
  right: clamp(2rem, 5vw, 5rem);
  bottom: 1.5rem;
  margin: 0;
  color: var(--lz-color-subtle);
  font-size: 0.7rem;
}

@media (max-width: 64rem) {
  .auth-layout {
    grid-template-columns: minmax(20rem, 0.78fr) minmax(31rem, 1.22fr);
  }

  .auth-layout__story {
    padding: 2.25rem;
  }

  .auth-layout__message h1 {
    font-size: clamp(2rem, 3.8vw, 2.8rem);
  }
}

@media (max-width: 48rem) {
  .auth-layout {
    display: block;
    min-height: 100dvh;
    max-height: none;
    overflow-y: auto;
  }

  .auth-layout__story {
    display: none;
  }

  .auth-layout__workspace {
    position: relative;
    min-height: 100dvh;
    padding: 2rem 1.25rem 4rem;
    align-content: start;
  }

  .auth-layout__mobile-brand {
    display: block;
    width: 100%;
    max-width: 29rem;
    margin: 0 auto 2.25rem;
  }

  .auth-layout__footer {
    right: 1.25rem;
    bottom: 1rem;
  }
}
</style>
