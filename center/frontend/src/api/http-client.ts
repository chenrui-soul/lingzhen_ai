import axios, { AxiosHeaders, type AxiosError, type InternalAxiosRequestConfig } from 'axios';

import {
  clearSessionSecrets,
  getAccessToken,
  getCsrfToken,
  setAccessToken,
} from '@/api/auth-session';
import { createRequestId } from '@/api/request-id';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const AUTH_RETRY_EXCLUSIONS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/select-tenant',
];

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _sessionRetry?: boolean;
}

interface RefreshResponse {
  accessToken: string;
}

export const httpClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15_000,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
});

let refreshPromise: Promise<string> | null = null;

function isRefreshAllowed(config: RetryableRequestConfig): boolean {
  const url = config.url ?? '';
  return !AUTH_RETRY_EXCLUSIONS.some((path) => url.includes(path));
}

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    const csrfToken = getCsrfToken();
    refreshPromise = axios
      .post<RefreshResponse>(
        `${apiBaseUrl}/auth/refresh`,
        {},
        {
          withCredentials: true,
          timeout: 15_000,
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
        },
      )
      .then((response) => {
        setAccessToken(response.data.accessToken);
        return response.data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

httpClient.interceptors.request.use((config) => {
  const headers = AxiosHeaders.from(config.headers);
  const token = getAccessToken();
  const csrfToken = getCsrfToken();

  headers.set('X-Request-Id', createRequestId());
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (csrfToken && config.method && !['get', 'head', 'options'].includes(config.method)) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  config.headers = headers;
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableRequestConfig | undefined;
    if (
      error.response?.status !== 401 ||
      !config ||
      config._sessionRetry ||
      !isRefreshAllowed(config)
    ) {
      return Promise.reject(error);
    }

    config._sessionRetry = true;
    const hadAccessToken = Boolean(getAccessToken());
    try {
      const accessToken = await refreshAccessToken();
      config.headers = AxiosHeaders.from(config.headers);
      config.headers.set('Authorization', `Bearer ${accessToken}`);
      return await httpClient(config);
    } catch (refreshError) {
      clearSessionSecrets();
      if (hadAccessToken) {
        window.dispatchEvent(new CustomEvent('lingzhen:session-expired'));
      }
      return Promise.reject(refreshError);
    }
  },
);
