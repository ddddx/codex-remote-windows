import type {
  GlobalNoticeSnapshot,
  RuntimeState,
  SupplementalItemSnapshot,
  TurnDiffSnapshot,
  TurnPlanSnapshot,
} from '../../state/runtime-state.js';

function ensureTurnPlanMap(runtimeState: RuntimeState, threadId?: string): Map<string, TurnPlanSnapshot> | null {
  if (!threadId) {
    return null;
  }
  if (!runtimeState.turnPlansByThread.has(threadId)) {
    runtimeState.turnPlansByThread.set(threadId, new Map());
  }
  return runtimeState.turnPlansByThread.get(threadId) || null;
}

function ensureTurnDiffMap(runtimeState: RuntimeState, threadId?: string): Map<string, TurnDiffSnapshot> | null {
  if (!threadId) {
    return null;
  }
  if (!runtimeState.turnDiffsByThread.has(threadId)) {
    runtimeState.turnDiffsByThread.set(threadId, new Map());
  }
  return runtimeState.turnDiffsByThread.get(threadId) || null;
}

function ensureSupplementalMap(runtimeState: RuntimeState, threadId?: string): Map<string, SupplementalItemSnapshot> | null {
  if (!threadId) {
    return null;
  }
  if (!runtimeState.supplementalItemsByThread.has(threadId)) {
    runtimeState.supplementalItemsByThread.set(threadId, new Map());
  }
  return runtimeState.supplementalItemsByThread.get(threadId) || null;
}

export function setCachedTurnPlan(
  runtimeState: RuntimeState,
  threadId?: string,
  turnId?: string,
  payload?: Record<string, unknown>,
): void {
  const plans = ensureTurnPlanMap(runtimeState, threadId);
  if (!plans || !turnId) {
    return;
  }
  plans.set(turnId, {
    turnId,
    explanation: typeof payload?.explanation === 'string' ? payload.explanation : '',
    plan: Array.isArray(payload?.plan) ? payload.plan as Array<{ step?: string; status?: string }> : [],
    updatedAt: Date.now(),
  });
}

export function setCachedTurnDiff(
  runtimeState: RuntimeState,
  threadId?: string,
  turnId?: string,
  diff?: unknown,
): void {
  const diffs = ensureTurnDiffMap(runtimeState, threadId);
  if (!diffs || !turnId) {
    return;
  }
  const text = typeof diff === 'string' ? diff : '';
  if (text.trim()) {
    diffs.set(turnId, {
      turnId,
      diff: text,
      updatedAt: Date.now(),
    });
    return;
  }
  diffs.delete(turnId);
}

export function upsertSupplementalItem(
  runtimeState: RuntimeState,
  threadId: string | undefined,
  item: SupplementalItemSnapshot,
): void {
  const store = ensureSupplementalMap(runtimeState, threadId);
  if (!store || !item.id) {
    return;
  }
  const existing = store.get(item.id);
  store.set(item.id, {
    ...(existing || {}),
    ...item,
    updatedAt: Date.now(),
    createdAt: item.createdAt || existing?.createdAt || Date.now(),
  });
}

export function removeSupplementalItem(
  runtimeState: RuntimeState,
  threadId: string | undefined,
  itemId: string | undefined,
): void {
  if (!threadId || !itemId) {
    return;
  }
  runtimeState.supplementalItemsByThread.get(threadId)?.delete(itemId);
}

export function listTurnPlans(
  runtimeState: RuntimeState,
  threadId: string,
  turns: Array<Record<string, unknown>>,
): TurnPlanSnapshot[] {
  const merged = new Map<string, TurnPlanSnapshot>();
  for (const turn of turns) {
    const turnId = typeof turn?.id === 'string' ? turn.id : '';
    const plan = Array.isArray(turn?.plan) ? turn.plan : [];
    const explanation = typeof turn?.explanation === 'string' ? turn.explanation : '';
    if (!turnId || !plan.length) {
      continue;
    }
    merged.set(turnId, {
      turnId,
      explanation,
      plan: plan as Array<{ step?: string; status?: string }>,
      updatedAt: Date.now(),
    });
  }
  for (const [turnId, snapshot] of runtimeState.turnPlansByThread.get(threadId) || new Map()) {
    merged.set(turnId, snapshot);
  }
  return Array.from(merged.values());
}

export function listTurnDiffs(
  runtimeState: RuntimeState,
  threadId: string,
  turns: Array<Record<string, unknown>>,
): TurnDiffSnapshot[] {
  const merged = new Map<string, TurnDiffSnapshot>();
  for (const turn of turns) {
    const turnId = typeof turn?.id === 'string' ? turn.id : '';
    const diff = typeof turn?.diff === 'string' ? turn.diff : '';
    if (!turnId || !diff.trim()) {
      continue;
    }
    merged.set(turnId, {
      turnId,
      diff,
      updatedAt: Date.now(),
    });
  }
  for (const [turnId, snapshot] of runtimeState.turnDiffsByThread.get(threadId) || new Map()) {
    merged.set(turnId, snapshot);
  }
  return Array.from(merged.values());
}

export function listSupplementalItems(
  runtimeState: RuntimeState,
  threadId: string,
): SupplementalItemSnapshot[] {
  const store = runtimeState.supplementalItemsByThread.get(threadId);
  if (!store) {
    return [];
  }
  return Array.from(store.values()).sort((left, right) => {
    const leftTime = Number(left.completedAt || left.startedAt || left.createdAt || left.updatedAt || 0);
    const rightTime = Number(right.completedAt || right.startedAt || right.createdAt || right.updatedAt || 0);
    return leftTime - rightTime;
  });
}

export function pushGlobalNotice(runtimeState: RuntimeState, notice: GlobalNoticeSnapshot): void {
  runtimeState.globalNotices.push(notice);
  while (runtimeState.globalNotices.length > 50) {
    runtimeState.globalNotices.shift();
  }
}
