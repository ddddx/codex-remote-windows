import type { FastifyInstance } from 'fastify';
import type {
  GlobalSupplementalItemPayload,
  ServerMessage,
  SupplementalItemPayload,
  ThreadTurnPayload,
  TimelineEventPayload,
  TokenUsagePayload,
} from '@codex-remote/protocol';
import type { v2 } from '@codex-remote/codex-app-server-types';
import {
  listServerRequests,
  restoreServerRequestRecord,
} from './server-requests.js';
import {
  hydrateTimelineEvents,
  listSupplementalItems,
  listTimelineEvents,
  listTurnDiffs,
  listTurnPlans,
} from './runtime-cache.js';
import {
  listRuntimeTabs,
  toSessionTabPayload,
  upsertRuntimeTab,
  type RuntimeTab,
} from './session-tabs.js';

export type RuntimeThread = v2.Thread & {
  model?: string;
  reasoningEffort?: string | null;
  approvalPolicy?: string;
  sandboxMode?: string;
  tokenUsage?: TokenUsagePayload;
  token_usage?: TokenUsagePayload;
  usage?: TokenUsagePayload;
  tokenStats?: TokenUsagePayload;
  token_stats?: TokenUsagePayload;
  turnsPage?: v2.TurnsPage | null;
};

const DEFAULT_THREAD_SYNC_TURN_LIMIT = 60;
const MAX_THREAD_SYNC_TURN_LIMIT = 60;
const MAX_THREAD_SYNC_UNSCOPED_SUPPLEMENTAL_ITEMS = 40;
const MAX_THREAD_SYNC_UNSCOPED_EVENTS = 200;

