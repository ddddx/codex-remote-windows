import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@codex-remote/protocol';
import { isAuthorizedWsSession } from './auth.js';
import { routeClientMessage } from './message-router.js';
import { ensureCodexReady } from './bridge.js';
import { bootstrapTabs, buildInitialState, hydratePersistedRuntimeState } from '../application/services/thread-sync.js';
import { sendServerMessage } from './send.js';

type WsLike = {
  send: (payload: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
};

function sendMessage(app: FastifyInstance, socket: WsLike, message: ServerMessage): boolean {
  return sendServerMessage(app, socket, message);
}

function normalizeIncomingMessage(raw: string): ClientMessage {
  return JSON.parse(raw) as ClientMessage;
}

export async function registerWsGateway(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const auth = app.authorizeCookieSession(typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined);

    if (!auth || !isAuthorizedWsSession(auth.sessionId)) {
      sendMessage(app, socket, {
        type: 'error',
        code: 'AUTH_FAILED',
        message: 'WebSocket 鉴权失败，请先重新登录。',
      });
      socket.close(4401, 'Unauthorized');
      return;
    }

    const authSessionId = auth.sessionId;
    const authRecord = app.runtimeState.authSessionsById.get(authSessionId);
    const authedSocket = socket as typeof socket & { authSessionId?: string; authDeviceName?: string };
    authedSocket.authSessionId = authSessionId;
    authedSocket.authDeviceName = authRecord?.deviceName || '当前设备';
    app.runtimeState.websocketClientCount += 1;
    app.runtimeState.clients.add(authedSocket);
    hydratePersistedRuntimeState(app);
    sendMessage(app, socket, buildInitialState(app));

    void (async () => {
      try {
        await ensureCodexReady(app);
        await bootstrapTabs(app);
        await app.windowAttachments.refreshAllTabsWindowStatus().catch(() => {});
        sendMessage(app, socket, buildInitialState(app));
      } catch (error) {
        sendMessage(app, socket, buildInitialState(app));
        sendMessage(app, socket, {
          type: 'backend_error',
          message: error instanceof Error ? error.message : 'Failed to bootstrap WebSocket state',
        });
      }
    })();

    socket.on('message', async (raw: Buffer) => {
      try {
        const message = normalizeIncomingMessage(raw.toString());
        await routeClientMessage(app, socket, message);
      } catch (error) {
        sendMessage(app, socket, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Invalid WebSocket message',
        });
      }
    });

    socket.on('close', () => {
      app.runtimeState.websocketClientCount = Math.max(0, app.runtimeState.websocketClientCount - 1);
      app.runtimeState.clients.delete(authedSocket);
    });
  });
}
