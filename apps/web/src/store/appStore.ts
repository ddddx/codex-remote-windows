import { create } from 'zustand';
import type {
  CodexOptionsResponse,
  HealthResponse,
  ServerMessage,
  UploadImageResponse,
  WorkspaceListResponse,
  WorkspaceShortcutsResponse,
} from '@codex-remote/protocol';
import type { ConnectionStatus } from '../transport/ws/createSocketClient.js';
import { summarizeUnknownObject } from '../app/view-helpers.js';

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
  tokenUsage?: unknown;
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
  changes?: Array<{ path?: string; kind?: string; addedLines?: number; deletedLines?: number }>;
  createdAt?: number;
  partial?: boolean;
  details?: unknown;
};

export type ServerRequestItem = {
  requestId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  kind?: string;
  status?: 'pending' | 'submitting';
  reason?: string;
  message?: string;
  command?: string;
  cwd?: string;
  tool?: string;
  namespace?: string;
  serverName?: string;
  patch?: string;
  questions?: Array<{
    id?: string;
    question?: string;
    header?: string;
    isOther?: boolean;
    isSecret?: boolean;
    options?: Array<{ label?: string; description?: string }>;
  }>;
  permissions?: unknown;
  availableDecisions?: Array<string | Record<string, unknown>>;
  createdAt?: number;
  responseSchema?: unknown;
  arguments?: Record<string, unknown>;
  mode?: string;
  url?: string;
  elicitationId?: string;
  meta?: unknown;
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
    bySessionId: Record<string, unknown>;
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
  replaceServerRequests: (items: unknown[]) => void;
  upsertServerRequest: (request: unknown) => void;
  removeServerRequest: (requestId: string) => void;
  resetServerRequests: () => void;
  pushNotification: (notice: FloatingNotice) => void;
  dismissNotification: (noticeId: string) => void;
  setTurnStarted: (threadId: string, turnId?: string, startedAt?: number) => void;
  setTurnCompleted: (threadId: string, turnId?: string) => void;
  settleAssistantActivity: (threadId: string, turnId?: string) => void;
  setTokenUsage: (threadId: string, usage: unknown) => void;
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

function normalizeTab(tab: any): SessionItem {
  const candidates = [tab?.name, tab?.threadName, tab?.thread_name, tab?.preview];
  const resolvedName = candidates.find((value) => typeof value === 'string' && value.trim());
  return {
    threadId: String(tab?.threadId || ''),
    name: String(resolvedName || '').trim() || '未命名会话',
    cwd: typeof tab?.cwd === 'string' ? tab.cwd : '',
    status: typeof tab?.status === 'string' ? tab.status : '',
    windowStatus: typeof tab?.windowStatus === 'string' ? tab.windowStatus : '',
    approvalPolicy: typeof tab?.approvalPolicy === 'string' ? tab.approvalPolicy : '',
    sandboxMode: typeof tab?.sandboxMode === 'string' ? tab.sandboxMode : '',
    model: typeof tab?.model === 'string' ? tab.model : '',
    reasoningEffort: typeof tab?.reasoningEffort === 'string' ? tab.reasoningEffort : '',
    tokenUsage: normalizeTokenUsage(tab),
    createdAt: typeof tab?.createdAt === 'number' ? tab.createdAt : 0,
    updatedAt: typeof tab?.updatedAt === 'number' ? tab.updatedAt : 0,
  };
}

function extractTokenUsageValue(value: unknown): unknown {
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
    return source;
  }
  const direct = source.tokenUsage
    ?? source.token_usage
    ?? source.usage
    ?? source.tokenStats
    ?? source.token_stats
    ?? null;
  if (direct !== null && direct !== undefined) {
    return direct;
  }
  const nested = source.usage && typeof source.usage === 'object'
    ? source.usage as Record<string, unknown>
    : null;
  return nested?.tokenUsage
    ?? nested?.token_usage
    ?? nested?.usage
    ?? nested?.tokenStats
    ?? nested?.token_stats
    ?? null;
}

