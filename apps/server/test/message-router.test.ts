import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServices } from '../src/application/services/index.js';
import { handleCodexNotification } from '../src/application/services/event-bridge.js';
import { createRuntimeState } from '../src/state/runtime-state.js';
import { routeClientMessage } from '../src/ws/message-router.js';
import { ensureCodexReady } from '../src/ws/bridge.js';

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
    updateThreadSettings: [] as unknown[],
    respond: [] as unknown[],
    openWindowForThread: [] as unknown[],
    closeWindowForThread: [] as unknown[],
    refreshTabWindowStatus: [] as unknown[],
    upsertSession: [] as unknown[],
    removeSession: [] as unknown[],
    upsertPendingRequest: [] as unknown[],
    removePendingRequest: [] as unknown[],
    listBackgroundTerminals: [] as unknown[],
    terminateBackgroundTerminal: [] as unknown[],
    deleteThread: [] as unknown[],
    upsertThreadPreference: [] as unknown[],
    appendTimelineEvent: [] as Array<{
      threadId: string;
      eventJson: string;
      createdAt: number;
      sequence: number;
    }>,
  };

  const app = {
    runtimeState,
    repositories: {
      sessions: {
        listSessions() {
          return [];
        },
        getSession() {
          return null;
        },
        upsertSession(record: unknown) {
          calls.upsertSession.push(record);
        },
        removeSession(threadId: string) {
          calls.removeSession.push(threadId);
        },
      },
      pendingRequests: {
        listPendingRequests() {
          return [];
        },
        getPendingRequest() {
          return null;
        },
        upsertPendingRequest(record: unknown) {
          calls.upsertPendingRequest.push(record);
        },
        removePendingRequest(requestId: string) {
          calls.removePendingRequest.push(requestId);
        },
      },
      threadPreferences: {
        getThreadPreference() {
          return null;
        },
        upsertThreadPreference(record: unknown) {
          calls.upsertThreadPreference.push(record);
        },
      },
      uploads: {
        listUploads() {
          return [];
        },
        upsertUpload() {},
      },
      windowBindings: {
        listWindowBindings() {
          return [];
        },
        upsertWindowBinding() {},
      },
      appState: {
        getAppState() {
          return null;
        },
        setAppState() {},
      },
      timelineEvents: {
        appendTimelineEvent(record: {
          threadId: string;
          eventJson: string;
          createdAt: number;
        }) {
          const saved = {
            ...record,
            sequence: calls.appendTimelineEvent.length + 1,
          };
          calls.appendTimelineEvent.push(saved);
          return saved;
        },
        listTimelineEvents(threadId: string) {
          return calls.appendTimelineEvent.filter(
            (event) => event.threadId === threadId,
          );
        },
      },
    },
    windowAttachments: {
      async openWindowForThread(threadId: string) {
        calls.openWindowForThread.push(threadId);
        return null;
      },
      async refreshTabWindowStatus(threadId: string, options: unknown) {
        calls.refreshTabWindowStatus.push({ threadId, options });
        return null;
      },
      async refreshAllTabsWindowStatus() {},
      async closeWindowForThread() {
        calls.closeWindowForThread.push(true);
        return null;
      },
    },
    workspaceManager: {
      resolveWorkspacePath(inputPath?: string) {
        return inputPath || 'C:\\workspace';
      },
    },
    codexClient: {
      setWsUrl() {},
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
      async resumeThread(threadId: string, options?: unknown) {
        calls.resumeThread.push({ threadId, options });
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
      async updateThreadSettings(threadId: string, options?: unknown) {
        calls.updateThreadSettings.push({ threadId, options });
        return {
          cwd: 'C:\\workspace',
          model: (options as any)?.model || 'updated-model',
          approvalPolicy: (options as any)?.approvalPolicy || 'never',
          reasoningEffort: (options as any)?.effort || 'medium',
          sandboxMode: (options as any)?.sandbox || 'workspace-write',
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
      async listBackgroundTerminals(threadId: string, options?: unknown) {
        calls.listBackgroundTerminals.push({ threadId, options });
        return {
          data: [
            {
              processId: 'proc-1',
              command: 'npm start',
              cwd: 'C:\\workspace',
              cpuPercent: 2,
              rssKb: 2048,
            },
          ],
          nextCursor: null,
        };
      },
      async listAllBackgroundTerminals(threadId: string) {
        calls.listBackgroundTerminals.push({ threadId, all: true });
        return [
          {
            processId: 'proc-1',
            command: 'npm start',
            cwd: 'C:\\workspace',
            cpuPercent: 2,
            rssKb: 2048,
          },
        ];
      },
      async terminateBackgroundTerminal(threadId: string, processId: string) {
        calls.terminateBackgroundTerminal.push({ threadId, processId });
        return { terminated: true };
      },
      async deleteThread(threadId: string) {
        calls.deleteThread.push(threadId);
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
    config: {
      maxImageUploadBytes: 1024,
    },
    appServerSupervisor: {
      async ensureStarted() {},
      getWsUrl() {
        return null;
      },
      async stop() {},
    },
    windowManager: {
      setAppServerWs() {},
    },
  };

  runtimeState.repositories = app.repositories as any;
  (app as any).services = createAppServices(app as any);

  return {
    app: app as any,
    calls,
    listeners,
  };
}

test('thread_sync returns tab update and thread snapshot', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.turnPlansByThread.set(
    '00000000-0000-0000-0000-000000000999',
    new Map([
      [
        'turn-1',
        {
          turnId: 'turn-1',
          explanation: 'Explain',
          plan: [{ step: 'Do it', status: 'in_progress' }],
          updatedAt: 1,
        },
      ],
    ]),
  );
  app.runtimeState.turnDiffsByThread.set(
    '00000000-0000-0000-0000-000000000999',
    new Map([
      [
        'turn-1',
        {
          turnId: 'turn-1',
          diff: '*** Begin Patch\n*** End Patch',
          updatedAt: 1,
        },
      ],
    ]),
  );
  app.runtimeState.supplementalItemsByThread.set(
    '00000000-0000-0000-0000-000000000999',
    new Map([
      [
        'hook-1',
        {
          id: 'hook-1',
          type: 'hookEvent',
          phase: 'completed',
          status: 'completed',
          createdAt: 1,
        },
      ],
    ]),
  );
  app.runtimeState.timelineEventsByThread.set(
    '00000000-0000-0000-0000-000000000999',
    [
      {
        type: 'agent_delta',
        threadId: '00000000-0000-0000-0000-000000000999',
        turnId: 'turn-live',
        itemId: 'assistant-live',
        delta: 'partial',
        startedAt: 1,
      },
    ],
  );
  app.runtimeState.globalNotices.push({
    id: 'notice-1',
    type: '_warning',
    text: 'Be careful',
    createdAt: 1,
  });

  await routeClientMessage(app, socket as any, {
    type: 'thread_sync',
    threadId: '00000000-0000-0000-0000-000000000999',
  });

  assert.equal(calls.resumeThread.length, 1);
  assert.equal(calls.refreshTabWindowStatus.length, 1);
  assert.equal(
    (calls.refreshTabWindowStatus[0] as any).options.allowLaunch,
    true,
  );
  assert.equal(socket.sent.length, 2);
  assert.equal((socket.sent[0] as any).type, 'tab_updated');
  assert.equal((socket.sent[1] as any).type, 'thread_sync');
  assert.equal((socket.sent[1] as any).tokenUsage.totalTokens, 12);
  assert.equal((socket.sent[1] as any).turnPlans.length, 1);
  assert.equal((socket.sent[1] as any).turnDiffs.length, 1);
  assert.equal((socket.sent[1] as any).supplementalItems.length, 1);
  assert.equal((socket.sent[1] as any).timelineEvents.length, 1);
  assert.equal((socket.sent[1] as any).globalSupplementalItems.length, 1);
});

test('thread_sync preserves nested usage payloads for header display', async () => {
  const { app } = createAppStub();
  const socket = createSocket();

  app.codexClient.resumeThread = async (threadId: string) => ({
    id: threadId,
    name: 'Resumed thread',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 2,
    turns: [],
    usage: {
      prompt_tokens: 21,
      completion_tokens: 12,
    },
  });

  await routeClientMessage(app, socket as any, {
    type: 'thread_sync',
    threadId: '00000000-0000-0000-0000-000000000777',
  });

  assert.deepEqual((socket.sent[1] as any).tokenUsage, {
    prompt_tokens: 21,
    completion_tokens: 12,
  });
});

test('thread_sync preserves existing permission preset when codex resume omits it', async () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.tabsById.set('00000000-0000-0000-0000-000000000555', {
    threadId: '00000000-0000-0000-0000-000000000555',
    name: 'Existing',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  });

  app.codexClient.resumeThread = async (threadId: string) => ({
    id: threadId,
    name: 'Resumed thread',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 2,
    turns: [],
  });

  await routeClientMessage(app, socket as any, {
    type: 'thread_sync',
    threadId: '00000000-0000-0000-0000-000000000555',
  });

  assert.equal((socket.sent[0] as any).tab.approvalPolicy, 'never');
  assert.equal((socket.sent[0] as any).tab.sandboxMode, 'danger-full-access');
  assert.equal(
    app.runtimeState.tabsById.get('00000000-0000-0000-0000-000000000555')
      ?.approvalPolicy,
    'never',
  );
  assert.equal(
    app.runtimeState.tabsById.get('00000000-0000-0000-0000-000000000555')
      ?.sandboxMode,
    'danger-full-access',
  );
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
  assert.equal(calls.openWindowForThread.length, 1);
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
  assert.equal(
    app.runtimeState.tabsById.get('00000000-0000-0000-0000-000000000123')
      ?.status,
    'running',
  );
});

test('turn_send maps permission overrides to codex approval and sandbox settings', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.tabsById.set('00000000-0000-0000-0000-000000000123', {
    threadId: '00000000-0000-0000-0000-000000000123',
    name: 'Existing',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
  });

  await routeClientMessage(app, socket as any, {
    type: 'turn_send',
    threadId: '00000000-0000-0000-0000-000000000123',
    text: 'hello',
    attachments: [],
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  });

  assert.deepEqual((calls.startTurn[0] as any)?.options?.sandboxPolicy, {
    type: 'dangerFullAccess',
  });
  assert.equal((calls.startTurn[0] as any)?.options?.approvalPolicy, 'never');
});

test('thread_options_update uses thread settings update with host-visible option overrides and persists preferences', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);
  app.runtimeState.tabsById.set('00000000-0000-0000-0000-000000000123', {
    threadId: '00000000-0000-0000-0000-000000000123',
    name: 'Existing',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
    model: 'old-model',
    reasoningEffort: 'low',
  });

  await routeClientMessage(app, socket as any, {
    type: 'thread_options_update',
    threadId: '00000000-0000-0000-0000-000000000123',
    model: 'gpt-5.5',
    effort: 'high',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  });

  assert.deepEqual((calls.updateThreadSettings[0] as any)?.options, {
    cwd: 'C:\\workspace',
    model: 'gpt-5.5',
    effort: 'high',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  });
  assert.equal(
    app.runtimeState.tabsById.get('00000000-0000-0000-0000-000000000123')
      ?.model,
    'gpt-5.5',
  );
  assert.equal(
    app.runtimeState.tabsById.get('00000000-0000-0000-0000-000000000123')
      ?.reasoningEffort,
    'high',
  );
  assert.equal((socket.sent[0] as any).type, 'tab_updated');
  assert.equal((calls.upsertThreadPreference.at(-1) as any)?.model, 'gpt-5.5');
  assert.equal(
    (calls.upsertThreadPreference.at(-1) as any)?.reasoningEffort,
    'high',
  );
});

