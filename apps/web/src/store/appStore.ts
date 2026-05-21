import { create } from 'zustand';
import type {
  SessionTabPayload,
  CodexOptionsResponse,
  GlobalSupplementalItemPayload,
  HealthResponse,
  FileChangePayload,
  ApprovalQuestionPayload,
  ServerMessage,
  ServerRequestPayload,
  SupplementalItemPayload,
  ThreadTurnPayload,
  TimelineEventPayload,
  TokenUsagePayload,
  TurnDiffPayload,
  TurnPlanPayload,
  UploadImageResponse,
  WorkspaceListResponse,
  WorkspaceShortcutsResponse,
} from '@codex-remote/protocol';
import type { ServerRequest as CodexServerRequest, v2 } from '@codex-remote/codex-app-server-types';
import type { ConnectionStatus } from '../transport/ws/createSocketClient.js';
import {
  formatNotificationMessage,
  formatNotificationTitle,
  getNotificationLevel,
  summarizeUnknownObject,
} from '../app/view-helpers.js';
import {
  appendDismissedNotificationKey,
  readDismissedNotificationKeys,
} from '../lib/storage.js';

export type SessionItem = {
  threadId: string;
  name: string;
  cwd?: string;
  status?: string;
  windowStatus?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  model?: string;
  reasoningEffort?: string;
  tokenUsage?: TokenUsagePayload;
  createdAt?: number;
  updatedAt?: number;
};

export type TimelineEntry = {
  id: string;
  type: string;
  role?: string;
  turnId?: string;
  itemId?: string;
  title?: string;
  text?: string;
  status?: string;
  meta?: string[];
  patch?: string;
  changes?: Array<{ path?: string; kind?: string; addedLines?: number; deletedLines?: number; diff?: string }>;
  createdAt?: number;
  partial?: boolean;
  details?: unknown;
};

export type ServerRequestItem = ServerRequestPayload & {
  method?: CodexServerRequest['method'];
  changes?: FileChangePayload[];
  questions?: ApprovalQuestionPayload[];
};

export type ThreadRunState = {
  active: boolean;
  turnId?: string;
  startedAt?: number;
};

export type WorkspaceBrowserState = {
  shortcuts: WorkspaceShortcutsResponse | null;
  listing: WorkspaceListResponse | null;
  selectedPath: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
};

export type AttachmentItem = UploadImageResponse & {
  previewUrl: string;
};

export type FloatingNotice = {
  id: string;
  level: 'warning' | 'error' | 'info';
  title: string;
  message: string;
  threadId?: string;
  createdAt: number;
  dismissKey?: string;
};

type ThreadTurnProjection = ThreadTurnPayload & {
  createdAt?: number;
  updatedAt?: number;
  plan?: TurnPlanPayload['plan'];
  explanation?: string;
  diff?: string;
};

type ThreadItemRecord = Record<string, unknown> & {
  type: string;
  id?: string;
};

type AppStore = {
  health: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: HealthResponse | null;
    error: string | null;
  };
  connection: {
    status: ConnectionStatus;
    error: string | null;
  };
  auth: {
    token: string;
  };
  codexOptions: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: CodexOptionsResponse | null;
    error: string | null;
  };
  sessions: {
    items: SessionItem[];
    activeSessionId: string | null;
  };
  timeline: {
    entriesBySessionId: Record<string, TimelineEntry[]>;
  };
  assistantStreams: {
    bySessionId: Record<string, Record<string, string>>;
  };
  approvals: {
    items: ServerRequestItem[];
  };
  notifications: {
    items: FloatingNotice[];
  };
  turns: {
    activeBySessionId: Record<string, ThreadRunState>;
  };
  tokenUsage: {
    bySessionId: Record<string, TokenUsagePayload>;
  };
  workspace: WorkspaceBrowserState;
  composer: {
    attachmentsBySessionId: Record<string, AttachmentItem[]>;
    prefsBySessionId: Record<string, {
      model: string;
      reasoningEffort: string;
      approvalPolicy: string;
      sandboxMode: string;
    }>;
  };
  setHealthLoading: () => void;
  setHealthReady: (data: HealthResponse) => void;
  setHealthError: (message: string) => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  setToken: (token: string) => void;
  setCodexOptionsLoading: () => void;
  setCodexOptionsReady: (data: CodexOptionsResponse) => void;
  setCodexOptionsError: (message: string) => void;
  setSessions: (items: SessionItem[]) => void;
  upsertSession: (item: SessionItem) => void;
  removeSession: (threadId: string) => void;
  setActiveSession: (threadId: string | null) => void;
  setComposerPrefs: (threadId: string, prefs: {
    model: string;
    reasoningEffort: string;
    approvalPolicy: string;
    sandboxMode: string;
  }) => void;
  replaceServerRequests: (items: ServerRequestPayload[]) => void;
  upsertServerRequest: (request: ServerRequestPayload) => void;
  removeServerRequest: (requestId: string) => void;
  resetServerRequests: () => void;
  pushNotification: (notice: FloatingNotice) => void;
  dismissNotification: (noticeId: string) => void;
  setTurnStarted: (threadId: string, turnId?: string, startedAt?: number) => void;
  setTurnCompleted: (threadId: string, turnId?: string) => void;
  settleAssistantActivity: (threadId: string, turnId?: string) => void;
  setTokenUsage: (threadId: string, usage: TokenUsagePayload) => void;
  setSessionModel: (threadId: string, model: string) => void;
  setThreadSync: (threadId: string, message: Extract<ServerMessage, { type: 'thread_sync' }>) => void;
  appendTimelineEntry: (threadId: string, entry: TimelineEntry) => void;
  removeTimelineEntry: (threadId: string, entryId: string) => void;
  appendAssistantDelta: (
    threadId: string,
    itemId: string,
    delta: string,
    options?: { turnId?: string; createdAt?: number },
  ) => void;
  upsertTimelineEntry: (threadId: string, entry: TimelineEntry) => void;
  setWorkspaceLoading: (selectedPath: string) => void;
  setWorkspaceReady: (shortcuts: WorkspaceShortcutsResponse, listing: WorkspaceListResponse) => void;
  setWorkspaceError: (message: string) => void;
  setWorkspaceListing: (listing: WorkspaceListResponse) => void;
  addAttachment: (threadId: string, attachment: AttachmentItem) => void;
  removeAttachment: (threadId: string, attachmentId: string) => void;
  clearAttachments: (threadId: string) => void;
  promotePendingUserEntries: (threadId: string, turnId?: string, startedAt?: number) => void;
};

function normalizeTab(tab: SessionTabPayload): SessionItem {
  const readOptionalString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = (tab as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    return undefined;
  };
  const legacySource = tab as Record<string, unknown>;
  const candidates = [tab.name, legacySource.threadName, legacySource.thread_name, legacySource.preview];
  const resolvedName = candidates.find((value) => typeof value === 'string' && value.trim());
  return {
    threadId: String(tab.threadId || legacySource.thread_id || legacySource.id || ''),
    name: String(resolvedName || '').trim() || '未命名会话',
    cwd: typeof tab.cwd === 'string' ? tab.cwd : '',
    status: typeof tab.status === 'string' ? tab.status : '',
    windowStatus: typeof tab.windowStatus === 'string' ? tab.windowStatus : typeof legacySource.window_status === 'string' ? legacySource.window_status : '',
    approvalPolicy: readOptionalString('approvalPolicy', 'approval_policy'),
    sandboxMode: readOptionalString('sandboxMode', 'sandbox_mode'),
    model: readOptionalString('model'),
    reasoningEffort: readOptionalString('reasoningEffort', 'reasoning_effort'),
    tokenUsage: normalizeTokenUsage(tab),
    createdAt: typeof tab.createdAt === 'number' ? tab.createdAt : typeof legacySource.created_at === 'number' ? legacySource.created_at : 0,
    updatedAt: typeof tab.updatedAt === 'number' ? tab.updatedAt : typeof legacySource.updated_at === 'number' ? legacySource.updated_at : 0,
  };
}

function buildComposerPrefsFromSession(session: SessionItem): {
  model: string;
  reasoningEffort: string;
  approvalPolicy: string;
  sandboxMode: string;
} {
  return {
    model: typeof session.model === 'string' ? session.model : '',
    reasoningEffort: typeof session.reasoningEffort === 'string' ? session.reasoningEffort : '',
    approvalPolicy: typeof session.approvalPolicy === 'string' ? session.approvalPolicy : '',
    sandboxMode: typeof session.sandboxMode === 'string' ? session.sandboxMode : '',
  };
}

function mergeComposerPrefsFromSessions(
  current: Record<string, {
    model: string;
    reasoningEffort: string;
    approvalPolicy: string;
    sandboxMode: string;
  }>,
  sessions: SessionItem[],
): Record<string, {
  model: string;
  reasoningEffort: string;
  approvalPolicy: string;
  sandboxMode: string;
}> {
  const next = { ...current };
  for (const session of sessions) {
    if (!session.threadId) {
      continue;
    }
    const existing = next[session.threadId];
    next[session.threadId] = {
      model: typeof session.model === 'string' ? session.model : existing?.model || '',
      reasoningEffort: typeof session.reasoningEffort === 'string' ? session.reasoningEffort : existing?.reasoningEffort || '',
      approvalPolicy: typeof session.approvalPolicy === 'string' ? session.approvalPolicy : existing?.approvalPolicy || '',
      sandboxMode: typeof session.sandboxMode === 'string' ? session.sandboxMode : existing?.sandboxMode || '',
    };
  }
  return next;
}

function mergeSessionItem(current: SessionItem | undefined, incoming: SessionItem): SessionItem {
  const merged = {
    ...(current || {}),
    ...incoming,
  };
  if (incoming.model === undefined) {
    merged.model = current?.model;
  }
  if (incoming.reasoningEffort === undefined) {
    merged.reasoningEffort = current?.reasoningEffort;
  }
  if (incoming.approvalPolicy === undefined) {
    merged.approvalPolicy = current?.approvalPolicy;
  }
  if (incoming.sandboxMode === undefined) {
    merged.sandboxMode = current?.sandboxMode;
  }
  return merged;
}

function extractTokenUsageValue(value: unknown): TokenUsagePayload {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const looksLikeUsageObject = [
    source.totalTokens,
    source.total_tokens,
    source.total,
    source.inputTokens,
    source.input_tokens,
    source.promptTokens,
    source.prompt_tokens,
    source.outputTokens,
    source.output_tokens,
    source.completionTokens,
    source.completion_tokens,
  ].some((entry) => typeof entry === 'number');
  if (looksLikeUsageObject) {
    return source as TokenUsagePayload;
  }
  const nestedTotal = source.total && typeof source.total === 'object'
    ? source.total as Record<string, unknown>
    : null;
  const nestedLast = source.last && typeof source.last === 'object'
    ? source.last as Record<string, unknown>
    : null;
  const looksLikeCodexUsageEnvelope = [
    nestedTotal?.totalTokens,
    nestedTotal?.total_tokens,
    nestedTotal?.inputTokens,
    nestedTotal?.input_tokens,
    nestedTotal?.outputTokens,
    nestedTotal?.output_tokens,
    nestedLast?.totalTokens,
    nestedLast?.total_tokens,
    nestedLast?.inputTokens,
    nestedLast?.input_tokens,
    nestedLast?.outputTokens,
    nestedLast?.output_tokens,
  ].some((entry) => typeof entry === 'number');
  if (looksLikeCodexUsageEnvelope) {
    return source as TokenUsagePayload;
  }
  const direct = source.tokenUsage
    ?? source.token_usage
    ?? source.usage
    ?? source.tokenStats
    ?? source.token_stats
    ?? null;
  if (direct !== null && direct !== undefined) {
    return direct as TokenUsagePayload;
  }
  const nested = source.usage && typeof source.usage === 'object'
    ? source.usage as Record<string, unknown>
    : null;
  return (nested?.tokenUsage
    ?? nested?.token_usage
    ?? nested?.usage
    ?? nested?.tokenStats
    ?? nested?.token_stats
    ?? null) as TokenUsagePayload;
}

