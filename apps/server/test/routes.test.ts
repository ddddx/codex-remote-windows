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
    setWsUrl() {},
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
    async listBackgroundTerminals() {
      return { data: [], nextCursor: null };
    },
    async terminateBackgroundTerminal() {
      return { terminated: true };
    },
    async deleteThread() {
      return {};
    },
    async readWorkspaceMessages() {
      return { featureEnabled: true, messages: [] };
    },
    async consumeRateLimitResetCredit() {
      return { outcome: 'nothingToReset' };
    },
    async readExternalAgentImportHistories() {
      return { data: [] };
    },
    respond() {},
    respondError() {},
    on() {},
  };
}

function createAppServerSupervisorStub() {
  return {
    get enabled() {
      return true;
    },
    getWsUrl() {
      return 'ws://127.0.0.1:34792';
    },
    async ensureStarted() {},
    async stop() {},
  };
}

async function buildTestApp() {
  const tempSqlitePath = `C:\\Users\\Administrator\\Desktop\\cc-workspace\\tmp-server-test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  const app = await createApp({
    host: '127.0.0.1',
    port: 18637,
    wsToken: 'secret-token',
    nodeEnv: 'test',
    maxImageUploadBytes: 1024,
    sqliteFile: tempSqlitePath,
  });

  app.workspaceManager = createWorkspaceStub() as any;
  app.appServerSupervisor = createAppServerSupervisorStub() as any;
  app.codexClient = createCodexStub() as any;
  return app;
}

async function createAuthCookie(app: Awaited<ReturnType<typeof buildTestApp>>): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/session',
    headers: {
      'x-codex-remote-token': 'secret-token',
      'content-type': 'application/json',
    },
    payload: {
      token: 'secret-token',
      deviceName: 'test-device',
    },
  });
  assert.equal(response.statusCode, 200);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie);
  return String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
}

test('POST /api/auth/session reuses current session and online list stays socket-based', async () => {
  const app = await buildTestApp();

  const first = await app.inject({
    method: 'POST',
    url: '/api/auth/session',
    headers: {
      'x-codex-remote-token': 'secret-token',
      'content-type': 'application/json',
    },
    payload: {
      token: 'secret-token',
      deviceName: 'test-device',
    },
  });
  assert.equal(first.statusCode, 200);
  const firstCookie = String(first.headers['set-cookie']).split(';')[0];
  const firstSessionId = first.json().session.sessionId;

  const second = await app.inject({
    method: 'POST',
    url: '/api/auth/session',
    headers: {
      'x-codex-remote-token': 'secret-token',
      'content-type': 'application/json',
      cookie: firstCookie,
    },
    payload: {
      token: 'secret-token',
      deviceName: 'test-device',
    },
  });

  assert.equal(second.statusCode, 200);
  assert.equal(second.json().session.sessionId, firstSessionId);

  const listed = await app.inject({
    method: 'GET',
    url: '/api/auth/sessions',
    headers: {
      cookie: firstCookie,
    },
  });

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().sessions.length, 0);
  await app.close();
});

test('POST /api/auth/session reuses existing session for the same deviceId and does not count offline sessions', async () => {
  const app = await buildTestApp();

  const first = await app.inject({
    method: 'POST',
    url: '/api/auth/session',
    headers: {
      'x-codex-remote-token': 'secret-token',
      'content-type': 'application/json',
    },
    payload: {
      token: 'secret-token',
      deviceName: 'browser-a',
      deviceId: 'device-1',
    },
  });
  assert.equal(first.statusCode, 200);
  const firstSessionId = first.json().session.sessionId;
  const firstCookie = String(first.headers['set-cookie']).split(';')[0];

  const second = await app.inject({
    method: 'POST',
    url: '/api/auth/session',
    headers: {
      'x-codex-remote-token': 'secret-token',
      'content-type': 'application/json',
    },
    payload: {
      token: 'secret-token',
      deviceName: 'browser-a',
      deviceId: 'device-1',
    },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().session.sessionId, firstSessionId);

  const listed = await app.inject({
    method: 'GET',
    url: '/api/auth/sessions',
    headers: {
      cookie: firstCookie,
    },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().sessions.length, 0);
  await app.close();
});

test('GET /api/auth/sessions only lists active websocket connections', async () => {
  const app = await buildTestApp();
  const cookie = await createAuthCookie(app);

  const stored = Array.from(app.runtimeState.authSessionsById.values());
  assert.equal(stored.length, 1);

  const offline = await app.inject({
    method: 'GET',
    url: '/api/auth/sessions',
    headers: {
      cookie,
    },
  });
  assert.equal(offline.statusCode, 200);
  assert.equal(offline.json().sessions.length, 0);

  app.runtimeState.clients.add({
    authSessionId: stored[0]?.sessionId,
    send() {},
    close() {},
  } as any);

  const online = await app.inject({
    method: 'GET',
    url: '/api/auth/sessions',
    headers: {
      cookie,
    },
  });
  assert.equal(online.statusCode, 200);
  assert.equal(online.json().sessions.length, 1);
  assert.equal(online.json().sessions[0].sessionId, stored[0]?.sessionId);
  await app.close();
});

test('DELETE /api/auth/sessions revokes all sessions and rotates main token without returning it', async () => {
  const app = await buildTestApp();
  const cookie = await createAuthCookie(app);

  const listBefore = await app.inject({
    method: 'GET',
    url: '/api/auth/sessions',
    headers: {
      cookie,
    },
  });
  const sessionId = Array.from(app.runtimeState.authSessionsById.keys())[0];

  const revoke = await app.inject({
    method: 'DELETE',
    url: '/api/auth/sessions',
    headers: {
      cookie,
    },
  });

  assert.equal(revoke.statusCode, 200);
  const revokePayload = revoke.json();
  assert.equal(revokePayload.ok, true);
  assert.deepEqual(revokePayload.removedSessionIds, [sessionId]);
  assert.equal('nextToken' in revokePayload, false);

  const oldTokenAttempt = await app.inject({
    method: 'POST',
    url: '/api/auth/session',
    headers: {
      'x-codex-remote-token': 'secret-token',
      'content-type': 'application/json',
    },
    payload: {
      token: 'secret-token',
      deviceName: 'new-device',
    },
  });
  assert.equal(oldTokenAttempt.statusCode, 401);
  await app.close();
});

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
  assert.equal(app.repositories.sessions.listSessions().length, 0);
  await app.close();
});

test('GET / serves rebuilt web shell', async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: 'GET',
    url: '/',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<div id="root"><\/div>/);
  assert.match(response.body, /assets\/index-/);
  await app.close();
});

test('workspace shortcuts require auth token', async () => {
  const app = await buildTestApp();
  const cookie = await createAuthCookie(app);

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/workspace/shortcuts',
  });
  assert.equal(unauthorized.statusCode, 401);

  const authorized = await app.inject({
    method: 'GET',
    url: '/api/workspace/shortcuts',
    headers: {
      cookie,
    },
  });

  assert.equal(authorized.statusCode, 200);
  const payload = authorized.json();
  assert.equal(payload.projectRoot, 'C:\\workspace');
  await app.close();
});

test('workspace create-directory proxies to workspace manager', async () => {
  const app = await buildTestApp();
  const cookie = await createAuthCookie(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/workspace/create-directory',
    headers: {
      cookie,
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

test('codex options fills effective defaults when config values are empty', async () => {
  const app = await buildTestApp();
  const cookie = await createAuthCookie(app);
  app.codexClient = {
    ...app.codexClient,
    async listModels() {
      return [
        {
          id: 'gpt-5.5',
          model: 'gpt-5.5',
          displayName: 'GPT-5.5',
          description: '',
          isDefault: true,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
        },
      ];
    },
    async readConfig() {
      return { config: {} };
    },
  } as any;

  const response = await app.inject({
    method: 'GET',
    url: '/api/codex/options',
    headers: {
      cookie,
    },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.defaults.model, 'gpt-5.5');
  assert.equal(payload.defaults.reasoningEffort, 'medium');
  assert.equal(payload.defaults.approvalPolicy, 'on-request');
  assert.equal(payload.defaults.sandboxMode, 'workspace-write');
  await app.close();
});

test('codex background terminals route clamps requested page size', async () => {
  const app = await buildTestApp();
  const cookie = await createAuthCookie(app);
  const calls: unknown[] = [];
  app.codexClient = {
    ...app.codexClient,
    async listBackgroundTerminals(threadId: string, options: unknown) {
      calls.push({ threadId, options });
      return { data: [], nextCursor: null };
    },
  } as any;

  const response = await app.inject({
    method: 'GET',
    url: '/api/codex/threads/thread-bg/background-terminals?limit=999&cursor=abc',
    headers: { cookie },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0], {
    threadId: 'thread-bg',
    options: { cursor: 'abc', limit: 100 },
  });
  await app.close();
});

test('rate limit reset consume requires an idempotency key', async () => {
  const app = await buildTestApp();
  const cookie = await createAuthCookie(app);

  const response = await app.inject({
    method: 'POST',
    url: '/api/codex/rate-limit-reset-credit/consume',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    payload: {},
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'idempotencyKey is required');
  await app.close();
});