test('thread settings updated notifications refresh runtime tab state', () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);
  app.runtimeState.tabsById.set('thread-settings-1', {
    threadId: 'thread-settings-1',
    name: 'Existing',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
    model: 'gpt-5.4',
    reasoningEffort: 'low',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
  });

  handleCodexNotification(app, {
    method: 'thread/settings/updated',
    params: {
      threadId: 'thread-settings-1',
      threadSettings: {
        cwd: 'C:\\workspace\\demo',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
        activePermissionProfile: null,
        model: 'gpt-5.5',
        modelProvider: 'openai',
        serviceTier: null,
        effort: 'high',
        summary: null,
        collaborationMode: 'native',
        personality: null,
      },
    },
  } as any);

  const tab = app.runtimeState.tabsById.get('thread-settings-1');
  assert.equal(tab?.cwd, 'C:\\workspace\\demo');
  assert.equal(tab?.model, 'gpt-5.5');
  assert.equal(tab?.reasoningEffort, 'high');
  assert.equal(tab?.approvalPolicy, 'never');
  assert.equal(tab?.sandboxMode, 'danger-full-access');
  assert.equal((socket.sent[0] as any)?.type, 'tab_updated');
  assert.equal((socket.sent[0] as any)?.tab?.model, 'gpt-5.5');
});