function normalizeTokenUsage(value: unknown): TokenUsagePayload {
  const extracted = extractTokenUsageValue(value);
  if (!extracted || typeof extracted !== 'object') {
    return extracted as TokenUsagePayload;
  }
  const usage = extracted as Record<string, unknown>;
  const nested = usage.usage && typeof usage.usage === 'object' ? usage.usage as Record<string, unknown> : null;
  const total = usage.total && typeof usage.total === 'object' ? usage.total as Record<string, unknown> : null;
  const last = usage.last && typeof usage.last === 'object' ? usage.last as Record<string, unknown> : null;
  return {
    ...usage,
    totalTokens: typeof usage.totalTokens === 'number'
      ? usage.totalTokens
      : typeof usage.total_tokens === 'number'
        ? usage.total_tokens
        : typeof usage.total === 'number'
          ? usage.total
          : typeof nested?.totalTokens === 'number'
            ? nested.totalTokens
            : typeof nested?.total_tokens === 'number'
              ? nested.total_tokens
              : typeof total?.totalTokens === 'number'
                ? total.totalTokens
                : typeof total?.total_tokens === 'number'
                  ? total.total_tokens
                  : typeof last?.totalTokens === 'number'
                    ? last.totalTokens
                    : typeof last?.total_tokens === 'number'
                      ? last.total_tokens
              : undefined,
    inputTokens: typeof usage.inputTokens === 'number'
      ? usage.inputTokens
      : typeof usage.input_tokens === 'number'
        ? usage.input_tokens
        : typeof usage.promptTokens === 'number'
          ? usage.promptTokens
          : typeof usage.prompt_tokens === 'number'
            ? usage.prompt_tokens
            : typeof nested?.inputTokens === 'number'
              ? nested.inputTokens
            : typeof nested?.input_tokens === 'number'
                ? nested.input_tokens
                : typeof nested?.promptTokens === 'number'
                  ? nested.promptTokens
                  : typeof nested?.prompt_tokens === 'number'
                    ? nested.prompt_tokens
                    : typeof total?.inputTokens === 'number'
                      ? total.inputTokens
                      : typeof total?.input_tokens === 'number'
                        ? total.input_tokens
                        : typeof total?.promptTokens === 'number'
                          ? total.promptTokens
                          : typeof total?.prompt_tokens === 'number'
                            ? total.prompt_tokens
                            : typeof last?.inputTokens === 'number'
                              ? last.inputTokens
                              : typeof last?.input_tokens === 'number'
                                ? last.input_tokens
                                : typeof last?.promptTokens === 'number'
                                  ? last.promptTokens
                                  : typeof last?.prompt_tokens === 'number'
                                    ? last.prompt_tokens
                    : undefined,
    outputTokens: typeof usage.outputTokens === 'number'
      ? usage.outputTokens
      : typeof usage.output_tokens === 'number'
        ? usage.output_tokens
        : typeof usage.completionTokens === 'number'
          ? usage.completionTokens
          : typeof usage.completion_tokens === 'number'
            ? usage.completion_tokens
            : typeof nested?.outputTokens === 'number'
              ? nested.outputTokens
              : typeof nested?.output_tokens === 'number'
                ? nested.output_tokens
                : typeof nested?.completionTokens === 'number'
                  ? nested.completionTokens
                  : typeof nested?.completion_tokens === 'number'
                    ? nested.completion_tokens
                    : typeof total?.outputTokens === 'number'
                      ? total.outputTokens
                      : typeof total?.output_tokens === 'number'
                        ? total.output_tokens
                        : typeof total?.completionTokens === 'number'
                          ? total.completionTokens
                          : typeof total?.completion_tokens === 'number'
                            ? total.completion_tokens
                            : typeof last?.outputTokens === 'number'
                              ? last.outputTokens
                              : typeof last?.output_tokens === 'number'
                                ? last.output_tokens
                                : typeof last?.completionTokens === 'number'
                                  ? last.completionTokens
                                  : typeof last?.completion_tokens === 'number'
                                    ? last.completion_tokens
                    : undefined,
  } as TokenUsagePayload;
}

function mergeTokenUsageFromSessions(
  existing: Record<string, TokenUsagePayload>,
  sessions: SessionItem[],
): Record<string, TokenUsagePayload> {
  const next = { ...existing };
  for (const session of sessions) {
    if (!session.threadId) {
      continue;
    }
    if (session.tokenUsage !== undefined && session.tokenUsage !== null) {
      next[session.threadId] = normalizeTokenUsage(session.tokenUsage);
    }
  }
  return next;
}

function extractStructuredText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractStructuredText(entry))
      .filter(Boolean)
      .join('\n');
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const source = value as Record<string, unknown>;
  const directCandidates = [
    source.text,
    source.outputText,
    source.output_text,
    source.inputText,
    source.input_text,
    source.value,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const nestedCandidates = [
    source.content,
    source.parts,
    source.output,
    source.input,
    source.message,
  ];
  for (const candidate of nestedCandidates) {
    const text = extractStructuredText(candidate);
    if (text) {
      return text;
    }
  }

  return '';
}

function toThreadItemRecord(item: unknown): ThreadItemRecord | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, unknown>;
  return typeof record.type === 'string' ? record as ThreadItemRecord : null;
}

function extractReasoningSummaryText(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return typeof record.text === 'string' ? record.text : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeFileChangePayloads(value: unknown): FileChangePayload[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const changes = value
    .map((change) => {
      const record = change && typeof change === 'object' ? change as Record<string, unknown> : null;
      if (!record) {
        return null;
      }
      return {
        path: typeof record.path === 'string' ? record.path : '',
        kind: typeof record.kind === 'string' ? record.kind : '',
        addedLines: typeof record.addedLines === 'number' ? record.addedLines : undefined,
        deletedLines: typeof record.deletedLines === 'number' ? record.deletedLines : undefined,
        diff: typeof record.diff === 'string' ? record.diff : undefined,
      };
    })
    .filter((change): change is NonNullable<typeof change> => Boolean(change));
  return changes.length ? changes : undefined;
}

function buildTurnPlanMeta(plan: TurnPlanPayload['plan'] | Array<{ step?: string; status?: string }>): string[] {
  return plan
    .map((step) => [step?.status, step?.step].filter(Boolean).join(': '))
    .filter(Boolean);
}

function extractTurnUserText(turn: ThreadTurnProjection): string {
  if (typeof turn?.text === 'string' && turn.text.trim()) {
    return turn.text;
  }

  const items = Array.isArray(turn?.items) ? turn.items : [];
  const itemTextParts = items.flatMap((item) => {
    const itemRecord = toThreadItemRecord(item);
    const itemType = itemRecord?.type || '';
    const itemRole = typeof itemRecord?.role === 'string' ? itemRecord.role : '';
    if (itemType !== 'userMessage' && !(itemType === 'message' && itemRole === 'user')) {
      return [];
    }
    return [
      itemRecord?.text,
      itemType === 'userMessage' ? (item as v2.ThreadItem & { content?: unknown }).content : itemRecord?.content,
      itemRecord?.input,
      itemRecord?.message,
      itemRecord?.parts,
    ]
      .map((part) => extractStructuredText(part))
      .filter(Boolean);
  });
  if (itemTextParts.length) {
    return itemTextParts.join('\n');
  }

  const inputItems = Array.isArray(turn?.input) ? turn.input : [];
  const textParts = inputItems
    .map((part) => extractStructuredText(part))
    .filter(Boolean);
  if (textParts.length) {
    return textParts.join('\n');
  }

  if (typeof turn?.summary === 'string' && turn.summary.trim()) {
    return turn.summary;
  }

  return '';
}

function extractTurnAssistantText(turn: ThreadTurnProjection): string {
  if (typeof turn?.output === 'string' && turn.output.trim()) {
    return turn.output.trim();
  }

  const outputText = extractStructuredText(turn?.output);
  if (outputText) {
    return outputText;
  }

  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (const item of items) {
    const itemRecord = toThreadItemRecord(item);
    const itemType = itemRecord?.type || '';
    const itemRole = typeof itemRecord?.role === 'string' ? itemRecord.role : '';
    if (itemType !== 'agentMessage' && !(itemType === 'message' && itemRole === 'assistant')) {
      continue;
    }
    const text = extractStructuredText(itemRecord?.text)
      || extractStructuredText(itemRecord?.content)
      || extractStructuredText(itemRecord?.output);
    if (text) {
      return text;
    }
  }

  return '';
}

function normalizeServerRequest(request: ServerRequestPayload): ServerRequestItem | null {
  const requestId = typeof request.requestId === 'string' ? request.requestId : '';
  if (!requestId) {
    return null;
  }

  return {
    requestId,
    method: typeof request.method === 'string' ? request.method as CodexServerRequest['method'] : undefined,
    threadId: typeof request.threadId === 'string' ? request.threadId : undefined,
    turnId: typeof request.turnId === 'string' ? request.turnId : undefined,
    itemId: typeof request.itemId === 'string' ? request.itemId : undefined,
    kind: typeof request.kind === 'string' ? request.kind : undefined,
    status: request.status === 'submitting' ? 'submitting' : 'pending',
    reason: typeof request.reason === 'string' ? request.reason : undefined,
    message: typeof request.message === 'string' ? request.message : undefined,
    command: typeof request.command === 'string' ? request.command : undefined,
    cwd: typeof request.cwd === 'string' ? request.cwd : undefined,
    tool: typeof request.tool === 'string' ? request.tool : undefined,
    namespace: typeof request.namespace === 'string' ? request.namespace : undefined,
    serverName: typeof request.serverName === 'string' ? request.serverName : undefined,
    patch: typeof request.patch === 'string' ? request.patch : undefined,
    changes: Array.isArray(request.changes)
      ? request.changes.map((change) => ({
        path: typeof change?.path === 'string' ? change.path : undefined,
        kind: typeof change?.kind === 'string' ? change.kind : undefined,
        addedLines: typeof change?.addedLines === 'number' ? change.addedLines : undefined,
        deletedLines: typeof change?.deletedLines === 'number' ? change.deletedLines : undefined,
        diff: typeof change?.diff === 'string' ? change.diff : undefined,
      }))
      : undefined,
    questions: Array.isArray(request.questions) ? request.questions : undefined,
    permissions: request.permissions ?? undefined,
    availableDecisions: Array.isArray(request.availableDecisions) ? request.availableDecisions : undefined,
    createdAt: normalizeTimestamp(request.createdAt),
    responseSchema: request.responseSchema ?? undefined,
    requestedSchema: request.requestedSchema ?? undefined,
    arguments: request.arguments && typeof request.arguments === 'object' ? request.arguments : undefined,
    mode: typeof request.mode === 'string' ? request.mode : undefined,
    url: typeof request.url === 'string' ? request.url : undefined,
    elicitationId: typeof request.elicitationId === 'string' ? request.elicitationId : undefined,
    meta: request.meta ?? undefined,
    raw: request.raw && typeof request.raw === 'object'
      ? request.raw
      : request,
  };
}

function compactText(value: unknown, max = 280): string {
  const text = typeof value === 'string' ? value : extractStructuredText(value);
  const normalized = text.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function formatMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    'thread/closed': '会话已关闭',
    'thread/archived': '会话已归档',
    'thread/unarchived': '会话已取消归档',
    'thread/compacted': '上下文压缩',
    'thread/goal/updated': '目标已更新',
    'thread/goal/cleared': '目标已清除',
    'thread/realtime/started': '实时会话已开始',
    'thread/realtime/itemAdded': '实时项目',
    'thread/realtime/transcript/delta': '实时转写',
    'thread/realtime/transcript/done': '实时转写完成',
    'thread/realtime/outputAudio/delta': '实时音频',
    'thread/realtime/sdp': '实时 SDP',
    'thread/realtime/error': '实时会话错误',
    'thread/realtime/closed': '实时会话已关闭',
    'process/outputDelta': '进程输出',
    'process/exited': '进程结束',
    'command/exec/outputDelta': '命令输出',
    'rawResponseItem/completed': '原始响应项',
    'model/verification': '模型校验',
  };
  return labels[method] || method || '事件';
}

