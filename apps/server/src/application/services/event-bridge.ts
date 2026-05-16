import type { FastifyInstance } from 'fastify';
import { persistServerRequest } from './server-requests.js';
import { upsertRuntimeTab } from './session-tabs.js';
import {
  appendTimelineEvent,
  pushGlobalNotice,
  removeSupplementalItem,
  setCachedTurnDiff,
  setCachedTurnPlan,
  upsertSupplementalItem,
} from './runtime-cache.js';
import { broadcastMessage } from '../../ws/bridge.js';

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const AGENT_DELTA_FLUSH_MS = 40;

type PendingAgentDelta = {
  message: Record<string, unknown> & {
    threadId: string;
    itemId?: string;
    turnId?: string;
    delta: string;
    startedAt: number;
  };
  timer: ReturnType<typeof setTimeout>;
};

const pendingAgentDeltas = new Map<string, PendingAgentDelta>();

function buildAgentDeltaKey(threadId: string, turnId: string | undefined, itemId: string | undefined): string {
  return [threadId, turnId || '', itemId || ''].join(':');
}

function broadcastThreadTimelineMessage(app: FastifyInstance, message: Record<string, unknown>): void {
  const threadId = typeof message.threadId === 'string' ? message.threadId : undefined;
  if (threadId) {
    appendTimelineEvent(app.runtimeState, threadId, message);
  }
  broadcastMessage(app, message as any);
}

function getThreadId(params: Record<string, unknown>): string | undefined {
  return typeof params.threadId === 'string' ? params.threadId : undefined;
}

function getTurnId(params: Record<string, unknown>): string | undefined {
  return typeof params.turnId === 'string' ? params.turnId : undefined;
}

function getItemId(params: Record<string, unknown>): string | undefined {
  if (typeof params.itemId === 'string') {
    return params.itemId;
  }
  if (typeof params.processId === 'string') {
    return params.processId;
  }
  if (typeof params.processHandle === 'string') {
    return params.processHandle;
  }
  if (typeof params.callId === 'string') {
    return params.callId;
  }
  return undefined;
}