test('tab_close closes host window but keeps session', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.tabsById.set('00000000-0000-0000-0000-000000000123', {
    threadId: '00000000-0000-0000-0000-000000000123',
    name: 'Existing',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
  });
  app.windowAttachments.closeWindowForThread = async (threadId: string) => {
    calls.closeWindowForThread.push(threadId);
    const tab = app.runtimeState.tabsById.get(threadId);
    if (!tab) {
      return null;
    }
    tab.windowStatus = 'detached';
    return tab;
  };

  await routeClientMessage(app, socket as any, {
    type: 'tab_close',
    threadId: '00000000-0000-0000-0000-000000000123',
  });

  assert.equal(calls.closeWindowForThread.length, 1);
  assert.equal((socket.sent[0] as any).type, 'tab_updated');
  assert.equal((socket.sent[0] as any).tab.windowStatus, 'detached');
  assert.equal(
    app.runtimeState.tabsById.has('00000000-0000-0000-0000-000000000123'),
    true,
  );
});

test('turn_send failure returns correlated error payload', async () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.codexClient.startTurn = async () => {
    throw new Error('turn failed');
  };

  await routeClientMessage(app, socket as any, {
    type: 'turn_send',
    threadId: '00000000-0000-0000-0000-000000000123',
    text: 'hello',
    attachments: [],
    clientMessageId: 'web-123',
  });

  assert.equal((socket.sent[0] as any).type, 'error');
  assert.equal((socket.sent[0] as any).op, 'turn_send');
  assert.equal((socket.sent[0] as any).clientMessageId, 'web-123');
});

