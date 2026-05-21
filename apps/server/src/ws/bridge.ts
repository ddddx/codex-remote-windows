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

function sendToClient(client: { send: (payload: string) => void }, message: ServerMessage): void {
  client.send(JSON.stringify(message));
}

export function broadcastMessage(app: FastifyInstance, message: ServerMessage): void {
  for (const client of app.runtimeState.clients) {
    sendToClient(client, message);
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
    handleCodexNotification(app, msg);
  });

  app.codexClient.on('log', (message: string) => {
    app.log.warn({ source: 'codex-client' }, message);
  });

  app.codexClient.on('server_request', (msg: ServerRequest) => {
    const request = createServerRequestRecord(msg);
    app.runtimeState.serverRequestsById.set(request.requestId, request);
    persistServerRequest(app, request);
    broadcastMessage(app, {
      type: 'server_request_required',
      request: toServerRequestPayload(request),
    });
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
