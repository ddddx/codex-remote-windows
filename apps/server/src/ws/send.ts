import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@codex-remote/protocol';

export type RuntimeSocketLike = {
  send: (payload: string) => void;
  close?: (code?: number, reason?: string) => void;
};

function removeDeadClient(app: FastifyInstance, socket: RuntimeSocketLike): void {
  if (!app.runtimeState.clients.has(socket as any)) {
    return;
  }
  app.runtimeState.clients.delete(socket as any);
  app.runtimeState.websocketClientCount = Math.max(0, app.runtimeState.websocketClientCount - 1);
}

export function sendServerMessage(app: FastifyInstance, socket: RuntimeSocketLike, message: ServerMessage): boolean {
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    removeDeadClient(app, socket);
    if (app.log && typeof app.log.warn === 'function') {
      app.log.warn({
        err: error,
        messageType: message.type,
      }, 'failed to send websocket message');
    }
    try {
      socket.close?.(1011, 'Send failed');
    } catch {
      // Dead sockets may also fail during close.
    }
    return false;
  }
}