test('command_send supports background terminal list and terminate', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  await routeClientMessage(app, socket as any, {
    type: 'command_send',
    threadId: 'thread-bg',
    text: '/bg',
  });
  await routeClientMessage(app, socket as any, {
    type: 'command_send',
    threadId: 'thread-bg',
    text: '/bg stop proc-1',
  });

  assert.deepEqual(calls.listBackgroundTerminals[0], {
    threadId: 'thread-bg',
    all: true,
  });
  assert.deepEqual(calls.terminateBackgroundTerminal[0], {
    threadId: 'thread-bg',
    processId: 'proc-1',
  });
  assert.equal((socket.sent[0] as any)?.type, 'thread_event');
  assert.match((socket.sent[0] as any)?.message, /proc-1/);
  assert.equal((socket.sent[1] as any)?.type, 'thread_event');
  assert.match((socket.sent[1] as any)?.message, /已终止/);
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
  assert.equal(
    app.runtimeState.serverRequestsById.get('req-1')?.status,
    'submitting',
  );
});

test('server_request_respond preserves structured approval decisions under decision envelope', async () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.serverRequestsById.set('req-2', {
    requestId: 'req-2',
    rawRequestId: 'raw-2',
    method: 'item/commandExecution/requestApproval',
    kind: 'command_approval',
    status: 'pending',
    createdAt: Date.now(),
    threadId: '00000000-0000-0000-0000-000000000123',
  });

  await routeClientMessage(app, socket as any, {
    type: 'server_request_respond',
    requestId: 'req-2',
    response: {
      decision: {
        acceptWithExecpolicyAmendment: {
          add: ['RemoteSigned'],
        },
      },
    },
  });

  assert.equal(calls.respond.length, 1);
  assert.deepEqual(calls.respond[0], {
    id: 'raw-2',
    result: {
      decision: {
        acceptWithExecpolicyAmendment: {
          add: ['RemoteSigned'],
        },
      },
    },
  });
});

