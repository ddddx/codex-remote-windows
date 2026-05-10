const WEBSOCKET_TOKEN_STORAGE_KEY = 'codex-remote-ws-token';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

function getReconnectDelayMs(attempt) {
  const baseDelay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * (2 ** attempt));
  const jitter = 0.85 + (Math.random() * 0.3);
  return Math.round(baseDelay * jitter);
}

export function createSocketController(deps) {
  const {
    state,
    render,
    renderMessages,
    clearTransientConnectionNotices,
    loadComposerOptions,
    openTextModal,
    isTextModalOpen,
    handleMessage,
  } = deps;

  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let currentSocket = null;

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function stripTokenFromLocation() {
    try {
      const nextUrl = new URL(window.location.href);
      if (!nextUrl.searchParams.has('token')) {
        return;
      }
      nextUrl.searchParams.delete('token');
      window.history.replaceState(null, '', nextUrl);
    } catch (_error) {
      // Ignore URL rewrite failures.
    }
  }

  function getWebSocketToken() {
    const queryToken = new URLSearchParams(window.location.search).get('token');
    try {
      if (queryToken) {
        window.localStorage.setItem(WEBSOCKET_TOKEN_STORAGE_KEY, queryToken);
        stripTokenFromLocation();
        return queryToken;
      }
      return window.localStorage.getItem(WEBSOCKET_TOKEN_STORAGE_KEY) || '';
    } catch (_error) {
      return queryToken || '';
    }
  }

  function withAuthTokenQuery(url) {
    const token = getWebSocketToken();
    if (!token) {
      return url;
    }
    const resolved = new URL(url, window.location.origin);
    resolved.searchParams.set('token', token);
    return `${resolved.pathname}${resolved.search}`;
  }

  function setWebSocketToken(token) {
    const normalized = typeof token === 'string' ? token.trim() : '';
    try {
      if (normalized) {
        window.localStorage.setItem(WEBSOCKET_TOKEN_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(WEBSOCKET_TOKEN_STORAGE_KEY);
      }
    } catch (_error) {
      // Ignore storage failures.
    } finally {
      stripTokenFromLocation();
    }

    return normalized;
  }

  function clearConnectionError() {
    if (!state.authFailed && !state.connectionError) {
      return;
    }
    state.authFailed = false;
    state.connectionError = '';
    render();
  }

  function isAuthFailureClose(event) {
    return event.code === 4401 || event.reason === 'Unauthorized';
  }

  function markAuthFailed(message) {
    clearReconnectTimer();
    reconnectAttempt = 0;
    const changed = !state.authFailed || state.connectionError !== message;
    state.authFailed = true;
    state.connectionError = message;
    if (changed) {
      render();
    }
    if (!isTextModalOpen()) {
      void promptForWebSocketToken({
        title: 'WebSocket 鉴权失败',
        label: '访问 Token',
        placeholder: '请输入服务端配置的 WS_TOKEN',
        defaultValue: getWebSocketToken(),
        confirmText: '保存并重连',
        inputType: 'password',
      });
    }
  }

  function disconnectSocket() {
    const socket = currentSocket;
    currentSocket = null;
    if (!socket) {
      return;
    }

    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  function send(payload) {
    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      currentSocket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function scheduleReconnect() {
    if (reconnectTimer || state.authFailed) {
      return;
    }

    const delay = getReconnectDelayMs(reconnectAttempt);
    reconnectAttempt += 1;
    console.log(`ws closed, reconnecting in ${Math.round(delay / 1000)}s...`);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    disconnectSocket();
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = new URL(`${wsProtocol}://${window.location.host}/ws`);
    const token = getWebSocketToken();
    if (token) {
      wsUrl.searchParams.set('token', token);
    }

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      if (currentSocket !== socket) {
        return;
      }
      console.log('ws connected');
      reconnectAttempt = 0;
      clearReconnectTimer();
      clearConnectionError();
      const cleared = clearTransientConnectionNotices();
      if (state.activeThreadId) {
        send({ type: 'thread_sync', threadId: state.activeThreadId });
      }
      if (cleared) {
        renderMessages();
      }
    };

    socket.onmessage = (event) => {
      if (currentSocket !== socket) {
        return;
      }
      try {
        handleMessage(JSON.parse(event.data));
      } catch (error) {
        console.error('ws parse error', error);
      }
    };

    socket.onclose = (event) => {
      if (currentSocket === socket) {
        currentSocket = null;
      }
      if (isAuthFailureClose(event)) {
        markAuthFailed('WebSocket 鉴权失败，请检查 token 是否正确，然后刷新页面重试。');
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = (error) => {
      if (currentSocket !== socket) {
        return;
      }
      console.error('ws error', error);
      socket.close();
    };

    currentSocket = socket;
  }

  function reconnectNow() {
    clearReconnectTimer();
    reconnectAttempt = 0;
    disconnectSocket();
    connect();
  }

  async function promptForWebSocketToken(options = {}) {
    const token = await openTextModal({
      title: options.title || '设置 WebSocket Token',
      label: options.label || '访问 Token',
      placeholder: options.placeholder || '请输入服务端配置的 WS_TOKEN',
      defaultValue: options.defaultValue ?? getWebSocketToken(),
      confirmText: options.confirmText || '保存并重连',
      inputType: options.inputType || 'password',
    });

    if (token === null) {
      return false;
    }

    setWebSocketToken(token);
    clearConnectionError();
    reconnectNow();
    return true;
  }

  return {
    connect,
    disconnectSocket,
    getWebSocketToken,
    isSocketConnected: () => !!(currentSocket && currentSocket.readyState === WebSocket.OPEN),
    markAuthFailed,
    promptForWebSocketToken,
    reconnectNow,
    send,
    setWebSocketToken,
    withAuthTokenQuery,
  };
}
