import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@codex-remote/protocol';

type RuntimeTab = {
  threadId: string;
  name: string;
  cwd: string;
  status: string;
  updatedAt: number;
  createdAt: number;
  windowStatus: string;
  approvalPolicy?: string;
  sandboxMode?: string;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function sendToClient(client: { send: (payload: string) => void }, message: ServerMessage): void {
  client.send(JSON.stringify(message));
}

export function broadcastMessage(app: FastifyInstance, message: ServerMessage): void {
  for (const client of app.runtimeState.clients) {
    sendToClient(client, message);
  }
}

export function normalizeTab(source: Record<string, unknown>): RuntimeTab {
  return {
    threadId: String(source.threadId || source.id || ''),
    name: typeof source.name === 'string' && source.name.trim() ? source.name : '未命名会话',
    cwd: typeof source.cwd === 'string' ? source.cwd : '',
    status: typeof source.status === 'string' && source.status.trim() ? source.status : 'idle',
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : nowUnix(),
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : nowUnix(),
    windowStatus: typeof source.windowStatus === 'string' && source.windowStatus.trim() ? source.windowStatus : 'detached',
    approvalPolicy: typeof source.approvalPolicy === 'string' ? source.approvalPolicy : '',
    sandboxMode: typeof source.sandboxMode === 'string' ? source.sandboxMode : '',
  };
}

export function upsertRuntimeTab(app: FastifyInstance, source: Record<string, unknown>): RuntimeTab {
  const normalized = normalizeTab(source);
  const existing = app.runtimeState.tabsById.get(normalized.threadId);
  const merged = existing ? { ...existing, ...normalized } : normalized;
  app.runtimeState.tabsById.set(merged.threadId, merged);
  return merged;
}

function listRuntimeTabs(app: FastifyInstance): RuntimeTab[] {
  return Array.from(app.runtimeState.tabsById.values()).sort((left, right) => {
    const updatedDiff = right.updatedAt - left.updatedAt;
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return left.threadId.localeCompare(right.threadId);
  });
}

function createServerRequestRecord(msg: { id: string | number; method: string; params?: Record<string, unknown> }) {
  const params = msg.params || {};
  const requestId = String(msg.id);

  if (msg.method === 'item/commandExecution/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'command_approval',
      status: 'pending' as const,
      createdAt: Date.now(),
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      reason: typeof params.reason === 'string' ? params.reason : '',
      command: typeof params.command === 'string' ? params.command : '',
      cwd: typeof params.cwd === 'string' ? params.cwd : '',
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/fileChange/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'file_change_approval',
      status: 'pending' as const,
      createdAt: Date.now(),
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      reason: typeof params.reason === 'string' ? params.reason : '',
      patch: typeof params.patch === 'string' ? params.patch : '',
      changes: Array.isArray(params.changes) ? params.changes : [],
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/permissions/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'permissions_approval',
      status: 'pending' as const,
      createdAt: Date.now(),
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      reason: typeof params.reason === 'string' ? params.reason : '',
      cwd: typeof params.cwd === 'string' ? params.cwd : '',
      permissions: params.permissions ?? null,
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/tool/requestUserInput') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'user_input',
      status: 'pending' as const,
      createdAt: Date.now(),
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      questions: Array.isArray(params.questions) ? params.questions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/tool/call') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'dynamic_tool_call',
      status: 'pending' as const,
      createdAt: Date.now(),
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.callId === 'string' ? params.callId : null,
      tool: typeof params.tool === 'string' ? params.tool : '',
      raw: params,
    };
  }

  if (msg.method === 'mcpServer/elicitation/request') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'mcp_server_elicitation',
      status: 'pending' as const,
      createdAt: Date.now(),
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: null,
      serverName: typeof params.serverName === 'string' ? params.serverName : '',
      message: typeof params.message === 'string' ? params.message : '',
      raw: params,
    };
  }

  return {
    requestId,
    rawRequestId: msg.id,
    method: msg.method,
    kind: 'unknown',
    status: 'pending' as const,
    createdAt: Date.now(),
    threadId: typeof params.threadId === 'string' ? params.threadId : null,
    turnId: typeof params.turnId === 'string' ? params.turnId : null,
    itemId: typeof params.itemId === 'string' ? params.itemId : null,
    raw: params,
  };
}

function listServerRequests(app: FastifyInstance): unknown[] {
  return Array.from(app.runtimeState.serverRequestsById.values()).sort((left, right) => left.createdAt - right.createdAt);
}

