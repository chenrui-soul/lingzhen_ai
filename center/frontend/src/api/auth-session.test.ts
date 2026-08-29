import {
  clearSessionSecrets,
  getAccessToken,
  getCsrfToken,
  setAccessToken,
  setCsrfToken,
} from '@/api/auth-session';

describe('in-memory auth session', () => {
  afterEach(() => {
    clearSessionSecrets();
  });

  it('keeps security values in memory without browser storage', () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const sessionStorageSpy = vi.spyOn(window.sessionStorage, 'setItem');

    setAccessToken('access-token');
    setCsrfToken('csrf-token');

    expect(getAccessToken()).toBe('access-token');
    expect(getCsrfToken()).toBe('csrf-token');
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });

  it('clears all session secrets together', () => {
    setAccessToken('access-token');
    setCsrfToken('csrf-token');
    clearSessionSecrets();

    expect(getAccessToken()).toBeNull();
    expect(getCsrfToken()).toBeNull();
  });

  it('recovers the double-submit csrf value from the browser cookie after reload', () => {
    document.cookie = 'LZ_CSRF=cookie-csrf-value; Path=/';

    expect(getCsrfToken()).toBe('cookie-csrf-value');

    document.cookie = 'LZ_CSRF=; Max-Age=0; Path=/';
  });
});