test('bridge answers currentTime/read server requests without user approval', async () => {
  const { app, calls, listeners } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  await ensureCodexReady(app);
  const serverRequestListener = listeners.get('server_request')?.[0];
  assert.ok(serverRequestListener);

  const before = Math.floor(Date.now() / 1000);
  serverRequestListener?.({
    method: 'currentTime/read',
    id: 'time-1',
    params: { threadId: 'thread-time' },
  });
  const after = Math.floor(Date.now() / 1000);

  assert.equal(calls.respond.length, 1);
  assert.equal((calls.respond[0] as any).id, 'time-1');
  const currentTimeAt = (calls.respond[0] as any).result.currentTimeAt;
  assert.equal(typeof currentTimeAt, 'number');
  assert.ok(currentTimeAt >= before && currentTimeAt <= after);
  assert.equal(socket.sent.length, 0);
  assert.equal(app.runtimeState.serverRequestsById.size, 0);
});

test('thread/deleted notifications remove local tab and pending thread requests', () => {
  const { app, calls } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);
  app.runtimeState.tabsById.set('thread-delete', {
    threadId: 'thread-delete',
    name: 'Delete me',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
  });
  app.runtimeState.turnPlansByThread.set('thread-delete', new Map());
  app.runtimeState.serverRequestsById.set('request-delete', {
    requestId: 'request-delete',
    rawRequestId: 'raw-delete',
    method: 'item/tool/requestUserInput',
    kind: 'user_input',
    status: 'pending',
    createdAt: Date.now(),
    threadId: 'thread-delete',
    turnId: null,
    itemId: null,
  });

  handleCodexNotification(app, {
    method: 'thread/deleted',
    params: { threadId: 'thread-delete' },
  });

  assert.equal(app.runtimeState.tabsById.has('thread-delete'), false);
  assert.equal(app.runtimeState.turnPlansByThread.has('thread-delete'), false);
  assert.equal(app.runtimeState.serverRequestsById.has('request-delete'), false);
  assert.deepEqual(calls.removeSession, ['thread-delete']);
  assert.deepEqual(calls.removePendingRequest, ['request-delete']);
  assert.equal((socket.sent[0] as any)?.type, 'server_request_resolved');
  assert.equal((socket.sent[0] as any)?.requestId, 'request-delete');
  assert.equal((socket.sent[1] as any)?.type, 'tab_removed');
  assert.equal((socket.sent[1] as any)?.threadId, 'thread-delete');
});

test('model/safetyBuffering/updated is reflected as running timeline state', () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);
  app.runtimeState.tabsById.set('thread-buffer', {
    threadId: 'thread-buffer',
    name: 'Buffer',
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
  });

  handleCodexNotification(app, {
    method: 'model/safetyBuffering/updated',
    params: {
      threadId: 'thread-buffer',
      turnId: 'turn-buffer',
      model: 'gpt-5.4',
      useCases: ['coding'],
      reasons: ['safety'],
      showBufferingUi: true,
      fasterModel: 'gpt-5.4-mini',
    },
  });

  assert.equal(app.runtimeState.tabsById.get('thread-buffer')?.status, 'running');
  assert.equal((socket.sent[0] as any)?.type, 'tab_updated');
  assert.equal((socket.sent[1] as any)?.type, 'thread_event');
  assert.equal((socket.sent[1] as any)?.method, 'model/safetyBuffering/updated');
  assert.equal((socket.sent[1] as any)?.status, 'running');
  const cachedEvents =
    app.runtimeState.timelineEventsByThread.get('thread-buffer') || [];
  assert.equal(cachedEvents.length, 1);
  assert.equal(cachedEvents[0]?.type, 'thread_event');
});

