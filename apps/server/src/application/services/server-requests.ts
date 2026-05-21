import { createPendingRequestRecord } from '@codex-remote/domain';
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
    default:
      return assertNever(msg);
  }
}

export function listServerRequests(app: FastifyInstance): unknown[] {
  return Array.from(app.runtimeState.serverRequestsById.values()).sort((left, right) => left.createdAt - right.createdAt);
}

export function persistServerRequest(
  app: FastifyInstance,
  request: {
    requestId: string;
    threadId?: string | null;
    turnId?: string | null;
    itemId?: string | null;
    kind: string;
    method: string;
    status: 'pending' | 'submitting';
    createdAt: number;
    submittedAt?: number | null;
  },
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

function toRecord<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled server request method: ${(value as ServerRequest).method}`);
}
