const TOKEN_STORAGE_KEY = 'codex-remote-ws-token';
const DEVICE_ID_STORAGE_KEY = 'codex-remote-device-id';
const ACTIVE_SESSION_STORAGE_KEY = 'codex-remote-active-session-id';

function readTokenFromUrl(): string {
  try {
    const url = new URL(window.location.href);
    const token = (url.searchParams.get('token') || '').trim();
    if (!token) {
      return '';
    }
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.toString());
    return token;
  } catch {
    return '';
  }
}

export function readStoredToken(): string {
  const urlToken = readTokenFromUrl();
  if (urlToken) {
    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
    } catch {
      // Ignore storage failures.
    }
    return urlToken;
  }

  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeStoredToken(token: string): string {
  const normalized = typeof token === 'string' ? token.trim() : '';
  try {
    if (normalized) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
  return normalized;
}

export function readStoredActiveSessionId(): string {
  try {
    return (window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function writeStoredActiveSessionId(threadId: string): string {
  const normalized = typeof threadId === 'string' ? threadId.trim() : '';
  try {
    if (normalized) {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
  return normalized;
}

function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readOrCreateDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY) || '';
    if (existing) {
      return existing;
    }
    const created = generateDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return generateDeviceId();
  }
}
