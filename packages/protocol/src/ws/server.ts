import type { ServerRequest as CodexServerRequest } from '@codex-remote/codex-app-server-types';

export type FileChangePayload = {
  path?: string;
  kind?: string;
  addedLines?: number;
  deletedLines?: number;
  diff?: string;
};

export type ApprovalQuestionOptionPayload = {
  label?: string;
  description?: string;
};

export type ApprovalQuestionPayload = {
  id?: string;
  question?: string;
  header?: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: ApprovalQuestionOptionPayload[];
};

export type ServerRequestPayload = {
  requestId: string;
  method?: CodexServerRequest['method'];
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
  changes?: FileChangePayload[];
  questions?: ApprovalQuestionPayload[];
  permissions?: unknown;
  availableDecisions?: Array<string | Record<string, unknown>>;
  createdAt?: number;
  responseSchema?: unknown;
  requestedSchema?: unknown;
  arguments?: Record<string, unknown>;
  mode?: string;
  url?: string;
  elicitationId?: string;
  meta?: unknown;
  raw?: Record<string, unknown>;
};

export type ServerMessage =
  | { type: 'state'; tabs: unknown[]; serverRequests: ServerRequestPayload[]; globalSupplementalItems: unknown[] }
  | { type: 'server_request_required'; request: ServerRequestPayload }
  | { type: 'server_request_updated'; request: ServerRequestPayload }
  | { type: 'server_request_resolved'; requestId: string; threadId?: string }
  | { type: 'server_request_reset' }
  | { type: 'tab_updated'; tab: unknown }
  | { type: 'tab_created'; threadId: string; tab?: unknown }
  | { type: 'tab_removed'; threadId: string }
  | { type: 'unread'; threadId: string }
  | { type: 'thread_sync'; threadId: string; turns?: unknown[]; supplementalItems?: unknown[]; globalSupplementalItems?: unknown[]; tokenUsage?: unknown; turnPlans?: unknown[]; turnDiffs?: unknown[]; timelineEvents?: unknown[] }
  | { type: 'turn_started'; threadId: string; turnId?: string; startedAt?: number }
  | { type: 'turn_completed'; threadId: string; turnId?: string }
  | { type: 'turn_plan_updated'; threadId: string; turnId?: string; explanation?: string; plan?: unknown[] }
  | { type: 'turn_diff_updated'; threadId: string; turnId?: string; diff?: unknown }
  | { type: 'hook_started'; threadId: string; turnId?: string; run?: unknown }
  | { type: 'hook_completed'; threadId: string; turnId?: string; run?: unknown }
  | { type: 'guardian_review_started'; threadId: string; turnId?: string }
  | { type: 'guardian_review_completed'; threadId: string; turnId?: string }
  | { type: 'plan_delta'; threadId: string; turnId?: string; itemId?: string; delta?: string; startedAt?: number }
  | { type: 'agent_delta'; threadId: string; turnId?: string; itemId?: string; delta?: string; startedAt?: number }
  | { type: 'mcp_tool_progress'; threadId: string; turnId?: string; itemId?: string; message?: string; startedAt?: number }
  | { type: 'item_started'; threadId: string; turnId?: string; item?: unknown; startedAt?: number }
  | { type: 'item_completed'; threadId: string; turnId?: string; item?: unknown; completedAt?: number }
  | { type: 'item_delta'; threadId: string; turnId?: string; itemId?: string; method?: string; delta?: string; patch?: string; changes?: unknown[]; part?: unknown; startedAt?: number }
  | { type: 'thread_event'; threadId: string; turnId?: string; itemId?: string; method: string; params?: unknown; message?: string; delta?: string; status?: string; createdAt?: number }
  | { type: 'codex_error'; threadId?: string; error?: unknown }
  | { type: 'backend_error'; message: string }
  | { type: 'error'; message: string; code?: string; op?: string; threadId?: string; clientMessageId?: string }
  | { type: 'token_usage'; threadId: string; usage: unknown }
  | { type: 'model_rerouted'; threadId: string; turnId?: string; fromModel: string; toModel: string; reason?: unknown }
  | { type: 'warning'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string }
  | { type: 'error_notice'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string }
  | { type: 'notification'; method: string; params: unknown };