test('bridge forwards plan, progress, hook and guardian notifications', async () => {
  const { app, listeners } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  await ensureCodexReady(app);
  const notificationListener = listeners.get('notification')?.[0];
  assert.ok(notificationListener);

  notificationListener?.({
    method: 'item/plan/delta',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'plan-1',
      delta: 'Step 1',
    },
  });
  notificationListener?.({
    method: 'item/mcpToolCall/progress',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'mcp-1',
      message: 'Searching',
    },
  });
  notificationListener?.({
    method: 'hook/started',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      run: { id: 'hook-1', eventName: 'pre-command' },
    },
  });
  notificationListener?.({
    method: 'item/autoApprovalReview/completed',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
    },
  });

  const messages = socket.sent as Array<any>;
  assert.equal(messages[0]?.type, 'plan_delta');
  assert.equal(messages[1]?.type, 'mcp_tool_progress');
  assert.equal(messages[2]?.type, 'hook_started');
  assert.equal(messages[3]?.type, 'guardian_review_completed');
  const cachedEvents =
    app.runtimeState.timelineEventsByThread.get('thread-1') || [];
  assert.equal(cachedEvents.length, 4);
});

test('bridge tolerates websocket send failures without throwing', async () => {
  const { app, listeners } = createAppStub();
  const socket = {
    send() {
      throw new Error('socket closed');
    },
    close() {},
  };
  app.runtimeState.clients.add(socket as any);

  await ensureCodexReady(app);
  const notificationListener = listeners.get('notification')?.[0];
  assert.ok(notificationListener);

  assert.doesNotThrow(() => {
    notificationListener?.({
      method: 'item/mcpToolCall/progress',
      params: {
        threadId: 'thread-send-fail',
        turnId: 'turn-send-fail',
        itemId: 'item-send-fail',
        message: 'Searching',
      },
    });
  });

  assert.equal(app.runtimeState.clients.has(socket as any), false);
  assert.equal(app.runtimeState.websocketClientCount, 0);
});

test('bridge converts notification handler exceptions into backend errors', async () => {
  const { app, listeners } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);
  app.runtimeState.tabsById.set('thread-bad-turn', {
    threadId: 'thread-bad-turn',
    name: 'Bad Turn',
    cwd: 'C:\\workspace',
    status: 'idle',
    updatedAt: 1,
    createdAt: 1,
    windowStatus: 'detached',
  });

  await ensureCodexReady(app);
  const notificationListener = listeners.get('notification')?.[0];
  assert.ok(notificationListener);

  assert.doesNotThrow(() => {
    notificationListener?.({
      method: 'turn/started',
      params: {
        threadId: 'thread-bad-turn',
      },
    });
  });

  const messages = socket.sent as Array<any>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.type, 'tab_updated');
  assert.equal(messages[1]?.type, 'backend_error');
  assert.match(messages[1]?.message || '', /turn\/started/);
});

test('bridge batches high-frequency assistant deltas before broadcasting', async () => {
  const { app, listeners } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  await ensureCodexReady(app);
  const notificationListener = listeners.get('notification')?.[0];
  assert.ok(notificationListener);

  notificationListener?.({
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread-batch',
      turnId: 'turn-batch',
      itemId: 'assistant-batch',
      delta: 'a',
      startedAt: 1,
    },
  });
  notificationListener?.({
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread-batch',
      turnId: 'turn-batch',
      itemId: 'assistant-batch',
      delta: 'b',
      startedAt: 2,
    },
  });
  notificationListener?.({
    method: 'item/completed',
    params: {
      threadId: 'thread-batch',
      turnId: 'turn-batch',
      item: {
        id: 'assistant-batch',
        type: 'agentMessage',
        text: 'ab',
      },
    },
  });

  const messages = socket.sent as Array<any>;
  assert.equal(messages[0]?.type, 'agent_delta');
  assert.equal(messages[0]?.delta, 'ab');
  assert.equal(messages[1]?.type, 'item_completed');

  const cachedEvents =
    app.runtimeState.timelineEventsByThread.get('thread-batch') || [];
  assert.equal(cachedEvents.length, 2);
  assert.equal(cachedEvents[0]?.delta, 'ab');
});

