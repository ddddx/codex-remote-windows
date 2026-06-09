import { createPendingRequestRecord } from '@codex-remote/domain';
import type { ServerRequestPayload } from '@codex-remote/protocol';
import type {
  ApplyPatchApprovalParams,
  ExecCommandApprovalParams,
  ServerRequest,
  v2,
} from '@codex-remote/codex-app-server-types';
import type { FastifyInstance } from 'fastify';

export type RuntimeServerRequest = {
  requestId: string;
  rawRequestId: string | number;
  method: ServerRequest['method'];
  kind: string;
  status: 'pending' | 'submitting';
  createdAt: number;
  submittedAt?: number | null;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  reason?: string;
  command?: string;
  cwd?: string;
  patch?: string;
  changes?: unknown[];
  permissions?: unknown;
  availableDecisions?: unknown[];
  questions?: unknown[];
  tool?: string;
  namespace?: string;
  arguments?: Record<string, unknown>;
  serverName?: string;
  message?: string;
  mode?: string;
  url?: string;
  elicitationId?: string;
  requestedSchema?: Record<string, unknown> | null;
  meta?: unknown;
  raw?: Record<string, unknown>;
  payloadJson?: string;
};

export type PersistedServerRequestRecord = {
  requestId: string;
  rawRequestId?: string | number;
  method: string;
  kind: string;
  status: 'pending' | 'submitting' | 'resolved';
  createdAt: number;
  submittedAt?: number | null;
  threadId?: string | null;
  turnId?: string | null;
  itemId?: string | null;
  reason?: string;
  message?: string;
  command?: string;
  cwd?: string;
  tool?: string;
  namespace?: string;
  serverName?: string;
  patch?: string;
  changes?: unknown[];
  questions?: unknown[];
  permissions?: unknown;
  availableDecisions?: unknown[];
  responseSchema?: unknown;
  requestedSchema?: Record<string, unknown> | null;
  arguments?: Record<string, unknown>;
  mode?: string;
  url?: string;
  elicitationId?: string;
  meta?: unknown;
  raw?: Record<string, unknown>;
  payloadJson?: string;
};

export function createServerRequestRecord(msg: ServerRequest): RuntimeServerRequest {
  const requestId = String(msg.id);
  const createdAt = Date.now();

  switch (msg.method) {
    case 'item/commandExecution/requestApproval':
      return mapCommandExecutionApproval(requestId, msg.id, createdAt, msg.params);
    case 'item/fileChange/requestApproval':
      return {
        requestId,
        rawRequestId: msg.id,
        method: msg.method,
        kind: 'file_change_approval',
        status: 'pending',
        createdAt,
        submittedAt: null,
        threadId: msg.params.threadId,
        turnId: msg.params.turnId,
        itemId: msg.params.itemId,
        reason: msg.params.reason || '',
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
        raw: toRecord(msg.params),
      };
    case 'item/permissions/requestApproval':
      return {
        requestId,
        rawRequestId: msg.id,
        method: msg.method,
        kind: 'permissions_approval',
        status: 'pending',
        createdAt,
        submittedAt: null,
        threadId: msg.params.threadId,
        turnId: msg.params.turnId,
        itemId: msg.params.itemId,
        reason: msg.params.reason || '',
        cwd: msg.params.cwd,
        permissions: msg.params.permissions,
        availableDecisions: ['accept', 'decline', 'cancel'],
        raw: toRecord(msg.params),
      };
    case 'item/tool/requestUserInput':
      return {
        requestId,
        rawRequestId: msg.id,
        method: msg.method,
        kind: 'user_input',
        status: 'pending',
        createdAt,
        submittedAt: null,
        threadId: msg.params.threadId,
        turnId: msg.params.turnId,
        itemId: msg.params.itemId,
        questions: msg.params.questions,
        raw: toRecord(msg.params),
      };
    case 'item/tool/call':
      return {
        requestId,
        rawRequestId: msg.id,
        method: msg.method,
        kind: 'dynamic_tool_call',
        status: 'pending',
        createdAt,
        submittedAt: null,
        threadId: msg.params.threadId,
        turnId: msg.params.turnId,
        itemId: msg.params.callId,
        tool: msg.params.tool,
        namespace: msg.params.namespace || '',
        arguments: isPlainObject(msg.params.arguments) ? msg.params.arguments : {},
        raw: toRecord(msg.params),
      };
    case 'mcpServer/elicitation/request':
      return {
        requestId,
        rawRequestId: msg.id,
        method: msg.method,
        kind: 'mcp_server_elicitation',
        status: 'pending',
        createdAt,
        submittedAt: null,
        threadId: msg.params.threadId,
        turnId: msg.params.turnId,
        itemId: null,
        serverName: msg.params.serverName,
        message: msg.params.message,
        mode: msg.params.mode,
        url: msg.params.mode === 'url' ? msg.params.url : '',
        elicitationId: msg.params.mode === 'url' ? msg.params.elicitationId : '',
        requestedSchema: msg.params.mode === 'form' && isPlainObject(msg.params.requestedSchema)
          ? msg.params.requestedSchema as Record<string, unknown>
          : null,
        meta: msg.params._meta,
        raw: toRecord(msg.params),
      };
    case 'applyPatchApproval':
      return mapLegacyPatchApproval(requestId, msg.id, createdAt, msg.params);
    case 'execCommandApproval':
      return mapLegacyExecApproval(requestId, msg.id, createdAt, msg.params);
    case 'account/chatgptAuthTokens/refresh':
      return {
        requestId,
        rawRequestId: msg.id,
        method: msg.method,
        kind: 'account_refresh',
        status: 'pending',
        createdAt,
        submittedAt: null,
        threadId: null,
        turnId: null,
        itemId: null,
        raw: toRecord(msg.params),
      };
    case 'attestation/generate':
      return {
        requestId,
        rawRequestId: msg.id,
        method: msg.method,
        kind: 'attestation_generate',
        status: 'pending',
        createdAt,
        submittedAt: null,
        threadId: null,
        turnId: null,
        itemId: null,
        message: '生成 attestation token',
        raw: toRecord(msg.params),
      };
    default:
      return assertNever(msg);
  }
}

