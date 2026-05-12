import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeState } from '../src/state/runtime-state.js';
import { registerWsGateway } from '../src/ws/gateway.js';

function createSocket() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const sent: unknown[] = [];

  return {
    sent,
    closeArgs: null as { code?: number; reason?: string } | null,
    send(payload: string) {
      sent.push(JSON.parse(payload));
    },
    close(code?: number, reason?: string) {
      this.closeArgs = { code, reason };
    },
    on(event: string, listener: (...args: any[]) => void) {
      handlers.set(event, listener);
    },
    emit(event: string, ...args: any[]) {
      handlers.get(event)?.(...args);
    },
  };
}

function createAppStub() {
  const routes = new Map<string, (socket: any, request: any) => void>();
  const runtimeState = createRuntimeState();
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const calls = {
    refreshAllTabsWindowStatus: 0,
  };

  const app = {
    config: { wsToken: 'secret-token' },
    runtimeState,
    repositories: {
      sessions: {
        listSessions() {
          return [];
        },
        upsertSession() {},
      },
      pendingRequests: {
        listPendingRequests() {
          return [];
        },
        upsertPendingRequest() {},
      },
      threadPreferences: {
        upsertThreadPreference() {},
      },
    },
    codexClient: {
      async start() {},
      async listThreads() {
        return [{
          id: 'thread-1',
          name: 'Thread 1',
          cwd: 'C:\\workspace',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
        }];
      },
      on(event: string, listener: (...args: any[]) => void) {
        const existing = listeners.get(event) || [];
        existing.push(listener);
        listeners.set(event, existing);
      },
    },
    appServerSupervisor: {
      async ensureStarted() {},
      async stop() {},
    },
    windowAttachments: {
      async refreshAllTabsWindowStatus() {
        calls.refreshAllTabsWindowStatus += 1;
      },
    },
    get(path: string, options: any, handler: (socket: any, request: any) => void) {
      assert.equal(path, '/ws');
      assert.equal(options.websocket, true);
      routes.set(path, handler);
    },
  };

  return {
    app: app as any,
    routes,
    calls,
  };
}

test('ws gateway rejects unauthorized connection', async () => {
  const { app, routes } = createAppStub();
  await registerWsGateway(app);

  const socket = createSocket();
  const handler = routes.get('/ws');
  assert.ok(handler);

  handler?.(socket, { query: { token: 'wrong-token' } });

  assert.equal(socket.sent.length, 1);
  assert.equal((socket.sent[0] as any).type, 'error');
  assert.deepEqual(socket.closeArgs, { code: 4401, reason: 'Unauthorized' });
});

test('ws gateway bootstraps and emits initial state for authorized connection', async () => {
  const { app, routes, calls } = createAppStub();
  await registerWsGateway(app);

  const socket = createSocket();
  const handler = routes.get('/ws');
  assert.ok(handler);

  handler?.(socket, { query: { token: 'secret-token' } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(app.runtimeState.websocketClientCount, 1);
  assert.equal(app.runtimeState.clients.has(socket as any), true);
  assert.equal(calls.refreshAllTabsWindowStatus, 1);
  assert.equal(socket.sent.length, 1);
  assert.equal((socket.sent[0] as any).type, 'state');
  assert.equal((socket.sent[0] as any).tabs.length, 1);
});
