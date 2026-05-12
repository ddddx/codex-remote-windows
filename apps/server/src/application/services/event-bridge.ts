import type { FastifyInstance } from 'fastify';
import { persistServerRequest } from './server-requests.js';
import { upsertRuntimeTab } from './session-tabs.js';
import {
  appendTimelineEvent,
  pushGlobalNotice,
  setCachedTurnDiff,
  setCachedTurnPlan,
  upsertSupplementalItem,
} from './runtime-cache.js';
import { broadcastMessage } from '../../ws/bridge.js';

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function broadcastThreadTimelineMessage(app: FastifyInstance, message: Record<string, unknown>): void {
  const threadId = typeof message.threadId === 'string' ? message.threadId : undefined;
  if (threadId) {
    appendTimelineEvent(app.runtimeState, threadId, message);
  }
  broadcastMessage(app, message as any);
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
    broadcastThreadTimelineMessage(app, {
      type: 'turn_completed',
      threadId: params.threadId,
      turnId: typeof turn?.id === 'string' ? turn.id : undefined,
    });
    return;
  }

  if (method === 'item/agentMessage/delta' && typeof params.threadId === 'string') {
    broadcastThreadTimelineMessage(app, {
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
    broadcastThreadTimelineMessage(app, {
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
  }
}
