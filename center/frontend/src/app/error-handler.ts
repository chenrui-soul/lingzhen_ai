import Modal from 'ant-design-vue/es/modal';
import type { App } from 'vue';

import { toAppError } from '@/api/errors';

let isErrorDialogVisible = false;

export function showGlobalError(error: unknown): void {
  if (isErrorDialogVisible) {
    return;
  }

  const appError = toAppError(error);
  isErrorDialogVisible = true;
  Modal.error({
    title: appError.title,
    content: appError.requestId
      ? `${appError.message} 请求编号：${appError.requestId}`
      : appError.message,
    okText: '我知道了',
    centered: true,
    afterClose: () => {
      isErrorDialogVisible = false;
    },
  });
}

export function installGlobalErrorHandler(app: App): void {
  app.config.errorHandler = (error) => {
    showGlobalError(error);
  };

  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    showGlobalError(event.reason);
  });
}

export function resetGlobalErrorDialogForTest(): void {
  isErrorDialogVisible = false;
}
