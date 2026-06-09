import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@codex-remote/protocol';
import type { ServerNotification, ServerRequest } from '@codex-remote/codex-app-server-types';
import {
  createServerRequestRecord,
  listServerRequests,
  persistServerRequest,
  toServerRequestPayload,
} from '../application/services/server-requests.js';
import {
  listRuntimeTabs,
  type RuntimeTab,
} from '../application/services/session-tabs.js';
import { handleCodexNotification } from '../application/services/event-bridge.js';

type RuntimeClientLike = {
  send: (payload: string) => void;
  close?: (code?: number, reason?: string) => void;
};

function logWarn(app: FastifyInstance, payload: Record<string, unknown>, message: string): void {
  if (app.log && typeof app.log.warn === 'function') {
    app.log.warn(payload, message);
    return;
  }
  console.warn(message, payload);
}

function logError(app: FastifyInstance, payload: Record<string, unknown>, message: string): void {
  if (app.log && typeof app.log.error === 'function') {
    app.log.error(payload, message);
    return;
  }
  console.error(message, payload);
}

function removeDeadClient(app: FastifyInstance, client: RuntimeClientLike): void {
  if (app.runtimeState.clients.has(client as any)) {
    app.runtimeState.clients.delete(client as any);
    app.runtimeState.websocketClientCount = Math.max(0, app.runtimeState.websocketClientCount - 1);
  }
}

function sendToClient(app: FastifyInstance, client: RuntimeClientLike, message: ServerMessage): void {
  try {
    client.send(JSON.stringify(message));
  } catch (error) {
    removeDeadClient(app, client);
    logWarn(app, {
      err: error,
      messageType: message.type,
    }, 'failed to send websocket message');
    try {
      client.close?.(1011, 'Send failed');
    } catch {
      // Ignore secondary close errors for dead sockets.
    }
  }
}

export function broadcastMessage(app: FastifyInstance, message: ServerMessage): void {
  for (const client of app.runtimeState.clients) {
    sendToClient(app, client, message);
  }
}

export async function ensureCodexReady(app: FastifyInstance): Promise<void> {
  if (!app.runtimeState.codexStarted) {
    await app.appServerSupervisor.ensureStarted();
    const wsUrl = app.appServerSupervisor.getWsUrl();
    app.codexClient.setWsUrl(wsUrl);
    app.windowManager.setAppServerWs(wsUrl);
    await app.codexClient.start();
    app.runtimeState.codexStarted = true;
  }

  if (app.runtimeState.codexBridgeRegistered) {
    return;
  }

  app.codexClient.on('notification', (msg: ServerNotification) => {
    try {
      handleCodexNotification(app, msg);
    } catch (error) {
      logError(app, {
        err: error,
        method: msg.method,
        params: msg.params,
      }, 'failed to handle codex notification');
      broadcastMessage(app, {
        type: 'backend_error',
        message: `codex notification handler failed for ${msg.method}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.codexClient.on('log', (message: string) => {
    app.log.warn({ source: 'codex-client' }, message);
  });

  app.codexClient.on('server_request', (msg: ServerRequest) => {
    try {
      const request = createServerRequestRecord(msg);
      app.runtimeState.serverRequestsById.set(request.requestId, request);
      persistServerRequest(app, request);
      broadcastMessage(app, {
        type: 'server_request_required',
        request: toServerRequestPayload(request),
      });
    } catch (error) {
      logError(app, {
        err: error,
        method: msg.method,
        requestId: msg.id,
        params: msg.params,
      }, 'failed to handle codex server request');
      broadcastMessage(app, {
        type: 'backend_error',
        message: `codex server request handler failed for ${msg.method}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.codexClient.on('exit', ({ code, signal }: { code: number | null; signal: string | null }) => {
    app.runtimeState.codexStarted = false;
    app.runtimeState.serverRequestsById.clear();
    broadcastMessage(app, { type: 'server_request_reset' });
    if (!app.runtimeState.isShuttingDown) {
      broadcastMessage(app, {
        type: 'backend_error',
        message: `codex app-server exited (code=${code}, signal=${signal})`,
      });
    }
  });

  app.runtimeState.codexBridgeRegistered = true;
}

export function setServerRequestSubmitting(app: FastifyInstance, requestId: string): void {
  const existing = app.runtimeState.serverRequestsById.get(requestId);
  if (!existing) {
    return;
  }
  existing.status = 'submitting';
  existing.submittedAt = Date.now();
  persistServerRequest(app, existing);
  broadcastMessage(app, {
    type: 'server_request_updated',
    request: toServerRequestPayload(existing),
  });
}

export function resetServerRequestPending(app: FastifyInstance, requestId: string): void {
  const existing = app.runtimeState.serverRequestsById.get(requestId);
  if (!existing) {
    return;
  }
  existing.status = 'pending';
  existing.submittedAt = null;
  persistServerRequest(app, existing);
  broadcastMessage(app, {
    type: 'server_request_updated',
    request: toServerRequestPayload(existing),
  });
}
