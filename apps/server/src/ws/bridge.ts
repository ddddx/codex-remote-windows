import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@codex-remote/protocol';
import { createSessionRecord, createThreadPreferenceRecord } from '@codex-remote/domain';
import {
  createServerRequestRecord,
  listServerRequests,
  persistServerRequest,
  type RuntimeServerRequest,
} from '../application/services/server-requests.js';
import {
  listSupplementalItems,
  listTurnDiffs,
  listTurnPlans,
  pushGlobalNotice,
  setCachedTurnDiff,
  setCachedTurnPlan,
  upsertSupplementalItem,
} from '../application/services/runtime-cache.js';
import type { GlobalNoticeSnapshot } from '../state/runtime-state.js';

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
  app.repositories.sessions.upsertSession(createSessionRecord({
    threadId: merged.threadId,
    name: merged.name,
    cwd: merged.cwd,
    status: merged.status,
    windowStatus: merged.windowStatus,
    approvalPolicy: merged.approvalPolicy || '',
    sandboxMode: merged.sandboxMode || '',
    createdAt: merged.createdAt,
    updatedAt: merged.updatedAt,
  }));
  if (merged.approvalPolicy || merged.sandboxMode) {
    app.repositories.threadPreferences.upsertThreadPreference(createThreadPreferenceRecord({
      threadId: merged.threadId,
      approvalPolicy: merged.approvalPolicy || '',
      sandboxMode: merged.sandboxMode || '',
    }));
  }
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

  if (method === 'item/plan/delta' && typeof params.threadId === 'string') {
    setCachedTurnPlan(app.runtimeState, params.threadId, typeof params.turnId === 'string' ? params.turnId : undefined, {
      explanation: '',
      plan: [],
    });
    broadcastMessage(app, {
      type: 'plan_delta',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      itemId: typeof params.itemId === 'string' ? params.itemId : undefined,
      delta: typeof params.delta === 'string' ? params.delta : '',
      startedAt: typeof params.startedAt === 'number' ? params.startedAt : Date.now(),
    });
    return;
  }

  if (method === 'item/mcpToolCall/progress' && typeof params.threadId === 'string') {
    broadcastMessage(app, {
      type: 'mcp_tool_progress',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      itemId: typeof params.itemId === 'string' ? params.itemId : undefined,
      message: typeof params.message === 'string' ? params.message : '',
      startedAt: typeof params.startedAt === 'number' ? params.startedAt : Date.now(),
    });
    return;
  }

  if (method === 'hook/started' && typeof params.threadId === 'string') {
    const run = params.run && typeof params.run === 'object' ? params.run as Record<string, unknown> : {};
    const runId = typeof run.id === 'string' ? run.id : '';
    if (runId) {
      upsertSupplementalItem(app.runtimeState, params.threadId, {
        id: runId,
        type: 'hookEvent',
        _turnId: typeof params.turnId === 'string' ? params.turnId : null,
        phase: 'started',
        status: typeof run.status === 'string' ? run.status : '',
        run,
        startedAt: typeof run.startedAt === 'number' ? run.startedAt : Date.now(),
        completedAt: typeof run.completedAt === 'number' ? run.completedAt : null,
      });
    }
    broadcastMessage(app, {
      type: 'hook_started',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      run: params.run,
    });
    return;
  }

  if (method === 'hook/completed' && typeof params.threadId === 'string') {
    const run = params.run && typeof params.run === 'object' ? params.run as Record<string, unknown> : {};
    const runId = typeof run.id === 'string' ? run.id : '';
    if (runId) {
      upsertSupplementalItem(app.runtimeState, params.threadId, {
        id: runId,
        type: 'hookEvent',
        _turnId: typeof params.turnId === 'string' ? params.turnId : null,
        phase: 'completed',
        status: typeof run.status === 'string' ? run.status : '',
        run,
        startedAt: typeof run.startedAt === 'number' ? run.startedAt : Date.now(),
        completedAt: typeof run.completedAt === 'number' ? run.completedAt : Date.now(),
      });
    }
    broadcastMessage(app, {
      type: 'hook_completed',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      run: params.run,
    });
    return;
  }

  if (method === 'item/autoApprovalReview/started' && typeof params.threadId === 'string') {
    const reviewId = typeof params.reviewId === 'string' ? params.reviewId : '';
    if (reviewId) {
      upsertSupplementalItem(app.runtimeState, params.threadId, {
        id: reviewId,
        type: 'guardianReview',
        _turnId: typeof params.turnId === 'string' ? params.turnId : null,
        phase: 'started',
        status: 'running',
        review: params.review as Record<string, unknown> | null,
        action: params.action as Record<string, unknown> | null,
        targetItemId: typeof params.targetItemId === 'string' ? params.targetItemId : null,
        startedAt: typeof params.startedAtMs === 'number' ? params.startedAtMs : Date.now(),
      });
    }
    broadcastMessage(app, {
      type: 'guardian_review_started',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
    });
    return;
  }

  if (method === 'item/autoApprovalReview/completed' && typeof params.threadId === 'string') {
    const reviewId = typeof params.reviewId === 'string' ? params.reviewId : '';
    if (reviewId) {
      upsertSupplementalItem(app.runtimeState, params.threadId, {
        id: reviewId,
        type: 'guardianReview',
        _turnId: typeof params.turnId === 'string' ? params.turnId : null,
        phase: 'completed',
        status: typeof (params.review as any)?.status === 'string' ? (params.review as any).status : 'completed',
        review: params.review as Record<string, unknown> | null,
        action: params.action as Record<string, unknown> | null,
        targetItemId: typeof params.targetItemId === 'string' ? params.targetItemId : null,
        decisionSource: typeof params.decisionSource === 'string' ? params.decisionSource : null,
        startedAt: typeof params.startedAtMs === 'number' ? params.startedAtMs : Date.now(),
        completedAt: typeof params.completedAtMs === 'number' ? params.completedAtMs : Date.now(),
      });
    }
    broadcastMessage(app, {
      type: 'guardian_review_completed',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
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

  if (method === 'item/fileChange/patchUpdated') {
    if (typeof params.threadId === 'string' && typeof params.turnId === 'string' && typeof params.patch === 'string') {
      setCachedTurnDiff(app.runtimeState, params.threadId, params.turnId, params.patch);
    }
    const requestId = typeof params.requestId === 'string' || typeof params.requestId === 'number'
      ? String(params.requestId)
      : '';
    const existing = requestId ? app.runtimeState.serverRequestsById.get(requestId) : null;
    if (existing && existing.kind === 'file_change_approval') {
      existing.patch = typeof params.patch === 'string' ? params.patch : existing.patch;
      existing.changes = Array.isArray(params.changes) ? params.changes : existing.changes;
      persistServerRequest(app, existing);
      broadcastMessage(app, {
        type: 'server_request_updated',
        request: existing,
      });
    }
  }

  if (method.startsWith('item/') && typeof params.threadId === 'string') {
    broadcastMessage(app, {
      type: 'item_delta',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      itemId: typeof params.itemId === 'string'
        ? params.itemId
        : typeof params.callId === 'string'
          ? params.callId
          : undefined,
      method,
      delta: typeof params.delta === 'string' ? params.delta : undefined,
      patch: typeof params.patch === 'string' ? params.patch : undefined,
      changes: Array.isArray(params.changes) ? params.changes : undefined,
      part: params.part,
      startedAt: typeof params.startedAt === 'number' ? params.startedAt : Date.now(),
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
    app.repositories.pendingRequests.removePendingRequest(requestId);
    broadcastMessage(app, {
      type: 'server_request_resolved',
      requestId,
      threadId: existing?.threadId || (typeof params.threadId === 'string' ? params.threadId : undefined),
    });
    return;
  }

  if (method === 'warning') {
    pushGlobalNotice(app.runtimeState, {
      id: typeof params.noticeId === 'string' ? params.noticeId : `warning:${Date.now()}`,
      type: '_warning',
      text: typeof params.message === 'string' ? params.message : 'Warning',
      noticeKind: typeof params.noticeKind === 'string' ? params.noticeKind : 'warning',
      createdAt: typeof params.createdAt === 'number' ? params.createdAt : Date.now(),
      threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
    });
    broadcastMessage(app, {
      type: 'warning',
      message: typeof params.message === 'string' ? params.message : 'Warning',
      threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
      noticeId: typeof params.noticeId === 'string' ? params.noticeId : undefined,
      createdAt: typeof params.createdAt === 'number' ? params.createdAt : Date.now(),
      noticeKind: typeof params.noticeKind === 'string' ? params.noticeKind : 'warning',
    });
    return;
  }

  if (method === 'error' && typeof params.threadId !== 'string') {
    pushGlobalNotice(app.runtimeState, {
      id: typeof params.noticeId === 'string' ? params.noticeId : `error:${Date.now()}`,
      type: '_error',
      text: typeof params.message === 'string'
        ? params.message
        : typeof params.error === 'string'
          ? params.error
          : 'Error',
      noticeKind: typeof params.noticeKind === 'string' ? params.noticeKind : 'error',
      createdAt: typeof params.createdAt === 'number' ? params.createdAt : Date.now(),
    });
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
    persistServerRequest(app, request);
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
  if (!app.runtimeState.tabsById.size) {
    for (const persisted of app.repositories.sessions.listSessions()) {
      app.runtimeState.tabsById.set(persisted.threadId, persisted as any);
    }
  }
  if (!app.runtimeState.serverRequestsById.size) {
    for (const request of app.repositories.pendingRequests.listPendingRequests()) {
      app.runtimeState.serverRequestsById.set(request.requestId, request as any);
    }
  }

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
    globalSupplementalItems: [...app.runtimeState.globalNotices],
  };
}

export function buildThreadSyncMessage(
  app: FastifyInstance,
  threadId: string,
  thread: Record<string, unknown>,
): Extract<ServerMessage, { type: 'thread_sync' }> {
  const turns = Array.isArray(thread.turns) ? thread.turns as Array<Record<string, unknown>> : [];
  return {
    type: 'thread_sync',
    threadId,
    turns,
    supplementalItems: listSupplementalItems(app.runtimeState, threadId),
    globalSupplementalItems: [...app.runtimeState.globalNotices],
    tokenUsage: thread.tokenUsage ?? thread.token_usage ?? null,
    turnPlans: listTurnPlans(app.runtimeState, threadId, turns),
    turnDiffs: listTurnDiffs(app.runtimeState, threadId, turns),
  };
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
  persistServerRequest(app, existing);
  broadcastMessage(app, {
    type: 'server_request_updated',
    request: existing,
  });
}