test('thread_sync replays timeline events persisted while clients are disconnected', async () => {
  const { app, listeners, calls } = createAppStub();
  app.runtimeState.tabsById.set('thread-offline', {
    threadId: 'thread-offline',
    name: 'Offline',
    cwd: 'C:\\workspace',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
  });

  await ensureCodexReady(app);
  const notificationListener = listeners.get('notification')?.[0];
  assert.ok(notificationListener);

  notificationListener?.({
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread-offline',
      turnId: 'turn-offline',
      itemId: 'assistant-offline',
      delta: 'hel',
    },
  });
  notificationListener?.({
    method: 'item/completed',
    params: {
      threadId: 'thread-offline',
      turnId: 'turn-offline',
      completedAtMs: 1234,
      item: {
        id: 'assistant-offline',
        type: 'agentMessage',
        text: 'hello',
      },
    },
  });

  assert.equal(calls.appendTimelineEvent.length, 2);
  const socket = createSocket();
  await routeClientMessage(app, socket as any, {
    type: 'thread_sync',
    threadId: 'thread-offline',
  });

  const sync = (socket.sent as Array<any>).find(
    (message) => message.type === 'thread_sync',
  );
  assert.ok(sync);
  assert.equal(sync.timelineEvents.length, 2);
  assert.equal(sync.timelineEvents[0].type, 'agent_delta');
  assert.equal(sync.timelineEvents[0].sequence, 1);
  assert.equal(sync.timelineEvents[1].type, 'item_completed');
  assert.equal(sync.timelineEvents[1].sequence, 2);
});

test('file change patch updates refresh pending request snapshot', async () => {
  const { app, listeners } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);
  app.runtimeState.serverRequestsById.set('req-2', {
    requestId: 'req-2',
    rawRequestId: 'raw-2',
    method: 'item/fileChange/requestApproval',
    kind: 'file_change_approval',
    status: 'pending',
    createdAt: Date.now(),
    threadId: 'thread-2',
    patch: '',
    changes: [],
  } as any);

  await ensureCodexReady(app);
  const notificationListener = listeners.get('notification')?.[0];
  assert.ok(notificationListener);

  notificationListener?.({
    method: 'item/fileChange/patchUpdated',
    params: {
      threadId: 'thread-2',
      turnId: 'turn-2',
      itemId: 'item-2',
      requestId: 'req-2',
      patch: '*** Begin Patch\n*** End Patch',
      changes: [{ path: 'apps/web/src/app/App.tsx', kind: 'update' }],
    },
  });

  const updatedRequest = app.runtimeState.serverRequestsById.get('req-2');
  assert.equal(updatedRequest?.patch, '*** Begin Patch\n*** End Patch');
  assert.deepEqual(updatedRequest?.changes, [
    { path: 'apps/web/src/app/App.tsx', kind: 'update' },
  ]);
  const messages = socket.sent as Array<any>;
  assert.equal(messages[0]?.type, 'server_request_updated');
  assert.equal(messages[0]?.request?.method, 'item/fileChange/requestApproval');
  assert.equal(messages[0]?.request?.threadId, 'thread-2');
  assert.equal(messages[0]?.request?.itemId, undefined);
  assert.equal(messages[1]?.type, 'item_delta');
});

test('turn diff updates are cached and broadcast for timeline diff rendering', () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  handleCodexNotification(app, {
    method: 'turn/diff/updated',
    params: {
      threadId: 'thread-diff-1',
      turnId: 'turn-diff-1',
      diff: '*** Begin Patch\n*** Update File: src/a.ts\n+line\n*** End Patch',
    },
  });

  const cached = app.runtimeState.turnDiffsByThread
    .get('thread-diff-1')
    ?.get('turn-diff-1');
  assert.equal(
    cached?.diff,
    '*** Begin Patch\n*** Update File: src/a.ts\n+line\n*** End Patch',
  );
  const messages = socket.sent as Array<any>;
  assert.equal(messages[0]?.type, 'turn_diff_updated');
  assert.equal(messages[0]?.turnId, 'turn-diff-1');
});