function extractNoticeMessage(params: Record<string, unknown>, fallback: string): string {
  if (typeof params.message === 'string' && params.message.trim()) {
    return params.message;
  }
  if (typeof params.error === 'string' && params.error.trim()) {
    return params.error;
  }
  const error = params.error && typeof params.error === 'object' ? params.error as Record<string, unknown> : null;
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function extractStatus(params: Record<string, unknown>): string | undefined {
  if (typeof params.status === 'string') {
    return params.status;
  }
  if (typeof params.reason === 'string') {
    return params.reason;
  }
  if (typeof params.success === 'boolean') {
    return params.success ? 'completed' : 'failed';
  }
  return undefined;
}

function broadcastGenericThreadEvent(
  app: FastifyInstance,
  method: string,
  params: Record<string, unknown>,
): boolean {
  const threadId = getThreadId(params);
  if (!threadId) {
    return false;
  }

  broadcastThreadTimelineMessage(app, {
    type: 'thread_event',
    threadId,
    turnId: getTurnId(params),
    itemId: getItemId(params),
    method,
    params,
    message: typeof params.message === 'string' ? params.message : undefined,
    delta: typeof params.delta === 'string'
      ? params.delta
      : typeof params.deltaBase64 === 'string'
        ? params.deltaBase64
        : undefined,
    status: extractStatus(params),
    createdAt: typeof params.createdAt === 'number' ? params.createdAt : Date.now(),
  });
  return true;
}

function flushAgentDeltaByKey(app: FastifyInstance, key: string): void {
  const pending = pendingAgentDeltas.get(key);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  pendingAgentDeltas.delete(key);
  if (pending.message.delta) {
    broadcastThreadTimelineMessage(app, pending.message);
  }
}

export function flushPendingAgentDeltas(app: FastifyInstance, threadId?: string): void {
  for (const [key, pending] of [...pendingAgentDeltas]) {
    if (threadId && pending.message.threadId !== threadId) {
      continue;
    }
    flushAgentDeltaByKey(app, key);
  }
}

function queueAgentDelta(
  app: FastifyInstance,
  message: PendingAgentDelta['message'],
): void {
  const key = buildAgentDeltaKey(message.threadId, message.turnId, message.itemId);
  const pending = pendingAgentDeltas.get(key);
  if (pending) {
    pending.message.delta += message.delta;
    pending.message.startedAt = Math.min(pending.message.startedAt, message.startedAt);
    return;
  }

  const timer = setTimeout(() => flushAgentDeltaByKey(app, key), AGENT_DELTA_FLUSH_MS);
  pendingAgentDeltas.set(key, {
    message: { ...message },
    timer,
  });
}

export function handleCodexNotification(
  app: FastifyInstance,
  msg: { method?: string; params?: Record<string, unknown> },
): void {
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
    const current = app.runtimeState.tabsById.get(params.threadId);
    if (current) {
      const tab = upsertRuntimeTab(app, {
        ...current,
        tokenUsage: params.tokenUsage ?? null,
        updatedAt: nowUnix(),
      });
      broadcastMessage(app, { type: 'tab_updated', tab });
    }
    broadcastThreadTimelineMessage(app, {
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
    broadcastThreadTimelineMessage(app, {
      type: 'turn_started',
      threadId: params.threadId,
      turnId: typeof turn?.id === 'string' ? turn.id : undefined,
      startedAt: typeof turn?.startedAt === 'number' ? turn.startedAt : Date.now(),
    });
    return;
  }

  if (method === 'turn/completed' && typeof params.threadId === 'string') {
    flushPendingAgentDeltas(app, params.threadId);
    const current = app.runtimeState.tabsById.get(params.threadId);
    const turn = params.turn as Record<string, unknown> | undefined;
    const turnId = typeof turn?.id === 'string' ? turn.id : undefined;
    if (turnId) {
      removeSupplementalItem(app.runtimeState, params.threadId, `pending-user:${turnId}`);
    }
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
    broadcastThreadTimelineMessage(app, {
      type: 'turn_completed',
      threadId: params.threadId,
      turnId,
    });
    return;
  }

  if (method === 'error' && typeof params.threadId === 'string') {
    const message = extractNoticeMessage(params, 'Codex error');
    broadcastThreadTimelineMessage(app, {
      type: 'error_notice',
      message,
      threadId: params.threadId,
      noticeId: typeof params.noticeId === 'string' ? params.noticeId : undefined,
      createdAt: typeof params.createdAt === 'number' ? params.createdAt : Date.now(),
      noticeKind: typeof params.noticeKind === 'string' ? params.noticeKind : 'error',
    });
    return;
  }

  if (method === 'item/agentMessage/delta' && typeof params.threadId === 'string') {
    queueAgentDelta(app, {
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
    broadcastThreadTimelineMessage(app, {
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
    broadcastThreadTimelineMessage(app, {
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
    broadcastThreadTimelineMessage(app, {
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
    broadcastThreadTimelineMessage(app, {
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
    broadcastThreadTimelineMessage(app, {
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
    broadcastThreadTimelineMessage(app, {
      type: 'guardian_review_completed',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
    });
    return;
  }

  if (method === 'item/started' && typeof params.threadId === 'string') {
    broadcastThreadTimelineMessage(app, {
      type: 'item_started',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      item: params.item,
      startedAt: Date.now(),
    });
    return;
  }

  if (method === 'item/completed' && typeof params.threadId === 'string') {
    const item = params.item && typeof params.item === 'object' ? params.item as Record<string, unknown> : null;
    if (item?.type === 'agentMessage') {
      flushPendingAgentDeltas(app, params.threadId);
    }
    broadcastThreadTimelineMessage(app, {
      type: 'item_completed',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      item: params.item,
      completedAt: typeof params.completedAt === 'number'
        ? params.completedAt
        : typeof params.completedAtMs === 'number'
          ? params.completedAtMs
          : Date.now(),
    });
    return;
  }

  if (method === 'turn/diff/updated' && typeof params.threadId === 'string') {
    const turnId = typeof params.turnId === 'string' ? params.turnId : undefined;
    const diff = typeof params.diff === 'string' ? params.diff : '';
    if (turnId) {
      setCachedTurnDiff(app.runtimeState, params.threadId, turnId, diff);
    }
    broadcastThreadTimelineMessage(app, {
      type: 'turn_diff_updated',
      threadId: params.threadId,
      turnId,
      diff,
    });
    return;
  }

  if (method === 'model/rerouted' && typeof params.threadId === 'string') {
    const current = app.runtimeState.tabsById.get(params.threadId);
    const toModel = typeof params.toModel === 'string' ? params.toModel : '';
    if (current && toModel) {
      const tab = upsertRuntimeTab(app, {
        ...current,
        model: toModel,
        updatedAt: nowUnix(),
      });
      broadcastMessage(app, { type: 'tab_updated', tab });
    }
    broadcastThreadTimelineMessage(app, {
      type: 'model_rerouted',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      fromModel: typeof params.fromModel === 'string' ? params.fromModel : '',
      toModel,
      reason: params.reason,
    });
    return;
  }

  if (method === 'thread/closed' && typeof params.threadId === 'string') {
    const current = app.runtimeState.tabsById.get(params.threadId);
    if (current) {
      const tab = upsertRuntimeTab(app, {
        ...current,
        status: 'closed',
        updatedAt: nowUnix(),
      });
      broadcastMessage(app, { type: 'tab_updated', tab });
    }
    broadcastGenericThreadEvent(app, method, params);
    return;
  }

  if (method === 'thread/archived' || method === 'thread/unarchived') {
    broadcastGenericThreadEvent(app, method, params);
    return;
  }

  if (method === 'thread/compacted' && typeof params.threadId === 'string') {
    broadcastThreadTimelineMessage(app, {
      type: 'item_completed',
      threadId: params.threadId,
      turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
      item: {
        id: `context-compaction:${params.turnId || Date.now()}`,
        type: 'contextCompaction',
      },
      completedAt: Date.now(),
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
    broadcastThreadTimelineMessage(app, {
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

  if (
    method === 'process/outputDelta'
    || method === 'process/exited'
    || method === 'command/exec/outputDelta'
    || method === 'rawResponseItem/completed'
    || method === 'model/verification'
    || method.startsWith('thread/realtime/')
    || method.startsWith('thread/goal/')
  ) {
    if (broadcastGenericThreadEvent(app, method, params)) {
      return;
    }
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
    broadcastThreadTimelineMessage(app, {
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
    broadcastMessage(app, {
      type: 'error_notice',
      message: extractNoticeMessage(params, 'Error'),
      noticeId: typeof params.noticeId === 'string' ? params.noticeId : undefined,
      createdAt: typeof params.createdAt === 'number' ? params.createdAt : Date.now(),
      noticeKind: typeof params.noticeKind === 'string' ? params.noticeKind : 'error',
    });
    return;
  }

  if (method) {
    broadcastMessage(app, {
      type: 'notification',
      method,
      params,
    });
  }
}