function normalizeTokenUsage(value: unknown): unknown {
  const extracted = extractTokenUsageValue(value);
  if (!extracted || typeof extracted !== 'object') {
    return extracted;
  }
  const usage = extracted as Record<string, unknown>;
  const nested = usage.usage && typeof usage.usage === 'object' ? usage.usage as Record<string, unknown> : null;
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
                    : undefined,
  };
}

function mergeTokenUsageFromSessions(
  existing: Record<string, unknown>,
  sessions: SessionItem[],
): Record<string, unknown> {
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

function extractTurnText(turn: any): string {
  if (typeof turn?.text === 'string' && turn.text.trim()) {
    return turn.text;
  }

  const items = Array.isArray(turn?.items) ? turn.items : [];
  const itemTextParts = items.flatMap((item: any) => {
    if (item?.type === 'userMessage' && Array.isArray(item?.content)) {
      return item.content
        .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
        .map((part: any) => part.text.trim())
        .filter(Boolean);
    }
    if (item?.type === 'agentMessage' && typeof item?.text === 'string' && item.text.trim()) {
      return [item.text.trim()];
    }
    return [];
  });
  if (itemTextParts.length) {
    return itemTextParts.join('\n');
  }

  const inputItems = Array.isArray(turn?.input) ? turn.input : [];
  const textParts = inputItems
    .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part: any) => part.text.trim())
    .filter(Boolean);
  if (textParts.length) {
    return textParts.join('\n');
  }

  if (typeof turn?.summary === 'string' && turn.summary.trim()) {
    return turn.summary;
  }

  return '';
}

function normalizeServerRequest(request: any): ServerRequestItem | null {
  const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
  if (!requestId) {
    return null;
  }

  return {
    requestId,
    threadId: typeof request?.threadId === 'string' ? request.threadId : undefined,
    turnId: typeof request?.turnId === 'string' ? request.turnId : undefined,
    itemId: typeof request?.itemId === 'string' ? request.itemId : undefined,
    kind: typeof request?.kind === 'string' ? request.kind : undefined,
    status: request?.status === 'submitting' ? 'submitting' : 'pending',
    reason: typeof request?.reason === 'string' ? request.reason : undefined,
    message: typeof request?.message === 'string' ? request.message : undefined,
    command: typeof request?.command === 'string' ? request.command : undefined,
    cwd: typeof request?.cwd === 'string' ? request.cwd : undefined,
    tool: typeof request?.tool === 'string' ? request.tool : undefined,
    namespace: typeof request?.namespace === 'string' ? request.namespace : undefined,
    serverName: typeof request?.serverName === 'string' ? request.serverName : undefined,
    patch: typeof request?.patch === 'string' ? request.patch : undefined,
    questions: Array.isArray(request?.questions) ? request.questions : undefined,
    permissions: request?.permissions ?? undefined,
    availableDecisions: Array.isArray(request?.availableDecisions) ? request.availableDecisions : undefined,
    createdAt: normalizeTimestamp(request?.createdAt),
    responseSchema: request?.responseSchema ?? undefined,
    arguments: request?.arguments && typeof request.arguments === 'object' ? request.arguments : undefined,
    mode: typeof request?.mode === 'string' ? request.mode : undefined,
    url: typeof request?.url === 'string' ? request.url : undefined,
    elicitationId: typeof request?.elicitationId === 'string' ? request.elicitationId : undefined,
    meta: request?.meta ?? undefined,
  };
}