test('turn plan updates are cached and broadcast for plan rendering', () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  handleCodexNotification(app, {
    method: 'turn/plan/updated',
    params: {
      threadId: 'thread-plan-1',
      turnId: 'turn-plan-1',
      explanation: 'Work in stages',
      plan: [
        { step: 'Inspect', status: 'completed' },
        { step: 'Patch', status: 'in_progress' },
      ],
    },
  });

  const cached = app.runtimeState.turnPlansByThread
    .get('thread-plan-1')
    ?.get('turn-plan-1');
  assert.equal(cached?.explanation, 'Work in stages');
  assert.deepEqual(cached?.plan, [
    { step: 'Inspect', status: 'completed' },
    { step: 'Patch', status: 'in_progress' },
  ]);
  const messages = socket.sent as Array<any>;
  assert.equal(messages[0]?.type, 'turn_plan_updated');
  assert.equal(messages[0]?.turnId, 'turn-plan-1');
  assert.equal(messages[0]?.explanation, 'Work in stages');
});

test('model reroute notifications update runtime tab model and broadcast effective model', () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);
  app.runtimeState.tabsById.set('00000000-0000-0000-0000-000000000123', {
    threadId: '00000000-0000-0000-0000-000000000123',
    name: 'Existing',
    cwd: 'C:\\workspace',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'attached',
    model: 'gpt-5.4',
  });

  handleCodexNotification(app, {
    method: 'model/rerouted',
    params: {
      threadId: '00000000-0000-0000-0000-000000000123',
      turnId: 'turn-1',
      fromModel: 'gpt-5.4',
      toModel: 'gpt-5.5',
      reason: { type: 'server' },
    },
  });

  assert.equal(
    app.runtimeState.tabsById.get('00000000-0000-0000-0000-000000000123')
      ?.model,
    'gpt-5.5',
  );
  assert.deepEqual(socket.sent.at(-1), {
    type: 'model_rerouted',
    threadId: '00000000-0000-0000-0000-000000000123',
    turnId: 'turn-1',
    fromModel: 'gpt-5.4',
    toModel: 'gpt-5.5',
    reason: { type: 'server' },
  });
});

test('bridge preserves thread-scoped errors and generic codex notifications in timeline cache', () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  handleCodexNotification(app, {
    method: 'error',
    params: {
      threadId: 'thread-error',
      turnId: 'turn-error',
      error: { message: 'model disconnected' },
      willRetry: false,
    },
  });
  handleCodexNotification(app, {
    method: 'process/outputDelta',
    params: {
      threadId: 'thread-error',
      turnId: 'turn-error',
      processHandle: 'proc-1',
      stream: 'stdout',
      deltaBase64: 'aGVsbG8=',
    },
  });

  const messages = socket.sent as Array<any>;
  assert.equal(messages[0]?.type, 'error_notice');
  assert.equal(messages[0]?.message, 'model disconnected');
  assert.equal(messages[1]?.type, 'thread_event');
  assert.equal(messages[1]?.method, 'process/outputDelta');
  assert.equal(messages[1]?.itemId, 'proc-1');
  const cachedEvents =
    app.runtimeState.timelineEventsByThread.get('thread-error') || [];
  assert.equal(cachedEvents.length, 2);
  assert.equal(cachedEvents[0]?.type, 'error_notice');
  assert.equal(cachedEvents[1]?.type, 'thread_event');
});

test('bridge caches fallback generic notifications for thread-scoped official events', () => {
  const { app } = createAppStub();
  const socket = createSocket();
  app.runtimeState.clients.add(socket as any);

  handleCodexNotification(app, {
    method: 'guardianWarning',
    params: {
      threadId: 'thread-generic',
      message: 'review needed',
    },
  });

  const messages = socket.sent as Array<any>;
  assert.equal(messages[0]?.type, 'notification');
  assert.equal(messages[0]?.method, 'guardianWarning');
  const cachedEvents =
    app.runtimeState.timelineEventsByThread.get('thread-generic') || [];
  assert.equal(cachedEvents.length, 1);
  assert.equal(cachedEvents[0]?.type, 'thread_event');
  assert.equal(cachedEvents[0]?.method, 'guardianWarning');
});
