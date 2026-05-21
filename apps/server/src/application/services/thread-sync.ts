import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@codex-remote/protocol';
import { listServerRequests, restoreServerRequestRecord } from './server-requests.js';
import { listSupplementalItems, listTimelineEvents, listTurnDiffs, listTurnPlans } from './runtime-cache.js';
import { listRuntimeTabs, upsertRuntimeTab, type RuntimeTab } from './session-tabs.js';

export function hydratePersistedRuntimeState(app: FastifyInstance): void {
  if (!app.runtimeState.tabsById.size) {
    for (const persisted of app.repositories.sessions.listSessions()) {
      const preference = typeof app.repositories.threadPreferences.getThreadPreference === 'function'
        ? app.repositories.threadPreferences.getThreadPreference(persisted.threadId)
        : null;
      app.runtimeState.tabsById.set(persisted.threadId, {
        ...persisted,
        approvalPolicy: preference?.approvalPolicy || persisted.approvalPolicy || '',
        sandboxMode: preference?.sandboxMode || persisted.sandboxMode || '',
        model: preference?.model || (persisted as any).model || '',
        reasoningEffort: preference?.reasoningEffort || (persisted as any).reasoningEffort || '',
      } as any);
    }
  }
  if (!app.runtimeState.serverRequestsById.size) {
    for (const request of app.repositories.pendingRequests.listPendingRequests()) {
      if (request.status === 'resolved') {
        continue;
      }
      const restored = restoreServerRequestRecord(request);
      if (!restored) {
        continue;
      }
      app.runtimeState.serverRequestsById.set(restored.requestId, restored);
    }
  }
}

export async function bootstrapTabs(app: FastifyInstance): Promise<RuntimeTab[]> {
  hydratePersistedRuntimeState(app);

  const persistedTabs = listRuntimeTabs(app);

  try {
    const threads = await app.codexClient.listThreads(100);
    const nextTabs = Array.isArray(threads)
      ? threads
        .map((thread) => upsertRuntimeTab(app, thread))
        .filter((tab) => tab.threadId)
      : [];
    return nextTabs.length ? nextTabs : persistedTabs;
  } catch {
    return persistedTabs;
  }
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
    tokenUsage: thread.tokenUsage ?? thread.token_usage ?? thread.usage ?? thread.tokenStats ?? thread.token_stats ?? null,
    turnPlans: listTurnPlans(app.runtimeState, threadId, turns),
    turnDiffs: listTurnDiffs(app.runtimeState, threadId, turns),
    timelineEvents: listTimelineEvents(app.runtimeState, threadId),
  };
}
