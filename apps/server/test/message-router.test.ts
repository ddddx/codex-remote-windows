import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeState } from '../src/state/runtime-state.js';
import { routeClientMessage } from '../src/ws/message-router.js';

function createSocket() {
  const sent: unknown[] = [];
  return {
    sent,
    send(payload: string) {
      sent.push(JSON.parse(payload));
    },
  };
}

function createAppStub() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const runtimeState = createRuntimeState();
  const calls = {
    startThread: [] as unknown[],
    startTurn: [] as unknown[],
    resumeThread: [] as unknown[],
    respond: [] as unknown[],
  };

  const app = {
    runtimeState,
    workspaceManager: {
      resolveWorkspacePath(inputPath?: string) {
        return inputPath || 'C:\\workspace';
      },
    },
    codexClient: {
      async start() {},
      async stop() {},
      async listThreads() {
        return [];
      },
      async startThread(options: unknown) {
        calls.startThread.push(options);
        return {
          id: '00000000-0000-0000-0000-000000000123',
          name: 'Created thread',
          cwd: 'C:\\workspace',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async resumeThread(threadId: string) {
        calls.resumeThread.push(threadId);
        return {
          id: threadId,
          name: 'Resumed thread',
          cwd: 'C:\\workspace',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
          turns: [
            {
              id: 'turn-1',
              input: [{ type: 'text', text: 'hello' }],
              output: 'world',
            },
          ],
          tokenUsage: { totalTokens: 12 },
        };
      },
      async startTurn(threadId: string, text: string, options: unknown) {
        calls.startTurn.push({ threadId, text, options });
        return {
          id: 'turn-live',
        };
      },
      async listModels() {
        return [];
      },
      async readConfig() {
        return { config: {} };
      },
      respond(id: string | number, result: unknown) {
        calls.respond.push({ id, result });
      },
      respondError() {},
      on(event: string, listener: (...args: any[]) => void) {
        const existing = listeners.get(event) || [];
        existing.push(listener);
        listeners.set(event, existing);
      },
    },
  };

  return {
    app: app as any,
    calls,
    listeners,
  };
}

test('thread_sync returns tab update and thread snapshot', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();

  await routeClientMessage(app, socket as any, {
    type: 'thread_sync',
    threadId: '00000000-0000-0000-0000-000000000999',
  });

  assert.equal(calls.resumeThread.length, 1);
  assert.equal(socket.sent.length, 2);
  assert.equal((socket.sent[0] as any).type, 'tab_updated');
  assert.equal((socket.sent[1] as any).type, 'thread_sync');
  assert.equal((socket.sent[1] as any).tokenUsage.totalTokens, 12);
});

test('tab_create creates thread and replies with tab_created', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();

  await routeClientMessage(app, socket as any, {
    type: 'tab_create',
    name: 'New thread',
    cwd: 'C:\\workspace\\demo',
  });

  assert.equal(calls.startThread.length, 1);
  assert.equal(socket.sent.length, 1);
  assert.equal((socket.sent[0] as any).type, 'tab_created');
  assert.equal(app.runtimeState.tabsById.size, 1);
});

test('turn_send starts a turn and updates runtime tab status', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.tabsById.set('00000000-0000-0000-0000-000000000123', {
    threadId: '00000000-0000-0000-0000-000000000123',
    name: 'Existing',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'detached',
  });

  await routeClientMessage(app, socket as any, {
    type: 'turn_send',
    threadId: '00000000-0000-0000-0000-000000000123',
    text: 'hello',
    attachments: [],
  });

  assert.equal(calls.startTurn.length, 1);
  assert.equal(app.runtimeState.tabsById.get('00000000-0000-0000-0000-000000000123')?.status, 'running');
});

test('server_request_respond replies through codex client', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.serverRequestsById.set('req-1', {
    requestId: 'req-1',
    rawRequestId: 'raw-1',
    method: 'item/commandExecution/requestApproval',
    kind: 'command_approval',
    status: 'pending',
    createdAt: Date.now(),
    threadId: '00000000-0000-0000-0000-000000000123',
  });

  await routeClientMessage(app, socket as any, {
    type: 'server_request_respond',
    requestId: 'req-1',
    response: { decision: 'accept' },
  });

  assert.equal(calls.respond.length, 1);
  assert.deepEqual(calls.respond[0], {
    id: 'raw-1',
    result: { decision: 'accept' },
  });
  assert.equal(app.runtimeState.serverRequestsById.get('req-1')?.status, 'submitting');
});
