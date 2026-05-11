import { createPendingRequestRecord } from '@codex-remote/domain';
import type { FastifyInstance } from 'fastify';

export type RuntimeServerRequest = {
  requestId: string;
  rawRequestId: string | number;
  method: string;
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

export function createServerRequestRecord(msg: {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}): RuntimeServerRequest {
  const params = msg.params || {};
  const requestId = String(msg.id);

  if (msg.method === 'item/commandExecution/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'command_approval',
      status: 'pending',
      createdAt: Date.now(),
      submittedAt: null,
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      reason: typeof params.reason === 'string' ? params.reason : '',
      command: typeof params.command === 'string' ? params.command : '',
      cwd: typeof params.cwd === 'string' ? params.cwd : '',
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/fileChange/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'file_change_approval',
      status: 'pending',
      createdAt: Date.now(),
      submittedAt: null,
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      reason: typeof params.reason === 'string' ? params.reason : '',
      patch: typeof params.patch === 'string' ? params.patch : '',
      changes: Array.isArray(params.changes) ? params.changes : [],
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/permissions/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'permissions_approval',
      status: 'pending',
      createdAt: Date.now(),
      submittedAt: null,
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      reason: typeof params.reason === 'string' ? params.reason : '',
      cwd: typeof params.cwd === 'string' ? params.cwd : '',
      permissions: params.permissions ?? null,
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/tool/requestUserInput') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'user_input',
      status: 'pending',
      createdAt: Date.now(),
      submittedAt: null,
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.itemId === 'string' ? params.itemId : null,
      questions: Array.isArray(params.questions) ? params.questions : [],
      raw: params,
    };
  }

  if (msg.method === 'item/tool/call') {
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'dynamic_tool_call',
      status: 'pending',
      createdAt: Date.now(),
      submittedAt: null,
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: typeof params.callId === 'string' ? params.callId : null,
      tool: typeof params.tool === 'string' ? params.tool : '',
      namespace: typeof params.namespace === 'string' ? params.namespace : '',
      arguments: params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {},
      raw: params,
    };
  }

  if (msg.method === 'mcpServer/elicitation/request') {
    const mode = params.mode === 'url' ? 'url' : 'form';
    return {
      requestId,
      rawRequestId: msg.id,
      method: msg.method,
      kind: 'mcp_server_elicitation',
      status: 'pending',
      createdAt: Date.now(),
      submittedAt: null,
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      turnId: typeof params.turnId === 'string' ? params.turnId : null,
      itemId: null,
      serverName: typeof params.serverName === 'string' ? params.serverName : '',
      message: typeof params.message === 'string' ? params.message : '',
      mode,
      url: mode === 'url' && typeof params.url === 'string' ? params.url : '',
      elicitationId: mode === 'url' && typeof params.elicitationId === 'string' ? params.elicitationId : '',
      requestedSchema: mode === 'form' && params.requestedSchema && typeof params.requestedSchema === 'object'
        ? params.requestedSchema as Record<string, unknown>
        : null,
      meta: Object.prototype.hasOwnProperty.call(params, '_meta') ? params._meta : null,
      raw: params,
    };
  }

  return {
    requestId,
    rawRequestId: msg.id,
    method: msg.method,
    kind: 'unknown',
    status: 'pending',
    createdAt: Date.now(),
    submittedAt: null,
    threadId: typeof params.threadId === 'string' ? params.threadId : null,
    turnId: typeof params.turnId === 'string' ? params.turnId : null,
    itemId: typeof params.itemId === 'string' ? params.itemId : null,
    raw: params,
  };
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
