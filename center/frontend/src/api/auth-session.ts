let accessToken: string | null = null;
let csrfToken: string | null = null;
const CSRF_COOKIE_NAME = 'LZ_CSRF';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken ?? readCookie(CSRF_COOKIE_NAME);
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function clearSessionSecrets(): void {
  accessToken = null;
  csrfToken = null;
}