function decodeBase64Text(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  try {
    if (typeof globalThis.atob === 'function') {
      const binary = globalThis.atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {
    return value;
  }
  return value;
}

function extractEventText(method: string, params: Record<string, unknown>, fallback = ''): string {
  if (method === 'process/outputDelta' || method === 'command/exec/outputDelta') {
    return decodeBase64Text(params.deltaBase64) || compactText(params.delta);
  }
  if (method === 'thread/realtime/transcript/delta' || method === 'thread/realtime/transcript/done') {
    return compactText(params.delta) || compactText(params.text) || compactText(params.transcript);
  }
  if (method === 'rawResponseItem/completed') {
    return compactText(params.item);
  }
  return compactText(params.message)
    || compactText(params.error)
    || compactText(params.reason)
    || compactText(params.goal)
    || compactText(params.item)
    || fallback;
}

function shouldDisplayThreadEvent(method: string): boolean {
  return method !== 'thread/goal/cleared';
}

function summarizeFileChangeText(
  status: string | undefined,
  changes: Array<{ path?: string; kind?: string }> | undefined,
  patch: string | undefined,
  output: string,
): string {
  const outputText = compactText(output);
  if (outputText) {
    return outputText;
  }

  const validChanges = Array.isArray(changes) ? changes.filter((change) => change.path || change.kind) : [];
  if (validChanges.length) {
    const preview = validChanges
      .slice(0, 3)
      .map((change) => {
        const resolvedPath = typeof change.path === 'string' ? change.path : '';
        const normalizedPath = resolvedPath.replace(/[\\/]+$/, '');
        const parts = normalizedPath.split(/[/\\]+/).filter(Boolean);
        const name = parts[parts.length - 1] || resolvedPath;
        return [change.kind, name].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join(' · ');
    const suffix = validChanges.length > 3 ? ` 等 ${validChanges.length} 项` : '';
    return preview ? `${preview}${suffix}` : `已记录 ${validChanges.length} 项文件变更`;
  }

  if (typeof patch === 'string' && patch.trim()) {
    return '已生成变更补丁';
  }

  return '等待文件变更内容';
}

function normalizeTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value < 1e12 ? Math.trunc(value * 1000) : Math.trunc(value);
}

function normalizeTimelineEntry(entry: TimelineEntry): TimelineEntry {
  return {
    ...entry,
    changes: Array.isArray(entry.changes)
      ? entry.changes.map((change) => ({
        ...change,
        addedLines: typeof change?.addedLines === 'number' ? change.addedLines : undefined,
        deletedLines: typeof change?.deletedLines === 'number' ? change.deletedLines : undefined,
        diff: typeof change?.diff === 'string' ? change.diff : undefined,
      }))
      : entry.changes,
    createdAt: normalizeTimestamp(entry.createdAt),
    partial: Boolean(entry.partial),
  };
}

function isEqualUnknown(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!isEqualUnknown(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false;
    }
    if (!isEqualUnknown(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    )) {
      return false;
    }
  }
  return true;
}

function areTimelineEntriesEqual(left: TimelineEntry, right: TimelineEntry): boolean {
  return left.id === right.id
    && left.type === right.type
    && left.role === right.role
    && left.turnId === right.turnId
    && left.itemId === right.itemId
    && left.title === right.title
    && left.text === right.text
    && left.status === right.status
    && left.patch === right.patch
    && left.createdAt === right.createdAt
    && left.partial === right.partial
    && isEqualUnknown(left.meta, right.meta)
    && isEqualUnknown(left.changes, right.changes)
    && isEqualUnknown(left.details, right.details);
}

function areTimelineEntryListsEqual(left: TimelineEntry[], right: TimelineEntry[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areTimelineEntriesEqual(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function areComposerPrefsEqual(
  left: { model: string; reasoningEffort: string; approvalPolicy: string; sandboxMode: string } | undefined,
  right: { model: string; reasoningEffort: string; approvalPolicy: string; sandboxMode: string } | undefined,
): boolean {
  return (left?.model || '') === (right?.model || '')
    && (left?.reasoningEffort || '') === (right?.reasoningEffort || '')
    && (left?.approvalPolicy || '') === (right?.approvalPolicy || '')
    && (left?.sandboxMode || '') === (right?.sandboxMode || '');
}

function areSessionsEqual(left: SessionItem, right: SessionItem): boolean {
  return left.threadId === right.threadId
    && left.name === right.name
    && left.cwd === right.cwd
    && left.status === right.status
    && left.windowStatus === right.windowStatus
    && left.approvalPolicy === right.approvalPolicy
    && left.sandboxMode === right.sandboxMode
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && isEqualUnknown(left.tokenUsage, right.tokenUsage);
}

function areSessionListsEqual(left: SessionItem[], right: SessionItem[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areSessionsEqual(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function areServerRequestsEqual(left: ServerRequestItem, right: ServerRequestItem): boolean {
  return left.requestId === right.requestId
    && left.method === right.method
    && left.threadId === right.threadId
    && left.turnId === right.turnId
    && left.itemId === right.itemId
    && left.kind === right.kind
    && left.status === right.status
    && left.reason === right.reason
    && left.message === right.message
    && left.command === right.command
    && left.cwd === right.cwd
    && left.tool === right.tool
    && left.namespace === right.namespace
    && left.serverName === right.serverName
    && left.patch === right.patch
    && left.createdAt === right.createdAt
    && left.mode === right.mode
    && left.url === right.url
    && left.elicitationId === right.elicitationId
    && isEqualUnknown(left.changes, right.changes)
    && isEqualUnknown(left.questions, right.questions)
    && isEqualUnknown(left.permissions, right.permissions)
    && isEqualUnknown(left.availableDecisions, right.availableDecisions)
    && isEqualUnknown(left.responseSchema, right.responseSchema)
    && isEqualUnknown(left.requestedSchema, right.requestedSchema)
    && isEqualUnknown(left.arguments, right.arguments)
    && isEqualUnknown(left.meta, right.meta)
    && isEqualUnknown(left.raw, right.raw);
}

function areServerRequestListsEqual(left: ServerRequestItem[], right: ServerRequestItem[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areServerRequestsEqual(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function mergeTimelineEntry(current: TimelineEntry, incoming: TimelineEntry): TimelineEntry {
  const normalized = normalizeTimelineEntry(incoming);
  const merged = {
    ...current,
    ...normalized,
    meta: normalized.meta ?? current.meta,
    changes: normalized.changes ?? current.changes,
    patch: normalized.patch ?? current.patch,
    details: normalized.details ?? current.details,
    text: normalized.text ?? current.text,
    createdAt: Math.min(current.createdAt || normalized.createdAt || 0, normalized.createdAt || current.createdAt || 0),
  };
  return areTimelineEntriesEqual(current, merged) ? current : merged;
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  const leftTime = typeof left.createdAt === 'number' ? left.createdAt : 0;
  const rightTime = typeof right.createdAt === 'number' ? right.createdAt : 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function mergeTimelineEntryLists(existing: TimelineEntry[], incoming: TimelineEntry[]): TimelineEntry[] {
  const merged = new Map<string, TimelineEntry>();
  for (const entry of existing) {
    merged.set(entry.id, entry);
  }
  for (const entry of incoming) {
    const normalized = normalizeTimelineEntry(entry);
    const current = merged.get(normalized.id);
    if (!current) {
      merged.set(normalized.id, normalized);
      continue;
    }
    merged.set(normalized.id, mergeTimelineEntry(current, normalized));
  }
  const nextEntries = Array.from(merged.values()).sort(compareTimelineEntries);
  return areTimelineEntryListsEqual(existing, nextEntries) ? existing : nextEntries;
}

function dedupeOptimisticUserEntries(entries: TimelineEntry[]): TimelineEntry[] {
  function getUserEntryStability(entry: TimelineEntry): number {
    if (entry.id.startsWith('local-user:')) {
      return 0;
    }
    if (entry.id.startsWith('pending-user:')) {
      return 1;
    }
    return 2;
  }

  function isSameLogicalUserEntry(left: TimelineEntry, right: TimelineEntry): boolean {
    const leftText = typeof left.text === 'string' ? left.text.trim() : '';
    const rightText = typeof right.text === 'string' ? right.text.trim() : '';
    if (!leftText || leftText !== rightText) {
      return false;
    }
    if (left.turnId && right.turnId && left.turnId === right.turnId) {
      return true;
    }
    if (left.turnId?.endsWith(':pending-turn') || right.turnId?.endsWith(':pending-turn')) {
      return true;
    }
    if (typeof left.createdAt === 'number' && typeof right.createdAt === 'number') {
      return Math.abs(left.createdAt - right.createdAt) <= 5 * 60 * 1000;
    }
    return false;
  }

  return entries.filter((entry) => {
    const entryText = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (entry.role !== 'user' || !entryText) {
      return true;
    }

    const stability = getUserEntryStability(entry);
    if (stability >= 2) {
      return true;
    }

    return !entries.some((candidate) => (
      candidate.id !== entry.id
      && candidate.role === 'user'
      && isSameLogicalUserEntry(candidate, entry)
      && getUserEntryStability(candidate) > stability
    ));
  });
}

function dedupeSyntheticAssistantFallbackEntries(entries: TimelineEntry[]): TimelineEntry[] {
  const assistantCountByTurnId = new Map<string, number>();
  for (const entry of entries) {
    if (entry.role !== 'assistant' || !entry.turnId) {
      continue;
    }
    assistantCountByTurnId.set(entry.turnId, (assistantCountByTurnId.get(entry.turnId) || 0) + 1);
  }

  let changed = false;
  const nextEntries = entries.filter((entry) => {
    if (entry.role !== 'assistant' || !entry.turnId) {
      return true;
    }
    const assistantCount = assistantCountByTurnId.get(entry.turnId) || 0;
    if (assistantCount <= 1) {
      return true;
    }
    const syntheticFallbackId = `${entry.turnId}-assistant`;
    if (entry.id !== syntheticFallbackId) {
      return true;
    }
    changed = true;
    return false;
  });

  return changed ? nextEntries : entries;
}

function extractPatchText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() ? value : undefined;
  }

  const structured = extractStructuredText(value);
  if (structured.trim()) {
    return structured;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const nestedCandidates = [
    source.patch,
    source.diff,
    source.output,
    source.outputText,
    source.output_text,
    source.aggregatedOutput,
    source.content,
    source.result,
    source.data,
  ];
  for (const candidate of nestedCandidates) {
    const text = extractPatchText(candidate);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function mergeTurnDiffIntoFileChangeEntry(
  entries: TimelineEntry[],
  threadId: string,
  turnId: string | undefined,
  diff: string,
): TimelineEntry[] {
  if (!turnId || !diff.trim()) {
    return entries;
  }

  const nextEntries = entries.filter((entry) => !(entry.turnId === turnId && entry.type === 'turn_diff'));
  const fileChangeEntry = nextEntries.find((entry) => entry.turnId === turnId && entry.type === 'file_change');
  if (!fileChangeEntry) {
    return mergeTimelineEntryLists(nextEntries, [buildSystemTimelineEntry(threadId, 'turn_diff', {
      id: `turn-diff:${turnId || 'turn'}`,
      turnId,
      title: '轮次 Diff',
      text: '已更新的差异快照',
      patch: diff,
      status: 'completed',
    })]);
  }

  return mergeTimelineEntryLists(nextEntries, [{
    ...fileChangeEntry,
    patch: diff,
    details: fileChangeEntry.details && typeof fileChangeEntry.details === 'object'
      ? {
        ...(fileChangeEntry.details as Record<string, unknown>),
        patch: diff,
      }
      : fileChangeEntry.details,
  }]);
}

function isAssistantActivityEntry(entry: TimelineEntry): boolean {
  return entry.role === 'assistant'
    && (entry.type === 'reasoning' || entry.type === 'plan' || entry.type === 'message');
}

function promotePendingUserEntriesForTurn(
  entries: TimelineEntry[],
  threadId: string,
  turnId?: string,
  startedAt?: number,
): TimelineEntry[] {
  const resolvedTurnId = turnId || `${threadId}:pending-turn`;
  const resolvedStartedAt = normalizeTimestamp(startedAt);
  let nextEntries: TimelineEntry[] | null = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.role !== 'user' || entry.turnId !== `${threadId}:pending-turn`) {
      continue;
    }
    if (!nextEntries) {
      nextEntries = [...entries];
    }
    nextEntries[index] = {
      ...entry,
      turnId: resolvedTurnId,
      createdAt: entry.createdAt || resolvedStartedAt,
    };
  }

  return nextEntries
    ? nextEntries.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0))
    : entries;
}

function extractReasoningDelta(message: Extract<ServerMessage, { type: 'item_delta' }>): string {
  if (typeof message.delta === 'string' && message.delta) {
    return message.delta;
  }

  if (!message.part || typeof message.part !== 'object') {
    return '';
  }

  const part = message.part as Record<string, unknown>;
  if (typeof part.text === 'string') {
    return part.text;
  }
  if (typeof part.summary === 'string') {
    return part.summary;
  }
  return '';
}

function createTimelineEntryFromItemEvent(
  kind: string,
  threadId: string,
  item: v2.ThreadItem | ThreadItemRecord | undefined,
  turnId?: string,
  fallbackStartedAt?: number,
): TimelineEntry | null {
  const itemRecord = toThreadItemRecord(item);
  if (!itemRecord) {
    return null;
  }

  const itemType = itemRecord.type;
  const itemId = typeof itemRecord.id === 'string'
    ? itemRecord.id
    : `${threadId}:${turnId || 'turn'}:${kind}:${itemType || 'item'}`;
  const startedAt = normalizeTimestamp(
    typeof itemRecord.startedAt === 'number'
      ? itemRecord.startedAt
      : typeof itemRecord.createdAt === 'number'
        ? itemRecord.createdAt
        : fallbackStartedAt,
  );
  const itemRole = typeof itemRecord.role === 'string' ? itemRecord.role : '';

  if (itemType === 'userMessage' || (itemType === 'message' && itemRole === 'user')) {
    const text = extractStructuredText(itemRecord.text)
      || extractStructuredText(itemType === 'userMessage' ? (item as v2.ThreadItem & { content?: unknown }).content : itemRecord.content)
      || extractStructuredText(itemRecord.input)
      || extractStructuredText(itemRecord.message)
      || extractStructuredText(itemRecord.parts);
    if (!text) {
      return null;
    }
    return {
      id: itemId,
      type: 'message',
      role: 'user',
      turnId,
      itemId,
      text,
      status: typeof itemRecord.status === 'string' ? itemRecord.status : 'completed',
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'agentMessage' || (itemType === 'message' && itemRole === 'assistant')) {
    const text = extractStructuredText(itemRecord.text)
      || extractStructuredText(itemRecord.content)
      || extractStructuredText(itemRecord.output)
      || extractStructuredText(itemRecord.message)
      || extractStructuredText(itemRecord.parts);
    if (!text) {
      return null;
    }
    return {
      id: itemId,
      type: 'message',
      role: 'assistant',
      turnId,
      itemId,
      text,
      status: typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed'),
      createdAt: startedAt,
      partial: kind === 'item_started',
      details: itemRecord,
    };
  }

  if (itemType === 'reasoning') {
    const summaryText = extractReasoningSummaryText(itemRecord.summary);
    return {
      id: itemId,
      type: 'reasoning',
      role: 'assistant',
      turnId,
      itemId,
      title: '推理',
      text: compactText(itemRecord.text) || compactText(summaryText) || '思考中…',
      status: kind === 'item_started' ? 'running' : 'completed',
      meta: [kind === 'item_started' ? '流式输出中' : '已记录', new Date(startedAt).toLocaleTimeString()],
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'plan') {
    return {
      id: itemId,
      type: 'plan',
      role: 'assistant',
      turnId,
      itemId,
      title: '计划草稿',
      text: compactText(itemRecord.text) || '正在规划…',
      status: kind === 'item_started' ? 'running' : 'completed',
      meta: [new Date(startedAt).toLocaleTimeString()],
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'commandExecution') {
    const command = typeof itemRecord.command === 'string'
      ? itemRecord.command
      : typeof itemRecord.input === 'string'
        ? itemRecord.input
        : '';
    const output = typeof itemRecord.output === 'string'
      ? itemRecord.output
      : typeof itemRecord.aggregatedOutput === 'string'
        ? itemRecord.aggregatedOutput
        : '';
    return {
      id: itemId,
      type: 'command',
      role: 'system',
      turnId,
      itemId,
      title: '命令',
      text: compactText(command) || '执行命令',
      status: typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: [
        typeof itemRecord.cwd === 'string' && itemRecord.cwd ? itemRecord.cwd : '',
        output ? `输出 ${output.length} 字符` : '',
      ].filter(Boolean),
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'fileChange') {
    const status = typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed');
    const changes = normalizeFileChangePayloads(itemRecord.changes);
    const patch = extractPatchText(itemRecord.patch)
      ?? extractPatchText(itemRecord.diff)
      ?? extractPatchText(itemRecord.output)
      ?? extractPatchText(itemRecord.aggregatedOutput);
    const output = typeof itemRecord.output === 'string'
      ? itemRecord.output
      : typeof itemRecord.aggregatedOutput === 'string'
        ? itemRecord.aggregatedOutput
        : patch || '';
    return {
      id: itemId,
      type: 'file_change',
      role: 'system',
      turnId,
      itemId,
      title: '文件变更',
      text: summarizeFileChangeText(status, changes, patch, output),
      status,
      patch,
      changes,
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'contextCompaction') {
    const summary = [
      compactText(itemRecord.summary),
      compactText(itemRecord.text),
      summarizeUnknownObject(itemRecord, 4),
    ].filter(Boolean)[0] || '上下文已压缩';
    return {
      id: itemId,
      type: 'context_compaction',
      role: 'system',
      turnId,
      itemId,
      title: '上下文压缩',
      text: summary,
      status: typeof itemRecord.status === 'string' ? itemRecord.status : 'completed',
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'hookPrompt') {
    const fragments = Array.isArray(itemRecord.fragments) ? itemRecord.fragments : [];
    return {
      id: itemId,
      type: 'hook',
      role: 'system',
      turnId,
      itemId,
      title: 'Hook 提示',
      text: compactText(fragments) || 'Hook 提示',
      status: kind === 'item_started' ? 'running' : 'completed',
      meta: [`片段 ${fragments.length}`],
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'mcpToolCall') {
    return {
      id: itemId,
      type: 'mcp_tool',
      role: 'system',
      turnId,
      itemId,
      title: 'MCP 工具',
      text: [itemRecord.server, itemRecord.tool].filter((value) => typeof value === 'string' && value).join('.'),
      status: typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: Array.isArray(itemRecord.progressMessages) ? itemRecord.progressMessages.filter((value): value is string => typeof value === 'string') : [],
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'dynamicToolCall') {
    return {
      id: itemId,
      type: 'dynamic_tool',
      role: 'system',
      turnId,
      itemId,
      title: '动态工具',
      text: [itemRecord.namespace, itemRecord.tool].filter((value) => typeof value === 'string' && value).join('.'),
      status: typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed'),
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'collabAgentToolCall') {
    const receivers = Array.isArray(itemRecord.receiverThreadIds)
      ? itemRecord.receiverThreadIds.filter((value): value is string => typeof value === 'string')
      : [];
    return {
      id: itemId,
      type: 'collab_tool',
      role: 'system',
      turnId,
      itemId,
      title: '协作代理',
      text: [
        typeof itemRecord.tool === 'string' ? itemRecord.tool : '',
        compactText(itemRecord.prompt, 160),
      ].filter(Boolean).join(' · ') || '协作代理调用',
      status: typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: receivers.length ? [`目标 ${receivers.length} 个线程`] : [],
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'webSearch') {
    const action = itemRecord.action && typeof itemRecord.action === 'object' ? itemRecord.action as Record<string, unknown> : undefined;
    const actionType = typeof action?.type === 'string' ? action.type : '';
    const query = typeof itemRecord.query === 'string'
      ? itemRecord.query
      : typeof action?.query === 'string'
        ? action.query
        : '';
    const url = typeof itemRecord.url === 'string'
      ? itemRecord.url
      : typeof action?.url === 'string'
        ? action.url
        : '';
    return {
      id: itemId,
      type: 'web_search',
      role: 'system',
      turnId,
      itemId,
      title: actionType === 'openPage' ? '打开网页' : '网页搜索',
      text: query || url || '网页搜索',
      status: typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: [actionType, url].filter(Boolean),
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'imageView') {
    return {
      id: itemId,
      type: 'image_view',
      role: 'system',
      turnId,
      itemId,
      title: '查看图片',
      text: compactText(itemRecord.path) || '查看图片',
      status: kind === 'item_started' ? 'running' : 'completed',
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'imageGeneration') {
    return {
      id: itemId,
      type: 'image_generation',
      role: 'system',
      turnId,
      itemId,
      title: '图片生成',
      text: compactText(itemRecord.savedPath) || compactText(itemRecord.result) || compactText(itemRecord.revisedPrompt) || '图片生成',
      status: typeof itemRecord.status === 'string' ? itemRecord.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: [compactText(itemRecord.revisedPrompt, 160)].filter(Boolean),
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  if (itemType === 'enteredReviewMode' || itemType === 'exitedReviewMode') {
    return {
      id: itemId,
      type: 'review_mode',
      role: 'system',
      turnId,
      itemId,
      title: itemType === 'enteredReviewMode' ? '进入 Review 模式' : '退出 Review 模式',
      text: compactText(itemRecord.review) || 'Review 模式变更',
      status: 'completed',
      createdAt: startedAt,
      details: itemRecord,
    };
  }

  return {
    id: itemId,
    type: 'item_delta',
    role: 'system',
    turnId,
    itemId,
    title: itemType || '项目事件',
    text: summarizeUnknownObject(item, 5) || itemType || '项目事件',
    status: kind === 'item_started' ? 'running' : 'completed',
    createdAt: startedAt,
    details: item,
  };
}

function buildSystemTimelineEntry(
  threadId: string,
  type: string,
  fields: Partial<TimelineEntry> & { id?: string; text?: string; turnId?: string },
): TimelineEntry {
  return {
    id: fields.id || `${threadId}:${type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    type,
    role: fields.role || 'system',
    turnId: fields.turnId,
    itemId: fields.itemId,
    title: fields.title,
    text: fields.text,
    status: fields.status,
    meta: fields.meta,
    patch: fields.patch,
    changes: fields.changes,
    createdAt: fields.createdAt,
    partial: fields.partial,
    details: fields.details,
  };
}

function createTimelineEntriesFromThreadSync(message: Extract<ServerMessage, { type: 'thread_sync' }>): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const planEntry of Array.isArray(message.turnPlans) ? message.turnPlans : []) {
    const turnId = typeof planEntry.turnId === 'string' ? planEntry.turnId : '';
    const plan = Array.isArray(planEntry.plan) ? planEntry.plan : [];
    if (!turnId || !plan.length) {
      continue;
    }
    entries.push({
      id: `turn-plan:${turnId}`,
      type: 'turn_plan',
      role: 'assistant',
      turnId,
      title: '执行计划',
      text: typeof planEntry.explanation === 'string' ? planEntry.explanation : '',
      meta: buildTurnPlanMeta(plan),
      createdAt: typeof planEntry.updatedAt === 'number' ? planEntry.updatedAt : Date.now(),
      details: planEntry,
    });
  }

  for (const diffEntry of Array.isArray(message.turnDiffs) ? message.turnDiffs : []) {
    const turnId = typeof diffEntry.turnId === 'string' ? diffEntry.turnId : '';
    const diff = typeof diffEntry.diff === 'string' ? diffEntry.diff : '';
    if (!turnId || !diff.trim()) {
      continue;
    }
    const fileChangeEntry = entries.find((entry) => entry.turnId === turnId && entry.type === 'file_change');
    if (fileChangeEntry) {
      const merged = mergeTimelineEntryLists(entries, [{
        ...fileChangeEntry,
        patch: diff,
        details: fileChangeEntry.details && typeof fileChangeEntry.details === 'object'
          ? {
            ...(fileChangeEntry.details as Record<string, unknown>),
            patch: diff,
          }
          : fileChangeEntry.details,
      }]);
      entries.splice(0, entries.length, ...merged);
      continue;
    }
    entries.push({
      id: `turn-diff:${turnId}`,
      type: 'turn_diff',
      role: 'system',
      turnId,
      title: '轮次 Diff',
      text: '已恢复的差异快照',
      patch: diff,
      createdAt: typeof diffEntry.updatedAt === 'number' ? diffEntry.updatedAt : Date.now(),
      details: diffEntry,
    });
  }

  for (const supplemental of Array.isArray(message.supplementalItems) ? message.supplementalItems : []) {
    const itemId = typeof supplemental.id === 'string' ? supplemental.id : '';
    if (!itemId || typeof supplemental.type !== 'string') {
      continue;
    }
    const turnId = typeof supplemental._turnId === 'string' ? supplemental._turnId : undefined;
    const createdAt = normalizeTimestamp(
      typeof supplemental.completedAt === 'number'
        ? supplemental.completedAt
        : typeof supplemental.startedAt === 'number'
          ? supplemental.startedAt
          : typeof supplemental.createdAt === 'number'
            ? supplemental.createdAt
            : typeof supplemental.updatedAt === 'number'
              ? supplemental.updatedAt
              : Date.now(),
    );

    if (supplemental.type === 'hookEvent') {
      const hookItem = supplemental;
      const run = hookItem.run;
      const command = typeof run?.command === 'string' ? run.command : '';
      const status = typeof hookItem.status === 'string' ? hookItem.status : 'completed';
      entries.push({
        id: itemId,
        type: 'hook',
        role: 'system',
        turnId,
        itemId,
        title: 'Hook',
        text: command || `Hook ${typeof hookItem.phase === 'string' ? hookItem.phase : 'event'}`,
        status,
        meta: [
          typeof hookItem.phase === 'string' ? hookItem.phase : '',
          typeof run?.exitCode === 'number' ? `退出码 ${run.exitCode}` : '',
        ].filter(Boolean),
        createdAt,
        details: hookItem,
      });
      continue;
    }

    if (supplemental.type === 'guardianReview') {
      const reviewItem = supplemental;
      const review = reviewItem.review;
      const action = reviewItem.action;
      const status = typeof reviewItem.status === 'string' ? reviewItem.status : 'completed';
      entries.push({
        id: itemId,
        type: 'guardian_review',
        role: 'system',
        turnId,
        itemId,
        title: 'Guardian 审查',
        text: summarizeUnknownObject(review) || summarizeUnknownObject(action) || 'Guardian 审查',
        status,
        meta: [
          typeof reviewItem.phase === 'string' ? reviewItem.phase : '',
          typeof reviewItem.decisionSource === 'string' ? reviewItem.decisionSource : '',
        ].filter(Boolean),
        createdAt,
        details: reviewItem,
      });
      continue;
    }

    if (supplemental.type === 'pendingUserMessage') {
      const pendingItem = supplemental;
      const text = extractStructuredText(pendingItem.text)
        || extractStructuredText(pendingItem.content)
        || extractStructuredText(pendingItem.input)
        || extractStructuredText(pendingItem.message);
      if (!text) {
        continue;
      }
      entries.push({
        id: typeof pendingItem.entryId === 'string'
          ? pendingItem.entryId
          : turnId
            ? `pending-user:${turnId}`
            : `pending-user:${itemId}`,
        type: 'message',
        role: 'user',
        turnId,
        itemId,
        text,
        status: typeof pendingItem.status === 'string' ? pendingItem.status : 'completed',
        createdAt,
        details: pendingItem,
      });
      continue;
    }
  }

  for (const notice of Array.isArray(message.globalSupplementalItems) ? message.globalSupplementalItems : []) {
    const noticeId = typeof notice.id === 'string' ? notice.id : '';
    const noticeText = typeof notice.text === 'string' ? notice.text : '';
    if (!noticeId || !noticeText.trim()) {
      continue;
    }
    entries.push({
      id: `global-notice:${noticeId}`,
      type: 'notice',
      role: 'system',
      title: typeof notice.noticeKind === 'string' && notice.noticeKind.trim() ? notice.noticeKind : '通知',
      text: noticeText,
      status: notice.noticeKind === 'warning'
        ? 'warning'
        : notice.noticeKind === 'error'
          ? 'error'
          : 'completed',
      createdAt: normalizeTimestamp(notice.createdAt),
      details: notice,
    });
  }

  return entries;
}

function shouldRenderNotificationInTimeline(method: string, params: Record<string, unknown>): boolean {
  if (typeof params.threadId === 'string' && params.threadId.trim()) {
    return true;
  }
  return method === 'guardianWarning';
}

function buildTimelineEntryFromNotification(method: string, params: Record<string, unknown>): TimelineEntry | null {
  const threadId = typeof params.threadId === 'string' ? params.threadId : '';
  if (!threadId) {
    return null;
  }
  const level = getNotificationLevel(method, params);
  const title = formatNotificationTitle(method, params);
  const text = formatNotificationMessage(method, params);
  return buildSystemTimelineEntry(threadId, 'notice', {
    id: `notification:${threadId}:${method}:${typeof params.sessionId === 'string' ? params.sessionId : typeof params.name === 'string' ? params.name : Date.now()}`,
    role: 'system',
    title,
    text,
    status: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'completed',
    meta: [method].filter(Boolean),
    createdAt: Date.now(),
    details: params,
  });
}

function stringifyNotificationValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyNotificationValue(entry)).join(',')}]`;
  }
  if (!value || typeof value !== 'object') {
    return JSON.stringify(String(value));
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stringifyNotificationValue(entry)}`)
    .join(',')}}`;
}

function buildDismissKeyFromMessage(
  message:
    | Extract<ServerMessage, { type: 'notification' }>
    | Extract<ServerMessage, { type: 'warning' | 'error_notice' }>,
): string {
  if (message.type === 'notification') {
    const params = message.params && typeof message.params === 'object'
      ? message.params as Record<string, unknown>
      : {};
    return `notification:${message.method}:${stringifyNotificationValue(params)}`;
  }
  return `${message.type}:${message.noticeId || ''}:${message.threadId || ''}:${message.noticeKind || ''}:${message.message}`;
}

function isDismissedNotificationKey(key: string | undefined): boolean {
  const normalized = typeof key === 'string' ? key.trim() : '';
  return normalized ? readDismissedNotificationKeys().includes(normalized) : false;
}

function shouldDisplayGenericNotification(method: string): boolean {
  if (method === 'account/rateLimits/updated' || method === 'skills/changed') {
    return false;
  }
  return true;
}

function pushGlobalSupplementalNotifications(
  store: ReturnType<typeof useAppStore.getState>,
  notices: GlobalSupplementalItemPayload[] | undefined,
): void {
  for (const notice of Array.isArray(notices) ? notices : []) {
    const id = typeof notice.id === 'string' ? notice.id : '';
    const text = typeof notice.text === 'string' ? notice.text : '';
    if (!id || !text.trim()) {
      continue;
    }
    const noticeKind = typeof notice.noticeKind === 'string' ? notice.noticeKind : '';
    const dismissKey = `global-notice:${id}:${typeof notice.threadId === 'string' ? notice.threadId : ''}:${noticeKind}:${text}`;
    if (isDismissedNotificationKey(dismissKey)) {
      continue;
    }
    store.pushNotification({
      id: `notice:${id}`,
      level: noticeKind === 'error' ? 'error' : noticeKind === 'warning' ? 'warning' : 'info',
      title: noticeKind || '通知',
      message: text,
      threadId: typeof notice.threadId === 'string' ? notice.threadId : undefined,
      createdAt: normalizeTimestamp(notice.createdAt),
      dismissKey,
    });
  }
}

function mergeThreadSyncEntries(
  currentEntries: TimelineEntry[],
  message: Extract<ServerMessage, { type: 'thread_sync' }>,
): TimelineEntry[] {
  const restoredTurns = Array.isArray(message.turns) ? message.turns as ThreadTurnProjection[] : [];
  const restoredEntries = restoredTurns.flatMap((turn, index) => createEntriesFromThreadTurn(message.threadId, turn, index));
  let entries = mergeTimelineEntryLists(currentEntries, [
    ...restoredEntries,
    ...createTimelineEntriesFromThreadSync(message),
  ]);

  for (const diffEntry of Array.isArray(message.turnDiffs) ? message.turnDiffs : []) {
    const turnId = typeof diffEntry.turnId === 'string' ? diffEntry.turnId : '';
    const diff = typeof diffEntry.diff === 'string' ? diffEntry.diff : '';
    if (!turnId || !diff.trim()) {
      continue;
    }
    entries = mergeTurnDiffIntoFileChangeEntry(entries, message.threadId, turnId, diff);
  }

  return dedupeSyntheticAssistantFallbackEntries(dedupeOptimisticUserEntries(entries));
}

function extractTokenUsageFromThreadSync(
  message: Extract<ServerMessage, { type: 'thread_sync' }>,
): TokenUsagePayload {
  return normalizeTokenUsage(message.tokenUsage ?? message);
}

function resolveActiveTurnStateFromThreadSync(
  threadId: string,
  message: Extract<ServerMessage, { type: 'thread_sync' }>,
  entries: TimelineEntry[],
  approvals: ServerRequestItem[],
  currentTurnState: ThreadRunState | undefined,
): ThreadRunState | undefined {
  const turns = Array.isArray(message.turns) ? message.turns : [];
  let activeTurn: ThreadTurnProjection | null = null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn || typeof turn !== 'object') {
      continue;
    }
    const candidate = turn as ThreadTurnProjection;
    const status = typeof candidate.status === 'string' ? candidate.status : '';
    if (status === 'inProgress') {
      activeTurn = candidate;
      break;
    }
  }

  if (activeTurn?.id) {
    return {
      active: true,
      turnId: activeTurn.id,
      startedAt: normalizeTimestamp(activeTurn.startedAt, Date.now()),
    };
  }

  if (currentTurnState?.active && currentTurnState.turnId) {
    const hasPendingApproval = approvals.some((item) => (
      item.threadId === threadId
      && item.turnId === currentTurnState.turnId
      && item.status !== 'submitting'
    ));
    const hasRunningEntry = entries.some((entry) => (
      entry.turnId === currentTurnState.turnId
      && (entry.partial || entry.status === 'running')
    ));
    const hasSettledResponse = entries.some((entry) => (
      entry.turnId === currentTurnState.turnId
      && entry.role !== 'user'
      && !entry.partial
      && entry.status !== 'running'
    ));

    if (hasPendingApproval || hasRunningEntry) {
      return currentTurnState;
    }
    if (hasSettledResponse) {
      return {
        active: false,
        turnId: currentTurnState.turnId,
        startedAt: currentTurnState.startedAt,
      };
    }
  }

  return currentTurnState;
}

function createEntriesFromThreadTurn(threadId: string, turn: ThreadTurnProjection, index: number): TimelineEntry[] {
  const turnId = String(turn.id || `${threadId}-${index}`);
  const syntheticTurnTime = 1_700_000_000_000 + ((index + 1) * 1000);
  const createdAt = normalizeTimestamp(
    typeof turn.createdAt === 'number'
      ? turn.createdAt
      : typeof turn.updatedAt === 'number'
        ? turn.updatedAt
        : syntheticTurnTime,
  );
  const entries: TimelineEntry[] = [];
  let hasUserMessage = false;
  let hasAssistantMessage = false;

  const items = Array.isArray(turn.items) ? turn.items : [];
  if (items.length) {
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      const fallbackItemTime = createdAt + itemIndex;
      const itemRecord = toThreadItemRecord(item);
      const itemType = itemRecord?.type || '';
      const itemRole = typeof itemRecord?.role === 'string' ? itemRecord.role : '';
      if (itemType === 'userMessage' || (itemType === 'message' && itemRole === 'user')) {
        const text = [
          itemRecord?.text,
          itemType === 'userMessage' ? (item as v2.ThreadItem & { content?: unknown }).content : itemRecord?.content,
          itemRecord?.input,
          itemRecord?.message,
          itemRecord?.parts,
        ]
          .map((part) => extractStructuredText(part))
          .filter(Boolean)
          .join('\n');
        if (text) {
          entries.push({
            id: typeof itemRecord?.id === 'string' ? itemRecord.id : `${turnId}:user`,
            type: 'message',
            role: 'user',
            turnId,
            itemId: typeof itemRecord?.id === 'string' ? itemRecord.id : undefined,
            text,
            createdAt: normalizeTimestamp(itemRecord?.createdAt, fallbackItemTime),
          });
          hasUserMessage = true;
        }
        continue;
      }

      if (itemType === 'agentMessage' || (itemType === 'message' && itemRole === 'assistant')) {
        const text = extractStructuredText(itemRecord?.text)
          || extractStructuredText(itemRecord?.content)
          || extractStructuredText(itemRecord?.output);
        if (!text) {
          continue;
        }
        entries.push({
          id: typeof itemRecord?.id === 'string' ? itemRecord.id : `${turnId}:assistant`,
          type: 'message',
          role: 'assistant',
          turnId,
          itemId: typeof itemRecord?.id === 'string' ? itemRecord.id : undefined,
          text,
          createdAt: normalizeTimestamp(itemRecord?.createdAt, fallbackItemTime),
        });
        hasAssistantMessage = true;
        continue;
      }

      if (itemRecord?.type === 'commandExecution') {
        entries.push({
          id: typeof itemRecord.id === 'string' ? itemRecord.id : `${turnId}:command`,
          type: 'command',
          role: 'system',
          turnId,
          itemId: typeof itemRecord.id === 'string' ? itemRecord.id : undefined,
          title: '命令',
          text: typeof itemRecord.command === 'string' ? itemRecord.command : '执行命令',
          status: typeof itemRecord.status === 'string' ? itemRecord.status : 'completed',
          meta: [
            typeof itemRecord.cwd === 'string' ? itemRecord.cwd : '',
            typeof itemRecord.exitCode === 'number' ? `退出码 ${itemRecord.exitCode}` : '',
          ].filter(Boolean),
          createdAt: normalizeTimestamp(typeof itemRecord.createdAt === 'number' ? itemRecord.createdAt : fallbackItemTime, fallbackItemTime),
        });
        continue;
      }

      const fallbackEntry = createTimelineEntryFromItemEvent('item_completed', threadId, item, turnId, fallbackItemTime);
      if (fallbackEntry) {
        entries.push({
          ...fallbackEntry,
          createdAt: normalizeTimestamp(fallbackEntry.createdAt, fallbackItemTime),
        });
      }
    }
  }

  const userText = extractTurnUserText(turn);
  if (userText && !hasUserMessage) {
    entries.push({
      id: `${turnId}-user`,
      type: 'message',
      role: 'user',
      turnId,
      text: userText,
      createdAt,
    });
  }

  const assistantText = extractTurnAssistantText(turn);
  if (assistantText && !hasAssistantMessage) {
    entries.push({
      id: `${turnId}-assistant`,
      type: 'message',
      role: 'assistant',
      turnId,
      text: assistantText,
      createdAt: normalizeTimestamp(turn.updatedAt, createdAt + items.length),
    });
  }

  return entries.length ? entries : [{
    id: turnId,
    type: 'turn',
    role: 'system',
    turnId,
    text: '空轮次',
    createdAt,
  }];
}

export const useAppStore = create<AppStore>((set) => ({
  health: {
    status: 'idle',
    data: null,
    error: null,
  },
  connection: {
    status: 'idle',
    error: null,
  },
  auth: {
    token: '',
  },
  codexOptions: {
    status: 'idle',
    data: null,
    error: null,
  },
  sessions: {
    items: [],
    activeSessionId: null,
  },
  timeline: {
    entriesBySessionId: {},
  },
  assistantStreams: {
    bySessionId: {},
  },
  approvals: {
    items: [],
  },
  notifications: {
    items: [],
  },
  turns: {
    activeBySessionId: {},
  },
  tokenUsage: {
    bySessionId: {},
  },
  workspace: {
    shortcuts: null,
    listing: null,
    selectedPath: '',
    status: 'idle',
    error: null,
  },
  composer: {
    attachmentsBySessionId: {},
    prefsBySessionId: {},
  },
  setHealthLoading: () => set((state) => ({
    health: {
      ...state.health,
      status: 'loading',
      error: null,
    },
  })),
  setHealthReady: (data) => set({
    health: {
      status: 'ready',
      data,
      error: null,
    },
  }),
  setHealthError: (message) => set({
    health: {
      status: 'error',
      data: null,
      error: message,
    },
  }),
  setConnectionStatus: (status, error) => set({
    connection: {
      status,
      error: error || null,
    },
  }),
  setToken: (token) => set((state) => ({
    auth: {
      ...state.auth,
      token,
    },
  })),
  setCodexOptionsLoading: () => set((state) => ({
    codexOptions: {
      ...state.codexOptions,
      status: 'loading',
      error: null,
    },
  })),
  setCodexOptionsReady: (data) => set({
    codexOptions: {
      status: 'ready',
      data,
      error: null,
    },
  }),
  setCodexOptionsError: (message) => set((state) => ({
    codexOptions: {
      ...state.codexOptions,
      status: 'error',
      error: message,
    },
  })),
  setSessions: (items) => set((state) => {
    const nextActiveSessionId = state.sessions.activeSessionId && items.some((item) => item.threadId === state.sessions.activeSessionId)
      ? state.sessions.activeSessionId
      : null;
    const nextPrefs = mergeComposerPrefsFromSessions(state.composer.prefsBySessionId, items);
    const nextUsage = mergeTokenUsageFromSessions(state.tokenUsage.bySessionId, items);
    if (
      areSessionListsEqual(state.sessions.items, items)
      && state.sessions.activeSessionId === nextActiveSessionId
      && isEqualUnknown(state.composer.prefsBySessionId, nextPrefs)
      && isEqualUnknown(state.tokenUsage.bySessionId, nextUsage)
    ) {
      return state;
    }
    return {
      sessions: {
        items,
        activeSessionId: nextActiveSessionId,
      },
      composer: {
        ...state.composer,
        prefsBySessionId: nextPrefs,
      },
      tokenUsage: {
        bySessionId: nextUsage,
      },
    };
  }),
  upsertSession: (item) => set((state) => {
    const nextItems = [...state.sessions.items];
    const index = nextItems.findIndex((entry) => entry.threadId === item.threadId);
    if (index >= 0) {
      nextItems[index] = mergeSessionItem(nextItems[index], item);
    } else {
      nextItems.unshift(item);
    }
    const nextPrefs = {
      ...state.composer.prefsBySessionId,
      [item.threadId]: mergeComposerPrefsFromSessions(
        state.composer.prefsBySessionId,
        [item],
      )[item.threadId],
    };
    const nextUsage = item.tokenUsage !== undefined && item.tokenUsage !== null
      ? {
        ...state.tokenUsage.bySessionId,
        [item.threadId]: normalizeTokenUsage(item.tokenUsage),
      }
      : state.tokenUsage.bySessionId;
    if (
      areSessionListsEqual(state.sessions.items, nextItems)
      && isEqualUnknown(state.composer.prefsBySessionId, nextPrefs)
      && isEqualUnknown(state.tokenUsage.bySessionId, nextUsage)
    ) {
      return state;
    }
    return {
      sessions: {
        items: nextItems,
        activeSessionId: state.sessions.activeSessionId,
      },
      composer: {
        ...state.composer,
        prefsBySessionId: nextPrefs,
      },
      tokenUsage: {
        bySessionId: nextUsage,
      },
    };
  }),
  removeSession: (threadId) => set((state) => {
    const nextTurns = { ...state.turns.activeBySessionId };
    const nextUsage = { ...state.tokenUsage.bySessionId };
    const nextEntries = { ...state.timeline.entriesBySessionId };
    const nextStreams = { ...state.assistantStreams.bySessionId };
    delete nextTurns[threadId];
    delete nextUsage[threadId];
    delete nextEntries[threadId];
    delete nextStreams[threadId];

    const nextItems = state.sessions.items.filter((item) => item.threadId !== threadId);
    return {
      sessions: {
        items: nextItems,
        activeSessionId: state.sessions.activeSessionId === threadId ? null : state.sessions.activeSessionId,
      },
      timeline: {
        entriesBySessionId: nextEntries,
      },
      assistantStreams: {
        bySessionId: nextStreams,
      },
      turns: {
        activeBySessionId: nextTurns,
      },
      tokenUsage: {
        bySessionId: nextUsage,
      },
      approvals: {
        items: state.approvals.items.filter((item) => item.threadId !== threadId),
      },
    };
  }),
  setActiveSession: (threadId) => set((state) => {
    if (state.sessions.activeSessionId === threadId) {
      return state;
    }
    return {
      sessions: {
        ...state.sessions,
        activeSessionId: threadId,
      },
    };
  }),
  setComposerPrefs: (threadId, prefs) => set((state) => {
    if (areComposerPrefsEqual(state.composer.prefsBySessionId[threadId], prefs)) {
      return state;
    }
    return {
      composer: {
        ...state.composer,
        prefsBySessionId: {
          ...state.composer.prefsBySessionId,
          [threadId]: prefs,
        },
      },
    };
  }),
  replaceServerRequests: (items) => set((state) => {
    const nextItems = items
      .map(normalizeServerRequest)
      .filter((item): item is ServerRequestItem => item !== null)
      .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
    if (areServerRequestListsEqual(state.approvals.items, nextItems)) {
      return state;
    }
    return {
      approvals: {
        items: nextItems,
      },
    };
  }),
  upsertServerRequest: (request) => set((state) => {
    const normalized = normalizeServerRequest(request);
    if (!normalized) {
      return state;
    }

    const nextItems = [...state.approvals.items];
    const index = nextItems.findIndex((item) => item.requestId === normalized.requestId);
    if (index >= 0) {
      nextItems[index] = {
        ...nextItems[index],
        ...normalized,
      };
    } else {
      nextItems.push(normalized);
    }
    nextItems.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
    if (areServerRequestListsEqual(state.approvals.items, nextItems)) {
      return state;
    }

    return {
      approvals: {
        items: nextItems,
      },
    };
  }),
  removeServerRequest: (requestId) => set((state) => {
    const nextItems = state.approvals.items.filter((item) => item.requestId !== requestId);
    if (nextItems.length === state.approvals.items.length) {
      return state;
    }
    return {
      approvals: {
        items: nextItems,
      },
    };
  }),
  resetServerRequests: () => set((state) => {
    if (!state.approvals.items.length) {
      return state;
    }
    return {
      approvals: {
        items: [],
      },
    };
  }),
  pushNotification: (notice) => set((state) => ({
    notifications: {
      items: [...state.notifications.items.filter((item) => item.id !== notice.id), notice]
        .sort((left, right) => left.createdAt - right.createdAt),
    },
  })),
  dismissNotification: (noticeId) => set((state) => {
    const notice = state.notifications.items.find((item) => item.id === noticeId);
    if (notice?.dismissKey) {
      appendDismissedNotificationKey(notice.dismissKey);
    }
    return {
      notifications: {
        items: state.notifications.items.filter((item) => item.id !== noticeId),
      },
    };
  }),
  setTurnStarted: (threadId, turnId, startedAt) => set((state) => ({
    turns: {
      activeBySessionId: {
        ...state.turns.activeBySessionId,
        [threadId]: {
          active: true,
          turnId,
          startedAt: normalizeTimestamp(startedAt),
        },
      },
    },
  })),
  setTurnCompleted: (threadId, turnId) => set((state) => ({
    turns: {
      activeBySessionId: {
        ...state.turns.activeBySessionId,
        [threadId]: {
          active: false,
          turnId,
        },
      },
    },
  })),
  settleAssistantActivity: (threadId, turnId) => set((state) => {
    const entries = [...(state.timeline.entriesBySessionId[threadId] || [])];
    let changed = false;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!isAssistantActivityEntry(entry)) {
        continue;
      }
      if (turnId && entry.turnId && entry.turnId !== turnId) {
        continue;
      }
      if (!entry.partial && entry.status !== 'running') {
        continue;
      }

      entries[index] = {
        ...entry,
        partial: false,
        status: entry.status === 'error' ? entry.status : 'completed',
        meta: entry.meta?.filter((line) => line !== '流式输出中'),
      };
      changed = true;
    }

    if (!changed) {
      return state;
    }

    return {
      timeline: {
        entriesBySessionId: {
          ...state.timeline.entriesBySessionId,
          [threadId]: entries,
        },
      },
    };
  }),
  setTokenUsage: (threadId, usage) => set((state) => {
    const nextUsage = normalizeTokenUsage(usage);
    if (isEqualUnknown(state.tokenUsage.bySessionId[threadId], nextUsage)) {
      return state;
    }
    return {
      tokenUsage: {
        bySessionId: {
          ...state.tokenUsage.bySessionId,
          [threadId]: nextUsage,
        },
      },
    };
  }),
  setSessionModel: (threadId, model) => set((state) => {
    const nextModel = typeof model === 'string' ? model.trim() : '';
    if (!threadId || !nextModel) {
      return state;
    }
    const currentSession = state.sessions.items.find((item) => item.threadId === threadId);
    if (currentSession?.model === nextModel) {
      return state;
    }
    return {
      sessions: {
        ...state.sessions,
        items: state.sessions.items.map((item) => (
          item.threadId === threadId ? { ...item, model: nextModel } : item
        )),
      },
      composer: {
        ...state.composer,
        prefsBySessionId: {
          ...state.composer.prefsBySessionId,
          [threadId]: {
            model: nextModel,
            reasoningEffort: state.composer.prefsBySessionId[threadId]?.reasoningEffort || '',
            approvalPolicy: state.composer.prefsBySessionId[threadId]?.approvalPolicy || '',
            sandboxMode: state.composer.prefsBySessionId[threadId]?.sandboxMode || '',
          },
        },
      },
    };
  }),
  appendTimelineEntry: (threadId, entry) => set((state) => {
    const currentEntries = state.timeline.entriesBySessionId[threadId] || [];
    const nextEntries = [...currentEntries, normalizeTimelineEntry(entry)];
    return {
      timeline: {
        entriesBySessionId: {
          ...state.timeline.entriesBySessionId,
          [threadId]: nextEntries,
        },
      },
    };
  }),
  removeTimelineEntry: (threadId, entryId) => set((state) => {
    const currentEntries = state.timeline.entriesBySessionId[threadId] || [];
    const nextEntries = currentEntries.filter((entry) => entry.id !== entryId);
    if (nextEntries.length === currentEntries.length) {
      return state;
    }
    return {
      timeline: {
        entriesBySessionId: {
          ...state.timeline.entriesBySessionId,
          [threadId]: nextEntries,
        },
      },
    };
  }),
  appendAssistantDelta: (threadId, itemId, delta, options) => set((state) => {
    let entries = [
      ...promotePendingUserEntriesForTurn(
        [...(state.timeline.entriesBySessionId[threadId] || [])],
        threadId,
        options?.turnId,
        options?.createdAt,
      ),
    ];
    const index = entries.findIndex((entry) => entry.id === itemId);
    const currentStreamText = state.assistantStreams.bySessionId[threadId]?.[itemId];
    const nextStreamText = `${currentStreamText ?? (index >= 0 ? entries[index]?.text || '' : '')}${delta}`;
    let entriesChanged = false;

    if (index >= 0) {
      const current = entries[index];
      const nextEntry = {
        ...current,
        role: 'assistant',
        type: 'message',
        turnId: current.turnId || options?.turnId,
        itemId: current.itemId || itemId,
        createdAt: current.createdAt || normalizeTimestamp(options?.createdAt),
        partial: true,
        status: 'running',
      };
      entriesChanged = (
        nextEntry.role !== current.role
        || nextEntry.type !== current.type
        || nextEntry.turnId !== current.turnId
        || nextEntry.itemId !== current.itemId
        || nextEntry.createdAt !== current.createdAt
        || nextEntry.partial !== current.partial
        || nextEntry.status !== current.status
      );
      if (entriesChanged) {
        entries[index] = nextEntry;
      }
    } else {
      entries.push({
        id: itemId,
        type: 'message',
        role: 'assistant',
        turnId: options?.turnId,
        itemId,
        text: '',
        createdAt: normalizeTimestamp(options?.createdAt),
        partial: true,
        status: 'running',
      });
      entriesChanged = true;
    }

    if (!entriesChanged) {
      entries = state.timeline.entriesBySessionId[threadId] || [];
    }

    const currentStreams = state.assistantStreams.bySessionId[threadId] || {};
    if (!entriesChanged && currentStreams[itemId] === nextStreamText) {
      return state;
    }
    return {
      ...(entriesChanged
        ? {
          timeline: {
            entriesBySessionId: {
              ...state.timeline.entriesBySessionId,
              [threadId]: entries,
            },
          },
        }
        : null),
      assistantStreams: {
        bySessionId: {
          ...state.assistantStreams.bySessionId,
          [threadId]: {
            ...currentStreams,
            [itemId]: nextStreamText,
          },
        },
      },
    };
  }),
  upsertTimelineEntry: (threadId, entry) => set((state) => {
    const currentEntries = state.timeline.entriesBySessionId[threadId] || [];
    const entries = [
      ...promotePendingUserEntriesForTurn(
        [...currentEntries],
        threadId,
        entry.turnId,
        entry.createdAt,
      ),
    ];
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      entries[index] = mergeTimelineEntry(entries[index], entry);
    } else {
      entries.push(normalizeTimelineEntry(entry));
    }
    const dedupedEntries = dedupeOptimisticUserEntries(entries);
    if (areTimelineEntryListsEqual(currentEntries, dedupedEntries)) {
      return state;
    }
    return {
      timeline: {
        entriesBySessionId: {
          ...state.timeline.entriesBySessionId,
          [threadId]: dedupedEntries,
        },
      },
    };
  }),
  setWorkspaceLoading: (selectedPath) => set((state) => ({
    workspace: {
      ...state.workspace,
      selectedPath,
      status: 'loading',
      error: null,
    },
  })),
  setWorkspaceReady: (shortcuts, listing) => set({
    workspace: {
      shortcuts,
      listing,
      selectedPath: listing.path,
      status: 'ready',
      error: null,
    },
  }),
  setWorkspaceError: (message) => set((state) => ({
    workspace: {
      ...state.workspace,
      status: 'error',
      error: message,
    },
  })),
  setWorkspaceListing: (listing) => set((state) => ({
    workspace: {
      ...state.workspace,
      listing,
      selectedPath: listing.path,
      status: 'ready',
      error: null,
    },
  })),
  addAttachment: (threadId, attachment) => set((state) => ({
    composer: {
      ...state.composer,
      attachmentsBySessionId: {
        ...state.composer.attachmentsBySessionId,
        [threadId]: [...(state.composer.attachmentsBySessionId[threadId] || []), attachment],
      },
    },
  })),
  removeAttachment: (threadId, attachmentId) => set((state) => ({
    composer: {
      ...state.composer,
      attachmentsBySessionId: {
        ...state.composer.attachmentsBySessionId,
        [threadId]: (state.composer.attachmentsBySessionId[threadId] || []).filter((item) => item.id !== attachmentId),
      },
    },
  })),
  clearAttachments: (threadId) => set((state) => ({
    composer: {
      ...state.composer,
      attachmentsBySessionId: {
        ...state.composer.attachmentsBySessionId,
        [threadId]: [],
      },
    },
  })),
  promotePendingUserEntries: (threadId, turnId, startedAt) => set((state) => {
    const currentEntries = state.timeline.entriesBySessionId[threadId] || [];
    const nextEntries = promotePendingUserEntriesForTurn([...currentEntries], threadId, turnId, startedAt);
    if (nextEntries === currentEntries || areTimelineEntryListsEqual(currentEntries, nextEntries)) {
      return state;
    }

    return {
      timeline: {
        entriesBySessionId: {
          ...state.timeline.entriesBySessionId,
          [threadId]: nextEntries,
        },
      },
    };
  }),
  setThreadSync: (threadId, message) => set((state) => {
    const currentEntries = state.timeline.entriesBySessionId[threadId] || [];
    const mergedEntries = mergeThreadSyncEntries(currentEntries, message);
    const currentTurnState = state.turns.activeBySessionId[threadId];
    const nextTurnState = resolveActiveTurnStateFromThreadSync(
      threadId,
      message,
      mergedEntries,
      state.approvals.items,
      currentTurnState,
    );
    const turnsChanged = !isEqualUnknown(currentTurnState, nextTurnState);
    const nextTurns = turnsChanged
      ? {
        ...state.turns.activeBySessionId,
        ...(nextTurnState ? { [threadId]: nextTurnState } : {}),
      }
      : state.turns.activeBySessionId;

    const nextUsage: TokenUsagePayload = extractTokenUsageFromThreadSync(message) ?? state.tokenUsage.bySessionId[threadId] ?? null;
    const entriesUnchanged = mergedEntries === currentEntries || areTimelineEntryListsEqual(currentEntries, mergedEntries);
    const turnsUnchanged = nextTurns === state.turns.activeBySessionId;
    const usageUnchanged = isEqualUnknown(state.tokenUsage.bySessionId[threadId], nextUsage);
    if (entriesUnchanged && turnsUnchanged && usageUnchanged) {
      return state;
    }

    return {
      timeline: {
        entriesBySessionId: {
          ...state.timeline.entriesBySessionId,
          [threadId]: mergedEntries,
        },
      },
      tokenUsage: {
        bySessionId: {
          ...state.tokenUsage.bySessionId,
          [threadId]: nextUsage,
        },
      },
      turns: {
        activeBySessionId: nextTurns,
      },
    };
  }),
}));

export function mapServerMessageToStore(message: ServerMessage) {
  const store = useAppStore.getState();

  function currentThreadEntries(threadId: string): TimelineEntry[] {
    return useAppStore.getState().timeline.entriesBySessionId[threadId] || [];
  }

  function shouldReplayThreadSyncTimelineEvent(threadId: string, event: Record<string, unknown>): boolean {
    const eventType = typeof event.type === 'string' ? event.type : '';
    if (!eventType) {
      return false;
    }
    if (eventType === 'thread_event') {
      return shouldDisplayThreadEvent(typeof event.method === 'string' ? event.method : '');
    }
    if (eventType === 'turn_started' || eventType === 'turn_completed' || eventType === 'token_usage' || eventType === 'model_rerouted') {
      return true;
    }
    if (eventType === 'agent_delta' || eventType === 'plan_delta' || eventType === 'mcp_tool_progress' || eventType === 'item_started' || eventType === 'item_delta' || eventType === 'thread_event') {
      return true;
    }
    if (eventType === 'item_completed' || eventType === 'warning' || eventType === 'error_notice') {
      return true;
    }
    return false;
  }

  if (message.type === 'state') {
    store.setSessions(Array.isArray(message.tabs) ? message.tabs.map(normalizeTab) : []);
    store.replaceServerRequests(Array.isArray(message.serverRequests) ? message.serverRequests : []);
    pushGlobalSupplementalNotifications(store, message.globalSupplementalItems);
    return;
  }

  if (message.type === 'server_request_required' || message.type === 'server_request_updated') {
    store.upsertServerRequest(message.request);
    return;
  }

  if (message.type === 'server_request_resolved') {
    store.removeServerRequest(message.requestId);
    return;
  }

  if (message.type === 'server_request_reset') {
    store.resetServerRequests();
    return;
  }

  if (message.type === 'tab_updated' && message.tab) {
    store.upsertSession(normalizeTab(message.tab));
    return;
  }

  if (message.type === 'tab_created' && message.tab) {
    store.upsertSession(normalizeTab(message.tab));
    store.setActiveSession(message.threadId);
    return;
  }

  if (message.type === 'tab_removed') {
    store.removeSession(message.threadId);
    return;
  }

  if (message.type === 'thread_sync') {
    const entriesBeforeSync = currentThreadEntries(message.threadId);
    const preExistingItemIds = new Set(
      entriesBeforeSync
        .flatMap((entry) => [entry.id, entry.itemId || ''])
        .filter(Boolean),
    );
    store.setThreadSync(message.threadId, message);
    pushGlobalSupplementalNotifications(store, message.globalSupplementalItems);
    const entriesAfterSync = currentThreadEntries(message.threadId);
    const settledSyncItemIds = new Set(
      entriesAfterSync
        .filter((entry) => !entry.partial && entry.status !== 'running')
        .flatMap((entry) => [entry.id, entry.itemId || ''])
        .filter(Boolean),
    );
    const hasSettledAssistantForTurn = (turnId: string) => entriesAfterSync.some((entry) => (
      entry.turnId === turnId
      && entry.role === 'assistant'
      && !entry.partial
      && entry.status !== 'running'
    ));
    for (const event of Array.isArray(message.timelineEvents) ? message.timelineEvents : []) {
      if (!event || typeof event !== 'object') {
        continue;
      }
      const typedEvent = event as Record<string, unknown>;
      const itemId = typeof typedEvent.itemId === 'string' ? typedEvent.itemId : '';
      const item = typedEvent.item && typeof typedEvent.item === 'object' ? typedEvent.item as Record<string, unknown> : null;
      const resolvedItemId = itemId || (typeof item?.id === 'string' ? item.id : '');
      const eventType = typeof typedEvent.type === 'string' ? typedEvent.type : '';
      const turnId = typeof typedEvent.turnId === 'string' ? typedEvent.turnId : '';
      const isAssistantEvent = eventType === 'agent_delta' || (eventType === 'item_completed' && item?.type === 'agentMessage');
      if (
        typedEvent.threadId !== message.threadId
        || (resolvedItemId && preExistingItemIds.has(resolvedItemId))
        || (resolvedItemId && settledSyncItemIds.has(resolvedItemId))
        || (!resolvedItemId && isAssistantEvent && turnId && hasSettledAssistantForTurn(turnId))
        || !shouldReplayThreadSyncTimelineEvent(message.threadId, typedEvent)
      ) {
        continue;
      }
      mapServerMessageToStore(typedEvent as ServerMessage);
    }
    return;
  }

  if (message.type === 'turn_started') {
    store.setTurnStarted(message.threadId, message.turnId, message.startedAt);
    store.promotePendingUserEntries(message.threadId, message.turnId, message.startedAt);
    return;
  }

  if (message.type === 'turn_completed') {
    store.setTurnCompleted(message.threadId, message.turnId);
    store.settleAssistantActivity(message.threadId, message.turnId);
    return;
  }

  if (message.type === 'token_usage') {
    store.setTokenUsage(message.threadId, message.usage);
    return;
  }

  if (message.type === 'model_rerouted') {
    store.setSessionModel(message.threadId, message.toModel);
    return;
  }

  if (message.type === 'agent_delta') {
    store.appendAssistantDelta(
      message.threadId,
      message.itemId || `${message.threadId}-assistant-live`,
      message.delta || '',
      {
        turnId: message.turnId,
        createdAt: message.startedAt,
      },
    );
    return;
  }

  if (message.type === 'plan_delta') {
    const entryId = message.itemId || `${message.threadId}:${message.turnId || 'turn'}:plan-live`;
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'plan', {
      id: entryId,
      role: 'assistant',
      turnId: message.turnId,
      itemId: message.itemId,
      title: '计划草稿',
      text: `${(useAppStore.getState().timeline.entriesBySessionId[message.threadId] || []).find((entry) => entry.id === entryId)?.text || ''}${message.delta || ''}`,
      status: 'running',
      meta: ['流式输出中'],
      createdAt: message.startedAt,
      partial: true,
    }));
    return;
  }

  if (message.type === 'turn_plan_updated') {
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'turn_plan', {
      id: `turn-plan:${message.turnId || 'turn'}`,
      role: 'assistant',
      turnId: message.turnId,
      title: '执行计划',
      text: typeof message.explanation === 'string' ? message.explanation : '',
      status: 'completed',
      meta: Array.isArray(message.plan) ? buildTurnPlanMeta(message.plan) : [],
    }));
    return;
  }

  if (message.type === 'turn_diff_updated') {
    const state = useAppStore.getState();
    const currentEntries = state.timeline.entriesBySessionId[message.threadId] || [];
    const mergedEntries = mergeTurnDiffIntoFileChangeEntry(
      currentEntries,
      message.threadId,
      message.turnId,
      typeof message.diff === 'string' ? message.diff : currentDiffToText(message.diff),
    );
    useAppStore.setState((prev) => ({
      ...prev,
      timeline: {
        entriesBySessionId: {
          ...prev.timeline.entriesBySessionId,
          [message.threadId]: mergedEntries,
        },
      },
    }));
    return;
  }

  if (message.type === 'mcp_tool_progress') {
    const entryId = message.itemId || `${message.threadId}:${message.turnId || 'turn'}:mcp-progress`;
    const current = (useAppStore.getState().timeline.entriesBySessionId[message.threadId] || []).find((entry) => entry.id === entryId);
    const nextMeta = [...(current?.meta || []), message.message || ''].filter(Boolean);
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'mcp_tool_progress', {
      id: entryId,
      turnId: message.turnId,
      itemId: message.itemId,
      title: 'MCP 工具',
      text: current?.text || '工具运行中',
      status: 'running',
      meta: nextMeta.slice(-6),
      createdAt: message.startedAt,
      partial: true,
    }));
    return;
  }

  if (message.type === 'hook_started' || message.type === 'hook_completed') {
    const run = message.run && typeof message.run === 'object' ? message.run as Record<string, unknown> : {};
    const runId = typeof run.id === 'string'
      ? run.id
      : `${message.threadId}:${message.turnId || 'turn'}:${message.type}`;
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'hook', {
      id: runId,
      turnId: message.turnId,
      itemId: runId,
      title: 'Hook',
      text: typeof run.command === 'string' && run.command ? run.command : message.type === 'hook_started' ? 'Hook 开始' : 'Hook 完成',
      status: typeof run.status === 'string' ? run.status : message.type === 'hook_started' ? 'running' : 'completed',
      meta: [
        message.type === 'hook_started' ? 'started' : 'completed',
        typeof run.exitCode === 'number' ? `退出码 ${run.exitCode}` : '',
      ].filter(Boolean),
      details: message.run,
    }));
    return;
  }

  if (message.type === 'guardian_review_started' || message.type === 'guardian_review_completed') {
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'guardian_review', {
      id: `${message.threadId}:${message.turnId || 'turn'}:${message.type}`,
      turnId: message.turnId,
      title: 'Guardian 审查',
      text: message.type === 'guardian_review_started' ? '审查开始' : '审查完成',
      status: message.type === 'guardian_review_started' ? 'running' : 'completed',
    }));
    return;
  }

  if (message.type === 'item_started') {
    const item = message.item;
    const entry = createTimelineEntryFromItemEvent('item_started', message.threadId, item, message.turnId, message.startedAt);
    if (entry) {
      store.upsertTimelineEntry(message.threadId, entry);
    }
    return;
  }

  if (message.type === 'item_completed') {
    const item = message.item;
    if (item?.type === 'agentMessage') {
      const itemId = typeof item.id === 'string'
        ? item.id
        : `${message.threadId}-assistant-final`;
      const text = typeof item.text === 'string'
        ? item.text
        : '';
      const streamText = useAppStore.getState().assistantStreams.bySessionId[message.threadId]?.[itemId];
      const finalText = text.trim() || streamText || '';
      if (finalText.trim()) {
        store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'message', {
          id: itemId,
          role: 'assistant',
          turnId: message.turnId,
          itemId,
          text: finalText,
          status: 'completed',
          partial: false,
          createdAt: message.completedAt,
        }));
        useAppStore.setState((prev) => {
          const currentStreams = prev.assistantStreams.bySessionId[message.threadId] || {};
          if (!Object.prototype.hasOwnProperty.call(currentStreams, itemId)) {
            return prev;
          }
          const nextStreams = { ...currentStreams };
          delete nextStreams[itemId];
          return {
            assistantStreams: {
              bySessionId: {
                ...prev.assistantStreams.bySessionId,
                [message.threadId]: nextStreams,
              },
            },
          };
        });
      }
      return;
    }

    const entry = createTimelineEntryFromItemEvent('item_completed', message.threadId, item, message.turnId, message.completedAt);
    if (entry) {
      store.upsertTimelineEntry(message.threadId, entry);
    }
    return;
  }

  if (message.type === 'item_delta') {
    const entryId = message.itemId || `${message.threadId}:${message.turnId || 'turn'}:${message.method || 'item_delta'}`;
    const current = (useAppStore.getState().timeline.entriesBySessionId[message.threadId] || []).find((entry) => entry.id === entryId);

    if (
      message.method === 'item/reasoning/summaryTextDelta'
      || message.method === 'item/reasoning/summaryPartAdded'
      || message.method === 'item/reasoning/textDelta'
    ) {
      const deltaText = extractReasoningDelta(message);
      store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'reasoning', {
        id: entryId,
        role: 'assistant',
        turnId: message.turnId,
        itemId: message.itemId,
        title: '推理',
        text: `${current?.text || ''}${deltaText}`,
        status: 'running',
        meta: ['流式输出中'],
        createdAt: message.startedAt,
        partial: true,
      }));
      return;
    }

    if (message.method === 'item/commandExecution/outputDelta') {
      const currentDetails = current?.details && typeof current.details === 'object'
        ? current.details as Record<string, unknown>
        : {};
      const currentOutput = typeof currentDetails.output === 'string'
        ? currentDetails.output
        : typeof currentDetails.aggregatedOutput === 'string'
          ? currentDetails.aggregatedOutput
          : '';
      const nextOutput = `${currentOutput}${message.delta || ''}`;
      store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'command', {
        id: entryId,
        turnId: message.turnId,
        itemId: message.itemId,
        title: current?.title || '命令',
        text: current?.text || '执行命令',
        status: 'running',
        meta: [...(current?.meta || []), message.delta || ''].filter(Boolean).slice(-8),
        createdAt: message.startedAt,
        partial: true,
        details: {
          ...currentDetails,
          output: nextOutput,
          aggregatedOutput: nextOutput,
        },
      }));
      return;
    }

    if (message.method === 'item/fileChange/outputDelta' || message.method === 'item/fileChange/patchUpdated') {
      const currentDetails = current?.details && typeof current.details === 'object'
        ? current.details as Record<string, unknown>
        : {};
      const currentOutput = typeof currentDetails.output === 'string'
        ? currentDetails.output
        : typeof currentDetails.aggregatedOutput === 'string'
          ? currentDetails.aggregatedOutput
          : '';
      const nextOutput = message.method === 'item/fileChange/outputDelta'
        ? `${currentOutput}${message.delta || ''}`
        : currentOutput;
      const nextPatch = typeof message.patch === 'string'
        ? message.patch
        : nextOutput.trim()
          ? nextOutput
          : current?.patch;

      store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'file_change', {
        id: entryId,
        turnId: message.turnId,
        itemId: message.itemId,
        title: current?.title || '文件变更',
        text: current?.text || '文件变更处理中',
        status: 'running',
        patch: nextPatch,
        changes: Array.isArray(message.changes)
          ? message.changes.map((change) => ({
            path: typeof change.path === 'string' ? change.path : '',
            kind: typeof change.kind === 'string' ? change.kind : '',
            addedLines: typeof change.addedLines === 'number' ? change.addedLines : undefined,
            deletedLines: typeof change.deletedLines === 'number' ? change.deletedLines : undefined,
            diff: typeof change.diff === 'string' ? change.diff : undefined,
          }))
          : current?.changes,
        meta: message.delta ? [...(current?.meta || []), message.delta].slice(-8) : current?.meta,
        createdAt: message.startedAt,
        partial: true,
        details: {
          ...currentDetails,
          output: nextOutput,
          aggregatedOutput: nextOutput,
        },
      }));
      return;
    }

    const genericParams = {
      method: message.method,
      delta: message.delta,
      patch: message.patch,
      changes: message.changes,
      part: message.part,
    };
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'item_delta', {
      id: entryId,
      turnId: message.turnId,
      itemId: message.itemId,
      title: formatMethodLabel(message.method || 'item_delta'),
      text: compactText(message.delta) || compactText(message.part) || compactText(message.patch) || summarizeUnknownObject(genericParams, 5) || '项目流式更新',
      status: 'running',
      meta: [message.method || 'item_delta'].filter(Boolean),
      createdAt: message.startedAt,
      partial: true,
      details: genericParams,
    }));
    return;
  }

  if (message.type === 'thread_event') {
    if (!shouldDisplayThreadEvent(message.method)) {
      return;
    }
    const params = message.params && typeof message.params === 'object' ? message.params as Record<string, unknown> : {};
    const entryId = message.itemId || `${message.threadId}:${message.turnId || 'thread'}:${message.method}`;
    const current = (useAppStore.getState().timeline.entriesBySessionId[message.threadId] || []).find((entry) => entry.id === entryId);
    const deltaText = extractEventText(message.method, params) || message.delta || '';
    const isStreaming = message.method === 'process/outputDelta'
      || message.method === 'command/exec/outputDelta'
      || message.method === 'thread/realtime/transcript/delta';
    const text = isStreaming
      ? `${current?.text || ''}${deltaText}`
      : message.message || deltaText || extractEventText(message.method, params, formatMethodLabel(message.method));
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'thread_event', {
      id: entryId,
      turnId: message.turnId,
      itemId: message.itemId,
      title: formatMethodLabel(message.method),
      text,
      status: message.status || (isStreaming ? 'running' : 'completed'),
      meta: [message.method].filter(Boolean),
      createdAt: message.createdAt,
      partial: isStreaming,
      details: params,
    }));
    return;
  }

  if (message.type === 'warning' || message.type === 'error_notice') {
    const threadId = message.threadId;
    const noticeId = message.noticeId || `${threadId || 'global'}:${message.type}:${Date.now()}`;
    const dismissKey = buildDismissKeyFromMessage(message);
    if (isDismissedNotificationKey(dismissKey)) {
      return;
    }
    store.pushNotification({
      id: `notice:${noticeId}`,
      level: message.type === 'warning' ? 'warning' : 'error',
      title: message.noticeKind || (message.type === 'warning' ? '警告' : '错误'),
      message: message.message,
      threadId,
      createdAt: normalizeTimestamp(message.createdAt),
      dismissKey,
    });
    return;
  }

  if (message.type === 'codex_error') {
    if (!message.threadId) {
      return;
    }
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'notice', {
      id: `codex-error:${message.threadId}:${Date.now()}`,
      role: 'system',
      title: 'Codex 错误',
      text: typeof message.error === 'string'
        ? message.error
        : summarizeUnknownObject(message.error) || '发生了 Codex 错误',
      status: 'error',
    }));
    return;
  }

  if (message.type === 'backend_error') {
    const activeThreadId = store.sessions.activeSessionId;
    if (!activeThreadId) {
      return;
    }
    store.upsertTimelineEntry(activeThreadId, buildSystemTimelineEntry(activeThreadId, 'notice', {
      id: `backend-error:${Date.now()}`,
      role: 'system',
      title: '后端错误',
      text: message.message,
      status: 'error',
    }));
    return;
  }

  if (message.type === 'error') {
    if (!message.threadId) {
      return;
    }
    if (message.op === 'turn_send' && message.clientMessageId) {
      store.removeTimelineEntry(message.threadId, `local-user:${message.clientMessageId}`);
      store.pushNotification({
        id: `send-error:${message.clientMessageId}`,
        level: 'error',
        title: '消息未发送',
        message: message.message,
        threadId: message.threadId,
        createdAt: Date.now(),
      });
    }
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'notice', {
      id: `request-error:${message.threadId}:${Date.now()}`,
      role: 'system',
      title: '请求错误',
      text: message.message,
      status: 'error',
    }));
    return;
  }

  if (message.type === 'notification') {
    const params = message.params && typeof message.params === 'object'
      ? message.params as Record<string, unknown>
      : {};
    if (!shouldDisplayGenericNotification(message.method)) {
      return;
    }
    const title = formatNotificationTitle(message.method, params);
    const detail = formatNotificationMessage(message.method, params);
    const level = getNotificationLevel(message.method, params);
    const dismissKey = buildDismissKeyFromMessage(message);
    if (isDismissedNotificationKey(dismissKey)) {
      return;
    }
    store.pushNotification({
      id: `notification:${message.method}:${typeof params.threadId === 'string' ? params.threadId : typeof params.sessionId === 'string' ? params.sessionId : Date.now()}`,
      level,
      title,
      message: detail,
      threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
      createdAt: Date.now(),
      dismissKey,
    });
    if (shouldRenderNotificationInTimeline(message.method, params)) {
      const entry = buildTimelineEntryFromNotification(message.method, params);
      const threadId = typeof params.threadId === 'string' ? params.threadId : '';
      if (entry && threadId) {
        store.upsertTimelineEntry(threadId, entry);
      }
    }
    return;
  }
}

function currentDiffToText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!value) {
    return '';
  }
  return summarizeUnknownObject(value) || '差异快照已更新';
}