export function listServerRequests(app: FastifyInstance): ServerRequestPayload[] {
  return Array.from(app.runtimeState.serverRequestsById.values())
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((request) => toServerRequestPayload(request));
}

export function persistServerRequest(
  app: FastifyInstance,
  request: RuntimeServerRequest,
): void {
  app.repositories.pendingRequests.upsertPendingRequest(createPendingRequestRecord({
    requestId: request.requestId,
    threadId: request.threadId ?? null,
    turnId: request.turnId ?? null,
    itemId: request.itemId ?? null,
    kind: request.kind,
    method: request.method,
    status: request.status,
    payloadJson: JSON.stringify(request),
    createdAt: request.createdAt,
    submittedAt: request.submittedAt ?? null,
  }));
}

export function toServerRequestPayload(request: RuntimeServerRequest): ServerRequestPayload {
  return {
    requestId: request.requestId,
    method: request.method,
    threadId: request.threadId ?? undefined,
    turnId: request.turnId ?? undefined,
    itemId: request.itemId ?? undefined,
    kind: request.kind,
    status: request.status,
    reason: request.reason,
    message: request.message,
    command: request.command,
    cwd: request.cwd,
    tool: request.tool,
    namespace: request.namespace,
    serverName: request.serverName,
    patch: request.patch,
    changes: Array.isArray(request.changes) ? request.changes as ServerRequestPayload['changes'] : undefined,
    questions: Array.isArray(request.questions) ? request.questions as ServerRequestPayload['questions'] : undefined,
    permissions: request.permissions,
    availableDecisions: Array.isArray(request.availableDecisions)
      ? request.availableDecisions as ServerRequestPayload['availableDecisions']
      : undefined,
    createdAt: request.createdAt,
    responseSchema: undefined,
    requestedSchema: request.requestedSchema ?? undefined,
    arguments: request.arguments,
    mode: request.mode,
    url: request.url,
    elicitationId: request.elicitationId,
    meta: request.meta,
    raw: request.raw,
  };
}

export function restoreServerRequestRecord(record: PersistedServerRequestRecord): RuntimeServerRequest | null {
  const payload = readPersistedPayload(record);
  const requestId = typeof payload?.requestId === 'string' ? payload.requestId : record.requestId;
  const method = resolveServerRequestMethod(payload?.method, record.method);
  if (!requestId || !method) {
    return null;
  }

  return {
    requestId,
    rawRequestId: readRawRequestId(payload?.rawRequestId, record.rawRequestId, requestId),
    method,
    kind: readRequiredString(payload?.kind, record.kind, 'unknown'),
    status: payload?.status === 'submitting' ? 'submitting' : 'pending',
    createdAt: typeof payload?.createdAt === 'number' ? payload.createdAt : record.createdAt,
    submittedAt: readNullableNumber(payload?.submittedAt, record.submittedAt),
    threadId: readNullableString(payload?.threadId, record.threadId),
    turnId: readNullableString(payload?.turnId, record.turnId),
    itemId: readNullableString(payload?.itemId, record.itemId),
    reason: readOptionalString(payload?.reason, record.reason),
    message: readOptionalString(payload?.message, record.message),
    command: readOptionalString(payload?.command, record.command),
    cwd: readOptionalString(payload?.cwd, record.cwd),
    patch: readOptionalString(payload?.patch, record.patch),
    changes: Array.isArray(payload?.changes) ? payload.changes : record.changes,
    permissions: payload?.permissions ?? record.permissions,
    availableDecisions: Array.isArray(payload?.availableDecisions) ? payload.availableDecisions : record.availableDecisions,
    questions: Array.isArray(payload?.questions) ? payload.questions : record.questions,
    tool: readOptionalString(payload?.tool, record.tool),
    namespace: readOptionalString(payload?.namespace, record.namespace),
    arguments: isPlainObject(payload?.arguments) ? payload.arguments : record.arguments,
    serverName: readOptionalString(payload?.serverName, record.serverName),
    mode: readOptionalString(payload?.mode, record.mode),
    url: readOptionalString(payload?.url, record.url),
    elicitationId: readOptionalString(payload?.elicitationId, record.elicitationId),
    requestedSchema: isPlainObject(payload?.requestedSchema)
      ? payload.requestedSchema as Record<string, unknown>
      : record.requestedSchema ?? null,
    meta: payload?.meta ?? record.meta,
    raw: isPlainObject(payload?.raw) ? payload.raw : record.raw,
    payloadJson: record.payloadJson,
  };
}

