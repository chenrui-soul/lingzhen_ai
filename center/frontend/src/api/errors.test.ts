import { AxiosError, AxiosHeaders } from 'axios';

import { AppError, toAppError } from '@/api/errors';

describe('toAppError', () => {
  it('preserves backend request information', () => {
    const error = new AxiosError(
      'Request failed',
      'ERR_BAD_REQUEST',
      { headers: new AxiosHeaders() },
      undefined,
      {
        data: {
          requestId: 'request-42',
          code: 'VALIDATION_ERROR',
          message: '请求参数校验失败',
          fieldErrors: { identity: '不能为空' },
        },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
      },
    );

    const appError = toAppError(error);

    expect(appError).toMatchObject({
      title: '提交内容有误',
      message: '请求参数校验失败',
      code: 'VALIDATION_ERROR',
      status: 400,
      requestId: 'request-42',
      fieldErrors: { identity: '不能为空' },
    });
  });

  it('does not wrap an existing AppError again', () => {
    const original = new AppError({ title: '已知错误', message: '请重试' });
    expect(toAppError(original)).toBe(original);
  });
});
