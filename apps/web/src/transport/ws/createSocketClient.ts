import type { ClientMessage, ServerMessage } from '@codex-remote/protocol';
import { buildWsUrl } from '../../lib/config.js';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'auth_failed';

type Handlers = {
  onMessage: (message: ServerMessage) => void;
  onStatusChange: (status: ConnectionStatus, error?: string) => void;
};

export function createSocketClient(handlers: Handlers) {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let currentToken = '';
  let queuedMessages: ClientMessage[] = [];

  function flushQueuedMessages() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !queuedMessages.length) {
      return;
    }
    const pending = queuedMessages;
    queuedMessages = [];
    for (const message of pending) {
      socket.send(JSON.stringify(message));
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer == null) {
      return;
    }
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function notifyStatus(status: ConnectionStatus, error?: string) {
    handlers.onStatusChange(status, error);
  }

  function scheduleReconnect() {
    if (reconnectTimer != null) {
      return;
    }
    const delay = Math.min(30_000, 1_000 * (2 ** reconnectAttempt));
    reconnectAttempt += 1;
    notifyStatus('disconnected', `连接已断开，${Math.max(1, Math.round(delay / 1000))} 秒后重连…`);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect(currentToken);
    }, delay);
  }

  async function connect(token: string) {
    currentToken = token;
    clearReconnectTimer();
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    }

    notifyStatus('connecting');
    socket = new WebSocket(buildWsUrl(token));

    socket.onopen = () => {
      reconnectAttempt = 0;
      notifyStatus('connected');
      flushQueuedMessages();
    };

    socket.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as ServerMessage;
      if (payload.type === 'error' && payload.code === 'AUTH_FAILED') {
        notifyStatus('auth_failed', payload.message);
        socket?.close();
        return;
      }
      handlers.onMessage(payload);
    };

    socket.onclose = () => {
      if (!currentToken) {
        notifyStatus('idle');
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
      notifyStatus('disconnected', '连接异常');
    };
  }

  function send(message: ClientMessage): boolean {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    if (!currentToken) {
      return false;
    }
    queuedMessages = [...queuedMessages, message].slice(-100);
    if (!socket) {
      void connect(currentToken);
    }
    return true;
  }

  function disconnect() {
    currentToken = '';
    queuedMessages = [];
    clearReconnectTimer();
    if (socket) {
      socket.close();
      socket = null;
    }
    notifyStatus('idle');
  }

  return {
    connect,
    disconnect,
    send,
  };
}
