import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function createWorkspaceStub() {
  return {
    getShortcuts() {
      return {
        projectRoot: 'C:\\workspace',
        desktopPath: 'C:\\Users\\Administrator\\Desktop',
        lastUsedPath: 'C:\\workspace',
        preferredPath: 'C:\\workspace',
        roots: ['C:\\workspace'],
      };
    },
    listDirectory(targetPath?: string) {
      return {
        path: targetPath || 'C:\\workspace',
        parentPath: 'C:\\',
        entries: [{ name: 'demo', path: 'C:\\workspace\\demo' }],
      };
    },
    createDirectory(parentPath: string, folderName: string) {
      return `${parentPath}\\${folderName}`;
    },
    resolveWorkspacePath(inputPath?: string) {
      return inputPath || 'C:\\workspace';
    },
  };
}

function createCodexStub() {
  return {
    async start() {},
    async stop() {},
    async listThreads() {
      return [];
    },
    async startThread() {
      return {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test thread',
        cwd: 'C:\\workspace',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
      };
    },
    async resumeThread(threadId: string) {
      return {
        id: threadId,
        name: 'Thread',
        cwd: 'C:\\workspace',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        turns: [],
      };
    },
    async startTurn() {
      return {
        id: 'turn-1',
      };
    },
    async listModels() {
      return [];
    },
    async readConfig() {
      return { config: {} };
    },
    respond() {},
    respondError() {},
    on() {},
  };
}

async function buildTestApp() {
  const app = await createApp({
    host: '127.0.0.1',
    port: 18637,
    wsToken: 'secret-token',
    nodeEnv: 'test',
    maxImageUploadBytes: 1024,
  });

  app.workspaceManager = createWorkspaceStub() as any;
  app.codexClient = createCodexStub() as any;
  return app;
}

test('GET /health returns runtime status', async () => {
  const app = await buildTestApp();
  app.runtimeState.tabsById.set('thread-1', {
    threadId: 'thread-1',
    name: 'Demo',
    cwd: 'C:\\workspace',
    status: 'idle',
    updatedAt: 1,
    createdAt: 1,
    windowStatus: 'detached',
  });
  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.status, 'ok');
  assert.equal(payload.tabs, 1);
  assert.equal(payload.websocketClients, 0);
  await app.close();
});

test('workspace shortcuts require auth token', async () => {
  const app = await buildTestApp();

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/workspace/shortcuts',
  });
  assert.equal(unauthorized.statusCode, 401);

  const authorized = await app.inject({
    method: 'GET',
    url: '/api/workspace/shortcuts',
    headers: {
      'x-codex-remote-token': 'secret-token',
    },
  });

  assert.equal(authorized.statusCode, 200);
  const payload = authorized.json();
  assert.equal(payload.projectRoot, 'C:\\workspace');
  await app.close();
});

test('workspace create-directory proxies to workspace manager', async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/workspace/create-directory',
    headers: {
      'x-codex-remote-token': 'secret-token',
      'content-type': 'application/json',
    },
    payload: {
      parentPath: 'C:\\workspace',
      folderName: 'next',
    },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.path, 'C:\\workspace\\next');
  await app.close();
});
