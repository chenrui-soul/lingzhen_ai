import axios from 'axios';

export interface ApiErrorBody {
  timestamp?: string;
  requestId?: string;
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export class AppError extends Error {
  readonly title: string;
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly fieldErrors: Record<string, string>;

  constructor(options: {
    title: string;
    message: string;
    code?: string;
    status?: number;
    requestId?: string;
    fieldErrors?: Record<string, string>;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.title = options.title;
    this.code = options.code ?? 'UNKNOWN_ERROR';
    this.status = options.status ?? 0;
    this.requestId = options.requestId;
    this.fieldErrors = options.fieldErrors ?? {};
  }
}

const STATUS_TITLES: Record<number, string> = {
  400: '提交内容有误',
  401: '登录状态已失效',
  403: '暂无访问权限',
  404: '请求内容不存在',
  409: '数据状态已变化',
  429: '操作过于频繁',
  500: '服务暂时不可用',
};

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const status = error.response?.status ?? 0;
    const body = error.response?.data;
    return new AppError({
      title: STATUS_TITLES[status] ?? (status === 0 ? '网络连接异常' : '请求未完成'),
      message:
        body?.message ??
        (status === 0 ? '无法连接服务，请检查网络或确认后台服务已经启动。' : '请稍后重试。'),
      code: body?.code ?? error.code,
      status,
      requestId: body?.requestId,
      fieldErrors: body?.fieldErrors,
    });
  }

  return new AppError({
    title: '页面出现异常',
    message: error instanceof Error ? error.message : '发生了无法识别的错误，请重试。',
  });
}