function compactText(value: unknown, max = 280): string {
  const text = typeof value === 'string' ? value : '';
  const normalized = text.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
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
      .map((change) => [change.kind, change.path].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' · ');
    const suffix = validChanges.length > 3 ? ` 等 ${validChanges.length} 项` : '';
    return preview ? `${preview}${suffix}` : `已记录 ${validChanges.length} 项文件变更`;
  }

  if (typeof patch === 'string' && patch.trim()) {
    return '已生成变更补丁';
  }

  if (status === 'completed' || status === 'success' || status === 'succeeded') {
    return '文件变更已完成';
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
      }))
      : entry.changes,
    createdAt: normalizeTimestamp(entry.createdAt),
    partial: Boolean(entry.partial),
  };
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
  let changed = false;

  const nextEntries = entries.map((entry) => {
    if (entry.role !== 'user' || entry.turnId !== `${threadId}:pending-turn`) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      turnId: resolvedTurnId,
      createdAt: entry.createdAt || resolvedStartedAt,
    };
  });

  return changed
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
  item: Record<string, unknown> | undefined,
  turnId?: string,
): TimelineEntry | null {
  if (!item) {
    return null;
  }

  const itemType = typeof item.type === 'string' ? item.type : '';
  const itemId = typeof item.id === 'string'
    ? item.id
    : `${threadId}:${turnId || 'turn'}:${kind}:${itemType || 'item'}`;
  const startedAt = normalizeTimestamp(
    typeof item.startedAt === 'number'
      ? item.startedAt
      : typeof item.createdAt === 'number'
        ? item.createdAt
        : Date.now(),
  );

  if (itemType === 'reasoning') {
    const summaryText = Array.isArray(item.summary)
      ? item.summary
        .map((entry) => typeof (entry as any)?.text === 'string' ? (entry as any).text : '')
        .filter(Boolean)
        .join('\n')
      : '';
    return {
      id: itemId,
      type: 'reasoning',
      role: 'assistant',
      turnId,
      itemId,
      title: '推理',
      text: compactText(item.text) || compactText(summaryText) || '思考中…',
      status: kind === 'item_started' ? 'running' : 'completed',
      meta: [kind === 'item_started' ? '流式输出中' : '已记录', new Date(startedAt).toLocaleTimeString()],
      createdAt: startedAt,
      details: item,
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
      text: compactText(item.text) || '正在规划…',
      status: kind === 'item_started' ? 'running' : 'completed',
      meta: [new Date(startedAt).toLocaleTimeString()],
      createdAt: startedAt,
      details: item,
    };
  }

  if (itemType === 'commandExecution') {
    const command = typeof item.command === 'string'
      ? item.command
      : typeof item.input === 'string'
        ? item.input
        : '';
    const output = typeof item.output === 'string'
      ? item.output
      : typeof item.aggregatedOutput === 'string'
        ? item.aggregatedOutput
        : '';
    return {
      id: itemId,
      type: 'command',
      role: 'system',
      turnId,
      itemId,
      title: '命令',
      text: compactText(command) || '执行命令',
      status: typeof item.status === 'string' ? item.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: [
        typeof item.cwd === 'string' && item.cwd ? item.cwd : '',
        output ? `输出 ${output.length} 字符` : '',
      ].filter(Boolean),
      createdAt: startedAt,
      details: item,
    };
  }

  if (itemType === 'fileChange') {
    const status = typeof item.status === 'string' ? item.status : (kind === 'item_started' ? 'running' : 'completed');
    const changes = Array.isArray(item.changes)
      ? item.changes.map((change) => ({
        path: typeof (change as any)?.path === 'string' ? (change as any).path : '',
        kind: typeof (change as any)?.kind === 'string' ? (change as any).kind : '',
        addedLines: typeof (change as any)?.addedLines === 'number' ? (change as any).addedLines : undefined,
        deletedLines: typeof (change as any)?.deletedLines === 'number' ? (change as any).deletedLines : undefined,
      }))
      : undefined;
    const patch = typeof item.patch === 'string' ? item.patch : undefined;
    const output = typeof item.output === 'string' ? item.output : '';
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
      details: item,
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
      text: [item.server, item.tool].filter((value) => typeof value === 'string' && value).join('.'),
      status: typeof item.status === 'string' ? item.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: Array.isArray(item.progressMessages) ? item.progressMessages.filter((value): value is string => typeof value === 'string') : [],
      createdAt: startedAt,
      details: item,
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
      text: [item.namespace, item.tool].filter((value) => typeof value === 'string' && value).join('.'),
      status: typeof item.status === 'string' ? item.status : (kind === 'item_started' ? 'running' : 'completed'),
      createdAt: startedAt,
      details: item,
    };
  }

  if (itemType === 'webSearch') {
    const action = item.action && typeof item.action === 'object' ? item.action as Record<string, unknown> : undefined;
    const actionType = typeof action?.type === 'string' ? action.type : '';
    const query = typeof item.query === 'string'
      ? item.query
      : typeof action?.query === 'string'
        ? action.query
        : '';
    const url = typeof item.url === 'string'
      ? item.url
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
      status: typeof item.status === 'string' ? item.status : (kind === 'item_started' ? 'running' : 'completed'),
      meta: [actionType, url].filter(Boolean),
      createdAt: startedAt,
      details: item,
    };
  }

  return null;
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
    const turnId = typeof (planEntry as any)?.turnId === 'string' ? (planEntry as any).turnId : '';
    const plan = Array.isArray((planEntry as any)?.plan) ? (planEntry as any).plan : [];
    if (!turnId || !plan.length) {
      continue;
    }
    entries.push({
      id: `turn-plan:${turnId}`,
      type: 'turn_plan',
      role: 'assistant',
      turnId,
      title: '执行计划',
      text: typeof (planEntry as any)?.explanation === 'string' ? (planEntry as any).explanation : '',
      meta: plan.map((step: any) => [step?.status, step?.step].filter(Boolean).join(': ')),
      createdAt: typeof (planEntry as any)?.updatedAt === 'number' ? (planEntry as any).updatedAt : Date.now(),
      details: planEntry,
    });
  }

  for (const diffEntry of Array.isArray(message.turnDiffs) ? message.turnDiffs : []) {
    const turnId = typeof (diffEntry as any)?.turnId === 'string' ? (diffEntry as any).turnId : '';
    const diff = typeof (diffEntry as any)?.diff === 'string' ? (diffEntry as any).diff : '';
    if (!turnId || !diff.trim()) {
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
      createdAt: typeof (diffEntry as any)?.updatedAt === 'number' ? (diffEntry as any).updatedAt : Date.now(),
      details: diffEntry,
    });
  }

  for (const supplemental of Array.isArray(message.supplementalItems) ? message.supplementalItems : []) {
    const item = supplemental as Record<string, unknown>;
    const itemId = typeof item.id === 'string' ? item.id : '';
    const itemType = typeof item.type === 'string' ? item.type : '';
    if (!itemId || !itemType) {
      continue;
    }
  }

  return entries;
}

