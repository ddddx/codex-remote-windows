import { createSessionRecord, createThreadPreferenceRecord } from '@codex-remote/domain';
import type { FastifyInstance } from 'fastify';

export type RuntimeTab = {
  threadId: string;
  name: string;
  cwd: string;
  status: string;
  updatedAt: number;
  createdAt: number;
  windowStatus: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  model?: string;
  reasoningEffort?: string;
  tokenUsage?: unknown;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function resolveTabName(source: Record<string, unknown>): string {
  const candidates = [
    source.name,
    source.threadName,
    source.thread_name,
    source.preview,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '未命名会话';
}

export function normalizeTab(source: Record<string, unknown>): RuntimeTab {
  const normalized: RuntimeTab = {
    threadId: String(source.threadId || source.id || ''),
    name: resolveTabName(source),
    cwd: typeof source.cwd === 'string' ? source.cwd : '',
    status: typeof source.status === 'string' && source.status.trim() ? source.status : 'idle',
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : nowUnix(),
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : nowUnix(),
    windowStatus: typeof source.windowStatus === 'string' && source.windowStatus.trim() ? source.windowStatus : 'detached',
    tokenUsage: source.tokenUsage ?? source.token_usage ?? source.usage ?? source.tokenStats ?? source.token_stats ?? null,
  };

  if (typeof source.approvalPolicy === 'string') {
    normalized.approvalPolicy = source.approvalPolicy;
  }

  if (typeof source.sandboxMode === 'string') {
    normalized.sandboxMode = source.sandboxMode;
  }

  if (typeof source.model === 'string') {
    normalized.model = source.model;
  }

  if (typeof source.reasoningEffort === 'string') {
    normalized.reasoningEffort = source.reasoningEffort;
  }

  return normalized;
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
  if (merged.approvalPolicy || merged.sandboxMode || merged.model || merged.reasoningEffort) {
    app.repositories.threadPreferences.upsertThreadPreference(createThreadPreferenceRecord({
      threadId: merged.threadId,
      approvalPolicy: merged.approvalPolicy || '',
      sandboxMode: merged.sandboxMode || '',
      model: merged.model || '',
      reasoningEffort: merged.reasoningEffort || '',
    }));
  }
  return merged;
}

export function listRuntimeTabs(app: FastifyInstance): RuntimeTab[] {
  return Array.from(app.runtimeState.tabsById.values()).sort((left, right) => {
    const updatedDiff = right.updatedAt - left.updatedAt;
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return left.threadId.localeCompare(right.threadId);
  });
}
