import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@codex-remote/protocol';
import { isAuthorizedWsToken } from './auth.js';
import { routeClientMessage } from './message-router.js';
import { ensureCodexReady } from './bridge.js';
import { bootstrapTabs, buildInitialState } from '../application/services/thread-sync.js';

type WsLike = {
  send: (payload: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
};

function sendMessage(socket: WsLike, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function normalizeIncomingMessage(raw: string): ClientMessage {
  return JSON.parse(raw) as ClientMessage;
}

export async function registerWsGateway(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const token = typeof (request.query as Record<string, unknown> | undefined)?.token === 'string'
      ? (request.query as Record<string, string>).token
      : undefined;

    if (!isAuthorizedWsToken(token, app.config.wsToken)) {
      sendMessage(socket, {
        type: 'error',
        code: 'AUTH_FAILED',
        message: 'WebSocket 鉴权失败，请检查 token 是否正确。',
      });
      socket.close(4401, 'Unauthorized');
      return;
    }

    app.runtimeState.websocketClientCount += 1;
    app.runtimeState.clients.add(socket);

    void (async () => {
      try {
        await ensureCodexReady(app);
        await bootstrapTabs(app);
        await app.windowAttachments.refreshAllTabsWindowStatus().catch(() => {});
        sendMessage(socket, buildInitialState(app));
      } catch (error) {
        sendMessage(socket, {
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
        sendMessage(socket, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Invalid WebSocket message',
        });
      }
    });

    socket.on('close', () => {
      app.runtimeState.websocketClientCount = Math.max(0, app.runtimeState.websocketClientCount - 1);
      app.runtimeState.clients.delete(socket);
    });
  });
}