export function hydratePersistedRuntimeState(app: FastifyInstance): void {
  if (!app.runtimeState.tabsById.size) {
    for (const persisted of app.repositories.sessions.listSessions()) {
      const preference =
        typeof app.repositories.threadPreferences.getThreadPreference ===
        'function'
          ? app.repositories.threadPreferences.getThreadPreference(
              persisted.threadId,
            )
          : null;
      app.runtimeState.tabsById.set(persisted.threadId, {
        ...persisted,
        approvalPolicy:
          preference?.approvalPolicy || persisted.approvalPolicy || '',
        sandboxMode: preference?.sandboxMode || persisted.sandboxMode || '',
        model: preference?.model || '',
        reasoningEffort: preference?.reasoningEffort || '',
      });
      hydrateTimelineEvents(app.runtimeState, persisted.threadId);
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

export async function bootstrapTabs(
  app: FastifyInstance,
): Promise<RuntimeTab[]> {
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

export function buildInitialState(
  app: FastifyInstance,
): Extract<ServerMessage, { type: 'state' }> {
  return {
    type: 'state',
    tabs: listRuntimeTabs(app).map(toSessionTabPayload),
    serverRequests: listServerRequests(app),
    globalSupplementalItems: [
      ...app.runtimeState.globalNotices,
    ] as GlobalSupplementalItemPayload[],
  };
}

export function buildThreadSyncMessage(
  app: FastifyInstance,
  threadId: string,
  thread: RuntimeThread,
): Extract<ServerMessage, { type: 'thread_sync' }> {
  const turns = Array.isArray(thread.turns)
    ? (thread.turns as ThreadTurnPayload[])
    : [];
  const turnIds = collectTurnIds(turns);
  return {
    type: 'thread_sync',
    threadId,
    turns,
    supplementalItems: filterSupplementalItemsForTurns(
      listSupplementalItems(app.runtimeState, threadId) as SupplementalItemPayload[],
      turnIds,
    ),
    globalSupplementalItems: [
      ...app.runtimeState.globalNotices,
    ] as GlobalSupplementalItemPayload[],
    tokenUsage: (thread.tokenUsage ??
      thread.token_usage ??
      thread.usage ??
      thread.tokenStats ??
      thread.token_stats ??
      null) as TokenUsagePayload,
    turnPlans: filterTurnScopedSnapshots(listTurnPlans(app.runtimeState, threadId, turns), turnIds),
    turnDiffs: filterTurnScopedSnapshots(listTurnDiffs(app.runtimeState, threadId, turns), turnIds),
    timelineEvents: compactTimelineEventsForThreadSync(filterTimelineEventsForTurns(
      listTimelineEvents(app.runtimeState, threadId) as TimelineEventPayload[],
      turnIds,
    )),
    historyCursor: thread.turnsPage?.nextCursor ?? null,
    hasMoreHistory: Boolean(thread.turnsPage?.nextCursor),
  };
}

export function buildThreadHistoryMessage(
  app: FastifyInstance,
  threadId: string,
  page: v2.TurnsPage,
): Extract<ServerMessage, { type: 'thread_history' }> {
  const turns = [...(Array.isArray(page.data) ? page.data : [])].reverse() as ThreadTurnPayload[];
  const turnIds = collectTurnIds(turns);
  return {
    type: 'thread_history',
    threadId,
    turns,
    turnPlans: filterTurnScopedSnapshots(listTurnPlans(app.runtimeState, threadId, turns), turnIds),
    turnDiffs: filterTurnScopedSnapshots(listTurnDiffs(app.runtimeState, threadId, turns), turnIds),
    historyCursor: page.nextCursor ?? null,
    hasMoreHistory: Boolean(page.nextCursor),
  };
}

export function defaultThreadSyncTurnLimit(): number {
  return DEFAULT_THREAD_SYNC_TURN_LIMIT;
}

export function normalizeThreadSyncTurnLimit(limit?: number | null): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_THREAD_SYNC_TURN_LIMIT;
  }
  return Math.max(1, Math.min(Math.floor(limit), MAX_THREAD_SYNC_TURN_LIMIT));
}

function collectTurnIds(turns: ThreadTurnPayload[]): Set<string> {
  return new Set(
    turns
      .map((turn) => typeof turn.id === 'string' ? turn.id : '')
      .filter(Boolean),
  );
}

function filterTurnScopedSnapshots<T extends { turnId?: string }>(
  snapshots: T[],
  turnIds: Set<string>,
): T[] {
  if (!turnIds.size) {
    return [];
  }
  return snapshots.filter((snapshot) => typeof snapshot.turnId === 'string' && turnIds.has(snapshot.turnId));
}

function filterSupplementalItemsForTurns(
  items: SupplementalItemPayload[],
  turnIds: Set<string>,
): SupplementalItemPayload[] {
  const scoped: SupplementalItemPayload[] = [];
  const unscoped: SupplementalItemPayload[] = [];
  for (const item of items) {
    const turnId = typeof item._turnId === 'string' ? item._turnId : '';
    if (turnId && turnIds.has(turnId)) {
      scoped.push(item);
      continue;
    }
    if (!turnId) {
      unscoped.push(item);
    }
  }
  return [
    ...scoped,
    ...unscoped.slice(-MAX_THREAD_SYNC_UNSCOPED_SUPPLEMENTAL_ITEMS),
  ];
}

function filterTimelineEventsForTurns(
  events: TimelineEventPayload[],
  turnIds: Set<string>,
): TimelineEventPayload[] {
  const scoped: TimelineEventPayload[] = [];
  const unscoped: TimelineEventPayload[] = [];
  for (const event of events as Array<TimelineEventPayload & { turnId?: string }>) {
    const turnId = typeof event.turnId === 'string' ? event.turnId : '';
    if (turnId && turnIds.has(turnId)) {
      scoped.push(event);
      continue;
    }
    if (!turnId) {
      unscoped.push(event);
    }
  }
  return [
    ...scoped,
    ...unscoped.slice(-MAX_THREAD_SYNC_UNSCOPED_EVENTS),
  ];
}

type SequencedTimelineEvent = Record<string, unknown> & {
  type: string;
  sequence?: number;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  method?: string;
  delta?: string;
  patch?: string;
  changes?: unknown;
  startedAt?: number;
  createdAt?: number;
  completedAt?: number;
  updatedAt?: number;
  item?: Record<string, unknown>;
};

function readString(source: Record<string, unknown> | null | undefined, key: string): string {
  const value = source?.[key];
  return typeof value === 'string' ? value : '';
}

function hasStructuredText(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(hasStructuredText);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const source = value as Record<string, unknown>;
  return [
    'text',
    'content',
    'output',
    'message',
    'parts',
    'value',
    'summary',
  ].some((key) => hasStructuredText(source[key]));
}

function hasCompletedAssistantText(event: SequencedTimelineEvent): boolean {
  const item = event.item;
  if (!item) {
    return false;
  }
  const itemType = readString(item, 'type');
  const role = readString(item, 'role');
  if (
    itemType !== 'agentMessage' &&
    itemType !== 'agent_message' &&
    itemType !== 'assistantMessage' &&
    itemType !== 'assistant_message' &&
    !(itemType === 'message' && role === 'assistant')
  ) {
    return false;
  }
  return hasStructuredText(item.text) ||
    hasStructuredText(item.content) ||
    hasStructuredText(item.output) ||
    hasStructuredText(item.message) ||
    hasStructuredText(item.parts);
}

function hasCompletedCommandOutput(event: SequencedTimelineEvent): boolean {
  const item = event.item;
  if (!item || readString(item, 'type') !== 'commandExecution') {
    return false;
  }
  return hasStructuredText(item.output) || hasStructuredText(item.aggregatedOutput);
}

function completedItemId(event: SequencedTimelineEvent): string {
  return readString(event, 'itemId') || readString(event.item, 'id');
}

function eventTime(event: SequencedTimelineEvent): number {
  return event.startedAt || event.createdAt || event.completedAt || event.updatedAt || 0;
}

function mergeDeltaEvent(
  current: SequencedTimelineEvent,
  incoming: SequencedTimelineEvent,
): SequencedTimelineEvent {
  return {
    ...current,
    ...incoming,
    sequence: current.sequence,
    startedAt: current.startedAt && incoming.startedAt
      ? Math.min(current.startedAt, incoming.startedAt)
      : current.startedAt || incoming.startedAt,
    createdAt: current.createdAt && incoming.createdAt
      ? Math.min(current.createdAt, incoming.createdAt)
      : current.createdAt || incoming.createdAt,
    delta: `${current.delta || ''}${incoming.delta || ''}`,
    patch: incoming.patch ?? current.patch,
    changes: incoming.changes ?? current.changes,
  };
}

function compactKey(event: SequencedTimelineEvent): string {
  const type = event.type;
  if (type === 'agent_delta' || type === 'plan_delta') {
    return [
      type,
      event.threadId || '',
      event.turnId || '',
      event.itemId || '',
    ].join(':');
  }
  if (type === 'item_delta') {
    return [
      type,
      event.method || '',
      event.threadId || '',
      event.turnId || '',
      event.itemId || '',
    ].join(':');
  }
  return '';
}

function shouldCompactDelta(event: SequencedTimelineEvent): boolean {
  if (event.type === 'agent_delta' || event.type === 'plan_delta') {
    return typeof event.delta === 'string';
  }
  if (event.type !== 'item_delta' || typeof event.delta !== 'string') {
    return false;
  }
  return event.method === 'item/commandExecution/outputDelta' ||
    event.method === 'item/fileChange/outputDelta' ||
    event.method === 'item/reasoning/summaryTextDelta' ||
    event.method === 'item/reasoning/textDelta';
}

export function compactTimelineEventsForThreadSync(
  events: TimelineEventPayload[],
): TimelineEventPayload[] {
  const completedAssistantTextIds = new Set<string>();
  const completedCommandOutputIds = new Set<string>();
  for (const event of events as unknown as SequencedTimelineEvent[]) {
    if (event.type !== 'item_completed') {
      continue;
    }
    const itemId = completedItemId(event);
    if (!itemId) {
      continue;
    }
    if (hasCompletedAssistantText(event)) {
      completedAssistantTextIds.add(itemId);
    }
    if (hasCompletedCommandOutput(event)) {
      completedCommandOutputIds.add(itemId);
    }
  }

  const compacted: SequencedTimelineEvent[] = [];
  const compactedIndexes = new Map<string, number>();
  const latestIndexes = new Map<string, number>();
  for (const event of events as unknown as SequencedTimelineEvent[]) {
    const itemId = readString(event, 'itemId') || readString(event.item, 'id');
    if (event.type === 'agent_delta' && itemId && completedAssistantTextIds.has(itemId)) {
      continue;
    }
    if (
      event.type === 'item_delta' &&
      event.method === 'item/commandExecution/outputDelta' &&
      itemId &&
      completedCommandOutputIds.has(itemId)
    ) {
      continue;
    }

    if (shouldCompactDelta(event)) {
      const key = compactKey(event);
      const existingIndex = compactedIndexes.get(key);
      if (existingIndex === undefined) {
        compactedIndexes.set(key, compacted.length);
        compacted.push({ ...event });
      } else {
        compacted[existingIndex] = mergeDeltaEvent(compacted[existingIndex], event);
      }
      continue;
    }

    if (
      event.type === 'token_usage' ||
      event.type === 'turn_diff_updated' ||
      event.type === 'turn_plan_updated'
    ) {
      const key = [
        event.type,
        event.threadId || '',
        event.turnId || '',
      ].join(':');
      const existingIndex = latestIndexes.get(key);
      if (existingIndex === undefined) {
        latestIndexes.set(key, compacted.length);
        compacted.push({ ...event });
      } else {
        compacted[existingIndex] = { ...event };
      }
      continue;
    }

    compacted.push(event);
  }

  return compacted.sort((left, right) => {
    const leftSequence = typeof left.sequence === 'number' ? left.sequence : 0;
    const rightSequence = typeof right.sequence === 'number' ? right.sequence : 0;
    if (leftSequence || rightSequence) {
      return leftSequence - rightSequence;
    }
    return eventTime(left) - eventTime(right);
  }) as unknown as TimelineEventPayload[];
}