function handleNotification(app: FastifyInstance, msg: { method?: string; params?: Record<string, unknown> }): void {
  const method = msg.method || '';
  const params = msg.params || {};

  if (method === 'thread/started' && params.thread && typeof params.thread === 'object') {
    const tab = upsertRuntimeTab(app, params.thread as Record<string, unknown>);
    broadcastMessage(app, { type: 'tab_updated', tab });
    return;
  }

  if (method === 'thread/status/changed' && typeof params.threadId === 'string') {
    const current = app.runtimeState.tabsById.get(params.threadId);
    if (!current) {
      return;
    }
    const tab = upsertRuntimeTab(app, {
      ...current,
      status: typeof params.status === 'string' ? params.status : current.status,
      updatedAt: nowUnix(),
    });
    broadcastMessage(app, { type: 'tab_updated', tab });
    return;
  }

  if (method === 'thread/name/updated' && typeof params.threadId === 'string') {
    const current = app.runtimeState.tabsById.get(params.threadId);
    if (!current) {
      return;
    }
    const tab = upsertRuntimeTab(app, {
      ...current,
      name: typeof params.threadName === 'string' && params.threadName.trim() ? params.threadName : current.name,
      updatedAt: nowUnix(),
    });
    broadcastMessage(app, { type: 'tab_updated', tab });
    return;
  }

  if (method === 'thread/tokenUsage/updated' && typeof params.threadId === 'string') {
    broadcastMessage(app, {
      type: 'token_usage',
      threadId: params.threadId,
      usage: params.tokenUsage ?? null,
    });
    return;
  }

  if (method === 'turn/started' && typeof params.threadId === 'string') {
    const current = app.runtimeState.tabsById.get(params.threadId);
    if (current) {
      const tab = upsertRuntimeTab(app, {
        ...current,
        status: 'running',
        updatedAt: nowUnix(),
      });
      broadcastMessage(app, { type: 'tab_updated', tab });
    }
    const turn = params.turn as Record<string, unknown> | undefined;
    broadcastMessage(app, {
      type: 'turn_started',
      threadId: params.threadId,
      turnId: typeof turn?.id === 'string' ? turn.id : undefined,
      startedAt: typeof turn?.startedAt === 'number' ? turn.startedAt : Date.now(),
    });
    return;
  }

  if (method === 'turn/completed' && typeof params.threadId === 'string') {
    const current = app.runtimeState.tabsById.get(params.threadId);
    const turn = params.turn as Record<string, unknown> | undefined;
    if (current) {
      const rawStatus = typeof turn?.status === 'string' ? turn.status : 'idle';
      const nextStatus = ['completed', 'succeeded', 'cancelled', 'aborted'].includes(rawStatus) ? 'idle' : rawStatus;
      const tab = upsertRuntimeTab(app, {
        ...current,
        status: nextStatus,
        updatedAt: nowUnix(),
      });
      broadcastMessage(app, { type: 'tab_updated', tab });
    }
    broadcastMessage(app, {
      type: 'turn_completed',
      threadId: params.threadId,
      turnId: typeof turn?.id === 'string' ? turn.id : undefined,
    });
    return;
  }

  if (method === 'item/agentMessage/delta' && typeof params.threadId === 'string') {
    broadcastMessage(app, {
      type: 'agent_delta',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      itemId: typeof params.itemId === 'string' ? params.itemId : undefined,
      delta: typeof params.delta === 'string' ? params.delta : '',
      startedAt: typeof params.startedAt === 'number' ? params.startedAt : Date.now(),
    });
    return;
  }

  if (method === 'item/started' && typeof params.threadId === 'string') {
    broadcastMessage(app, {
      type: 'item_started',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      item: params.item,
      startedAt: Date.now(),
    });
    return;
  }

  if (method === 'item/completed' && typeof params.threadId === 'string') {
    broadcastMessage(app, {
      type: 'item_completed',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      item: params.item,
    });
    return;
  }

  if (method === 'serverRequest/resolved') {
    const requestId = typeof params.requestId === 'string' || typeof params.requestId === 'number'
      ? String(params.requestId)
      : '';
    if (!requestId) {
      return;
    }
    const existing = app.runtimeState.serverRequestsById.get(requestId);
    app.runtimeState.serverRequestsById.delete(requestId);
    broadcastMessage(app, {
      type: 'server_request_resolved',
      requestId,
      threadId: existing?.threadId || (typeof params.threadId === 'string' ? params.threadId : undefined),
    });
    return;
  }
}

export async function ensureCodexReady(app: FastifyInstance): Promise<void> {
  if (!app.runtimeState.codexStarted) {
    await app.codexClient.start();
    app.runtimeState.codexStarted = true;
  }

  if (app.runtimeState.codexBridgeRegistered) {
    return;
  }

  app.codexClient.on('notification', (msg: { method?: string; params?: Record<string, unknown> }) => {
    handleNotification(app, msg);
  });

  app.codexClient.on('server_request', (msg: { id: string | number; method: string; params?: Record<string, unknown> }) => {
    const request = createServerRequestRecord(msg);
    app.runtimeState.serverRequestsById.set(request.requestId, request);
    broadcastMessage(app, {
      type: 'server_request_required',
      request,
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

export async function bootstrapTabs(app: FastifyInstance): Promise<RuntimeTab[]> {
  await ensureCodexReady(app);
  const threads = await app.codexClient.listThreads(100);
  const nextTabs = Array.isArray(threads)
    ? threads
      .map((thread) => upsertRuntimeTab(app, thread))
      .filter((tab) => tab.threadId)
    : [];
  return nextTabs.length ? nextTabs : listRuntimeTabs(app);
}

export function buildInitialState(app: FastifyInstance): Extract<ServerMessage, { type: 'state' }> {
  return {
    type: 'state',
    tabs: listRuntimeTabs(app),
    serverRequests: listServerRequests(app),
    globalSupplementalItems: [],
  };
}

export function setServerRequestSubmitting(app: FastifyInstance, requestId: string): void {
  const existing = app.runtimeState.serverRequestsById.get(requestId);
  if (!existing) {
    return;
  }
  existing.status = 'submitting';
  existing.submittedAt = Date.now();
  broadcastMessage(app, {
    type: 'server_request_updated',
    request: existing,
  });
}

export function resetServerRequestPending(app: FastifyInstance, requestId: string): void {
  const existing = app.runtimeState.serverRequestsById.get(requestId);
  if (!existing) {
    return;
  }
  existing.status = 'pending';
  existing.submittedAt = null;
  broadcastMessage(app, {
    type: 'server_request_updated',
    request: existing,
  });
}
