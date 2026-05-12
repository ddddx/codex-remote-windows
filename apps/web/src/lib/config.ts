function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || fallback;
}

function readImportMetaEnv(name: string): string | undefined {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.[name];
}

function detectBrowserBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://127.0.0.1:18637';
}

export const apiBaseUrl = normalizeBaseUrl(
  readImportMetaEnv('VITE_API_BASE_URL'),
  detectBrowserBaseUrl(),
);

export function buildApiUrl(pathname: string): string {
  return new URL(pathname, apiBaseUrl).toString();
}

export function buildWsUrl(token?: string): string {
  const explicit = readImportMetaEnv('VITE_WS_URL');
  const base = explicit?.trim()
    || new URL('/ws', apiBaseUrl.replace(/^http/, 'ws')).toString();
  const url = new URL(base);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}