function mapCommandExecutionApproval(
  requestId: string,
  rawRequestId: string | number,
  createdAt: number,
  params: v2.CommandExecutionRequestApprovalParams,
): RuntimeServerRequest {
  return {
    requestId,
    rawRequestId,
    method: 'item/commandExecution/requestApproval',
    kind: 'command_approval',
    status: 'pending',
    createdAt,
    submittedAt: null,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: params.reason || '',
    command: params.command || summarizeCommandActions(params.commandActions),
    cwd: params.cwd || '',
    permissions: params.additionalPermissions ?? null,
    availableDecisions: params.availableDecisions || [],
    raw: toRecord(params),
  };
}

function mapLegacyPatchApproval(
  requestId: string,
  rawRequestId: string | number,
  createdAt: number,
  params: ApplyPatchApprovalParams,
): RuntimeServerRequest {
  const changes = Object.entries(params.fileChanges || {}).map(([path, change]) => ({
    path,
    ...change,
  }));
  return {
    requestId,
    rawRequestId,
    method: 'applyPatchApproval',
    kind: 'file_change_approval',
    status: 'pending',
    createdAt,
    submittedAt: null,
    threadId: params.conversationId,
    turnId: null,
    itemId: params.callId,
    reason: params.reason || '',
    changes,
    raw: toRecord(params),
  };
}

function mapLegacyExecApproval(
  requestId: string,
  rawRequestId: string | number,
  createdAt: number,
  params: ExecCommandApprovalParams,
): RuntimeServerRequest {
  return {
    requestId,
    rawRequestId,
    method: 'execCommandApproval',
    kind: 'command_approval',
    status: 'pending',
    createdAt,
    submittedAt: null,
    threadId: params.conversationId,
    turnId: null,
    itemId: params.callId,
    reason: params.reason || '',
    command: Array.isArray(params.command) ? params.command.join(' ') : '',
    cwd: params.cwd,
    raw: toRecord(params),
  };
}

function summarizeCommandActions(actions: v2.CommandAction[] | null | undefined): string {
  if (!Array.isArray(actions) || !actions.length) {
    return '';
  }
  return actions.map((action) => action.command).filter(Boolean).join(' && ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPersistedPayload(record: PersistedServerRequestRecord): Record<string, unknown> | null {
  if (typeof record.payloadJson !== 'string' || !record.payloadJson.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(record.payloadJson);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveServerRequestMethod(
  payloadMethod: unknown,
  fallbackMethod: string,
): ServerRequest['method'] | null {
  const method = typeof payloadMethod === 'string'
    ? payloadMethod
    : fallbackMethod;
  if (!method) {
    return null;
  }
  return method as ServerRequest['method'];
}

function readOptionalString(primary: unknown, fallback: unknown): string | undefined {
  if (typeof primary === 'string') {
    return primary;
  }
  if (typeof fallback === 'string') {
    return fallback;
  }
  return undefined;
}

function readNullableString(primary: unknown, fallback: unknown): string | null {
  if (typeof primary === 'string') {
    return primary;
  }
  if (primary === null) {
    return null;
  }
  if (typeof fallback === 'string') {
    return fallback;
  }
  if (fallback === null) {
    return null;
  }
  return null;
}

function readRequiredString(primary: unknown, fallback: unknown, defaultValue: string): string {
  if (typeof primary === 'string' && primary) {
    return primary;
  }
  if (typeof fallback === 'string' && fallback) {
    return fallback;
  }
  return defaultValue;
}

function readNullableNumber(primary: unknown, fallback: unknown): number | null {
  if (typeof primary === 'number' && Number.isFinite(primary)) {
    return primary;
  }
  if (primary === null) {
    return null;
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return fallback;
  }
  if (fallback === null) {
    return null;
  }
  return null;
}

function readRawRequestId(primary: unknown, fallback: unknown, requestId: string): string | number {
  if (typeof primary === 'string' || typeof primary === 'number') {
    return primary;
  }
  if (typeof fallback === 'string' || typeof fallback === 'number') {
    return fallback;
  }
  return requestId;
}

function toRecord<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled server request method: ${(value as ServerRequest).method}`);
}
