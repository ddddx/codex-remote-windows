export function createApiFetchJson(getWebSocketToken) {
  return async function apiFetchJson(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getWebSocketToken();
    if (token) {
      headers.set('x-codex-remote-token', token);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  };
}

export function isUnauthorizedApiError(error) {
  return error instanceof Error && error.message === 'Unauthorized';
}
