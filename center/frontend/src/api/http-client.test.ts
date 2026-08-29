import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { clearSessionSecrets, setAccessToken } from '@/api/auth-session';
import { httpClient } from '@/api/http-client';

const originalAdapter = httpClient.defaults.adapter;

function createUnauthorizedAdapter(): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    const response: AxiosResponse = {
      data: { message: '登录会话无效或已过期' },
      status: 401,
      statusText: 'Unauthorized',
      headers: new AxiosHeaders(),
      config,
    };

    return Promise.reject(
      new AxiosError(
        'Request failed with status code 401',
        'ERR_BAD_REQUEST',
        config,
        null,
        response,
      ),
    );
  };
}

describe('http client session recovery', () => {
  beforeEach(() => {
    clearSessionSecrets();
    httpClient.defaults.adapter = createUnauthorizedAdapter();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh rejected'));
  });

  afterEach(() => {
    clearSessionSecrets();
    httpClient.defaults.adapter = originalAdapter;
  });

  it('does not report session expiry for a first anonymous bootstrap request', async () => {
    const handleSessionExpired = vi.fn();
    window.addEventListener('lingzhen:session-expired', handleSessionExpired);

    await expect(httpClient.get('/auth/me')).rejects.toThrow('refresh rejected');

    expect(handleSessionExpired).not.toHaveBeenCalled();
    window.removeEventListener('lingzhen:session-expired', handleSessionExpired);
  });

  it('reports session expiry when a signed-in session cannot be refreshed', async () => {
    setAccessToken('expired-access-token');
    const handleSessionExpired = vi.fn();
    window.addEventListener('lingzhen:session-expired', handleSessionExpired);

    await expect(httpClient.get('/protected-resource')).rejects.toThrow('refresh rejected');

    expect(handleSessionExpired).toHaveBeenCalledOnce();
    window.removeEventListener('lingzhen:session-expired', handleSessionExpired);
  });

  it('sends the csrf cookie value when refreshing an access token', async () => {
    document.cookie = 'LZ_CSRF=refresh-csrf-value; Path=/';
    vi.mocked(axios.post).mockResolvedValue({ data: { accessToken: 'renewed-token' } });
    httpClient.defaults.adapter = createUnauthorizedAdapter();

    await expect(httpClient.get('/protected-resource')).rejects.toBeInstanceOf(AxiosError);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      {},
      expect.objectContaining({
        headers: { 'X-CSRF-Token': 'refresh-csrf-value' },
        withCredentials: true,
      }),
    );
    document.cookie = 'LZ_CSRF=; Max-Age=0; Path=/';
  });
});