function createEntriesFromThreadTurn(threadId: string, turn: any, index: number): TimelineEntry[] {
  const turnId = String(turn?.id || `${threadId}-${index}`);
  const createdAt = normalizeTimestamp(typeof turn?.createdAt === 'number' ? turn.createdAt : Date.now() + index);
  const entries: TimelineEntry[] = [];
  let hasUserMessage = false;
  let hasAssistantMessage = false;

  const items = Array.isArray(turn?.items) ? turn.items : [];
  if (items.length) {
    for (const item of items) {
      if (item?.type === 'userMessage' && Array.isArray(item?.content)) {
        const text = item.content
          .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
          .map((part: any) => part.text.trim())
          .filter(Boolean)
          .join('\n');
        if (text) {
          entries.push({
            id: `${turnId}:${item.id || 'user'}`,
            type: 'message',
            role: 'user',
            turnId,
            itemId: typeof item?.id === 'string' ? item.id : undefined,
            text,
            createdAt: normalizeTimestamp(item?.createdAt, createdAt),
          });
          hasUserMessage = true;
        }
        continue;
      }

      if (item?.type === 'agentMessage' && typeof item?.text === 'string' && item.text.trim()) {
        entries.push({
          id: `${turnId}:${item.id || 'assistant'}`,
          type: 'message',
          role: 'assistant',
          turnId,
          itemId: typeof item?.id === 'string' ? item.id : undefined,
          text: item.text.trim(),
          createdAt: normalizeTimestamp(typeof item?.createdAt === 'number' ? item.createdAt : turn?.updatedAt, createdAt + 1),
        });
        hasAssistantMessage = true;
        continue;
      }

      if (item?.type === 'commandExecution') {
        entries.push({
          id: `${turnId}:${item.id || 'command'}`,
          type: 'command',
          role: 'system',
          turnId,
          itemId: typeof item?.id === 'string' ? item.id : undefined,
          title: '命令',
          text: typeof item?.command === 'string' ? item.command : '执行命令',
          status: typeof item?.status === 'string' ? item.status : 'completed',
          meta: [
            typeof item?.cwd === 'string' ? item.cwd : '',
            typeof item?.exitCode === 'number' ? `退出码 ${item.exitCode}` : '',
          ].filter(Boolean),
          createdAt: normalizeTimestamp(typeof item?.createdAt === 'number' ? item.createdAt : createdAt, createdAt),
        });
        continue;
      }

      const fallbackEntry = createTimelineEntryFromItemEvent('item_completed', threadId, item, turnId);
      if (fallbackEntry) {
        entries.push({
          ...fallbackEntry,
          createdAt: normalizeTimestamp(fallbackEntry.createdAt, createdAt),
        });
      }
    }
  }

  const userText = extractTurnText(turn);
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

  if (typeof turn?.output === 'string' && turn.output.trim() && !hasAssistantMessage) {
    entries.push({
      id: `${turnId}-assistant`,
      type: 'message',
      role: 'assistant',
      turnId,
      text: turn.output.trim(),
      createdAt: normalizeTimestamp(turn?.updatedAt, createdAt + 1),
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
  setSessions: (items) => set((state) => ({
    sessions: {
      items,
      activeSessionId: state.sessions.activeSessionId && items.some((item) => item.threadId === state.sessions.activeSessionId)
        ? state.sessions.activeSessionId
        : null,
    },
    tokenUsage: {
      bySessionId: mergeTokenUsageFromSessions(state.tokenUsage.bySessionId, items),
    },
  })),
  upsertSession: (item) => set((state) => {
    const nextItems = [...state.sessions.items];
    const index = nextItems.findIndex((entry) => entry.threadId === item.threadId);
    if (index >= 0) {
      nextItems[index] = {
        ...nextItems[index],
        ...item,
      };
    } else {
      nextItems.unshift(item);
    }
    return {
      sessions: {
        items: nextItems,
        activeSessionId: state.sessions.activeSessionId,
      },
      tokenUsage: {
        bySessionId: item.tokenUsage !== undefined && item.tokenUsage !== null
          ? {
            ...state.tokenUsage.bySessionId,
            [item.threadId]: normalizeTokenUsage(item.tokenUsage),
          }
          : state.tokenUsage.bySessionId,
      },
    };
  }),
  removeSession: (threadId) => set((state) => {
    const nextTurns = { ...state.turns.activeBySessionId };
    const nextUsage = { ...state.tokenUsage.bySessionId };
    const nextEntries = { ...state.timeline.entriesBySessionId };
    delete nextTurns[threadId];
    delete nextUsage[threadId];
    delete nextEntries[threadId];

    const nextItems = state.sessions.items.filter((item) => item.threadId !== threadId);
    return {
      sessions: {
        items: nextItems,
        activeSessionId: state.sessions.activeSessionId === threadId ? null : state.sessions.activeSessionId,
      },
      timeline: {
        entriesBySessionId: nextEntries,
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
  setActiveSession: (threadId) => set((state) => ({
    sessions: {
      ...state.sessions,
      activeSessionId: threadId,
    },
  })),
  setComposerPrefs: (threadId, prefs) => set((state) => ({
    composer: {
      ...state.composer,
      prefsBySessionId: {
        ...state.composer.prefsBySessionId,
        [threadId]: prefs,
      },
    },
  })),
  replaceServerRequests: (items) => set(() => ({
    approvals: {
      items: items
        .map(normalizeServerRequest)
        .filter((item): item is ServerRequestItem => item !== null)
        .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0)),
    },
  })),
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

    return {
      approvals: {
        items: nextItems,
      },
    };
  }),
  removeServerRequest: (requestId) => set((state) => ({
    approvals: {
      items: state.approvals.items.filter((item) => item.requestId !== requestId),
    },
  })),
  resetServerRequests: () => set({
    approvals: {
      items: [],
    },
  }),
  pushNotification: (notice) => set((state) => ({
    notifications: {
      items: [...state.notifications.items.filter((item) => item.id !== notice.id), notice]
        .sort((left, right) => left.createdAt - right.createdAt),
    },
  })),
  dismissNotification: (noticeId) => set((state) => ({
    notifications: {
      items: state.notifications.items.filter((item) => item.id !== noticeId),
    },
  })),
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
  setTokenUsage: (threadId, usage) => set((state) => ({
    tokenUsage: {
      bySessionId: {
        ...state.tokenUsage.bySessionId,
        [threadId]: normalizeTokenUsage(usage),
      },
    },
  })),
  appendTimelineEntry: (threadId, entry) => set((state) => ({
    timeline: {
      entriesBySessionId: {
        ...state.timeline.entriesBySessionId,
        [threadId]: [...(state.timeline.entriesBySessionId[threadId] || []), normalizeTimelineEntry(entry)],
      },
    },
  })),
  removeTimelineEntry: (threadId, entryId) => set((state) => ({
    timeline: {
      entriesBySessionId: {
        ...state.timeline.entriesBySessionId,
        [threadId]: (state.timeline.entriesBySessionId[threadId] || []).filter((entry) => entry.id !== entryId),
      },
    },
  })),
  appendAssistantDelta: (threadId, itemId, delta, options) => set((state) => {
    const entries = [
      ...promotePendingUserEntriesForTurn(
        [...(state.timeline.entriesBySessionId[threadId] || [])],
        threadId,
        options?.turnId,
        options?.createdAt,
      ),
    ];
    const index = entries.findIndex((entry) => entry.id === itemId);
    if (index >= 0) {
      entries[index] = {
        ...entries[index],
        role: 'assistant',
        type: 'message',
        turnId: entries[index].turnId || options?.turnId,
        itemId: entries[index].itemId || itemId,
        text: `${entries[index].text || ''}${delta}`,
        createdAt: entries[index].createdAt || normalizeTimestamp(options?.createdAt),
        partial: true,
        status: 'running',
      };
    } else {
      entries.push({
        id: itemId,
        type: 'message',
        role: 'assistant',
        turnId: options?.turnId,
        itemId,
        text: delta,
        createdAt: normalizeTimestamp(options?.createdAt),
        partial: true,
        status: 'running',
      });
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
  upsertTimelineEntry: (threadId, entry) => set((state) => {
    const entries = [
      ...promotePendingUserEntriesForTurn(
        [...(state.timeline.entriesBySessionId[threadId] || [])],
        threadId,
        entry.turnId,
        entry.createdAt,
      ),
    ];
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      entries[index] = {
        ...entries[index],
        ...normalizeTimelineEntry(entry),
      };
    } else {
      entries.push(normalizeTimelineEntry(entry));
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
    if (nextEntries === currentEntries) {
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
  setThreadSync: (threadId, message) => set((state) => ({
    timeline: {
      entriesBySessionId: {
        ...state.timeline.entriesBySessionId,
        [threadId]: [
          ...(Array.isArray(message.turns)
          ? message.turns.flatMap((turn: any, index) => createEntriesFromThreadTurn(threadId, turn, index))
          : []),
          ...createTimelineEntriesFromThreadSync(message),
        ].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0)),
      },
    },
    tokenUsage: {
      bySessionId: {
        ...state.tokenUsage.bySessionId,
        [threadId]: normalizeTokenUsage(message) ?? state.tokenUsage.bySessionId[threadId] ?? null,
      },
    },
  })),
}));

export function mapServerMessageToStore(message: ServerMessage) {
  const store = useAppStore.getState();

  if (message.type === 'state') {
    store.setSessions(Array.isArray(message.tabs) ? message.tabs.map(normalizeTab) : []);
    store.replaceServerRequests(Array.isArray(message.serverRequests) ? message.serverRequests : []);
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
    store.setThreadSync(message.threadId, message);
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
      meta: Array.isArray(message.plan)
        ? message.plan.map((step: any) => [step?.status, step?.step].filter(Boolean).join(': ')).filter(Boolean)
        : [],
    }));
    return;
  }

  if (message.type === 'turn_diff_updated') {
    store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'turn_diff', {
      id: `turn-diff:${message.turnId || 'turn'}`,
      turnId: message.turnId,
      title: '轮次 Diff',
      text: '已更新的差异快照',
      patch: typeof message.diff === 'string' ? message.diff : currentDiffToText(message.diff),
      status: 'completed',
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
    return;
  }

  if (message.type === 'guardian_review_started' || message.type === 'guardian_review_completed') {
    return;
  }

  if (message.type === 'item_started') {
    const item = message.item as Record<string, unknown> | undefined;
    const entry = createTimelineEntryFromItemEvent('item_started', message.threadId, item, message.turnId);
    if (entry) {
      store.upsertTimelineEntry(message.threadId, entry);
    }
    return;
  }

  if (message.type === 'item_completed') {
    const item = message.item as Record<string, unknown> | undefined;
    if (item?.type === 'agentMessage') {
      const itemId = typeof item.id === 'string'
        ? item.id
        : `${message.threadId}-assistant-final`;
      const text = typeof item.text === 'string'
        ? item.text
        : typeof item.output === 'string'
          ? item.output
          : '';
      if (text.trim()) {
        store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'message', {
          id: itemId,
          role: 'assistant',
          turnId: message.turnId,
          itemId,
          text: text.trim(),
          status: 'completed',
          partial: false,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        }));
      }
      return;
    }

    const entry = createTimelineEntryFromItemEvent('item_completed', message.threadId, item, message.turnId);
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
      store.upsertTimelineEntry(message.threadId, buildSystemTimelineEntry(message.threadId, 'file_change', {
        id: entryId,
        turnId: message.turnId,
        itemId: message.itemId,
        title: current?.title || '文件变更',
        text: current?.text || '文件变更处理中',
        status: 'running',
        patch: typeof message.patch === 'string' ? message.patch : current?.patch,
        changes: Array.isArray(message.changes)
          ? message.changes.map((change: any) => ({
            path: typeof change?.path === 'string' ? change.path : '',
            kind: typeof change?.kind === 'string' ? change.kind : '',
            addedLines: typeof change?.addedLines === 'number' ? change.addedLines : undefined,
            deletedLines: typeof change?.deletedLines === 'number' ? change.deletedLines : undefined,
          }))
          : current?.changes,
        meta: message.delta ? [...(current?.meta || []), message.delta].slice(-8) : current?.meta,
        createdAt: message.startedAt,
        partial: true,
      }));
      return;
    }

    return;
  }

  if (message.type === 'warning' || message.type === 'error_notice') {
    const threadId = message.threadId;
    const noticeId = message.noticeId || `${threadId || 'global'}:${message.type}:${Date.now()}`;
    store.pushNotification({
      id: `notice:${noticeId}`,
      level: message.type === 'warning' ? 'warning' : 'error',
      title: message.noticeKind || (message.type === 'warning' ? '警告' : '错误'),
      message: message.message,
      threadId,
      createdAt: normalizeTimestamp(message.createdAt),
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
