import type {
  ServerRequest as CodexServerRequest,
  v2,
} from '@codex-remote/codex-app-server-types';
import type { JsonValue } from '@codex-remote/codex-app-server-types/generated/serde_json/JsonValue';

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

export type TokenUsagePayload = v2.ThreadTokenUsage | Record<string, unknown> | null;
export type GuardedRecord = Record<string, unknown>;
export type JsonObject = Record<string, JsonValue>;
export type ThreadItemPayload = v2.ThreadItem;
export type GuardianReviewPayload = v2.GuardianApprovalReview;
export type GuardianActionPayload = v2.GuardianApprovalReviewAction;
export type DynamicToolContentItemPayload = v2.DynamicToolCallOutputContentItem;

export type SessionTabPayload = {
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

export type TurnPlanStepPayload = {
  step?: string;
  status?: string;
};

export type TurnPlanPayload = {
  turnId: string;
  explanation: string;
  plan: TurnPlanStepPayload[];
  updatedAt: number;
};

export type TurnDiffPayload = {
  turnId: string;
  diff: string;
  updatedAt: number;
};

export type HookRunPayload = {
  id: string;
  eventName?: string;
  handlerType?: string;
  executionMode?: string;
  scope?: string;
  sourcePath?: string;
  source?: string;
  displayOrder?: number;
  status?: string;
  statusMessage?: string | null;
  startedAt?: number;
  completedAt?: number | null;
  durationMs?: number | null;
  command?: string;
  exitCode?: number | null;
  entries?: Array<Record<string, unknown>>;
};

export type SupplementalItemPayload =
  | {
      id: string;
      type: 'hookEvent';
      _turnId?: string | null;
      phase?: string;
      status?: string;
      run?: HookRunPayload;
      createdAt?: number;
      updatedAt?: number;
      startedAt?: number;
      completedAt?: number | null;
    }
  | {
      id: string;
      type: 'guardianReview';
      _turnId?: string | null;
      phase?: string;
      status?: string;
      review?: GuardianReviewPayload | null;
      action?: GuardianActionPayload | null;
      targetItemId?: string | null;
      decisionSource?: string | null;
      createdAt?: number;
      updatedAt?: number;
      startedAt?: number;
      completedAt?: number | null;
    }
  | {
      id: string;
      type: 'pendingUserMessage';
      _turnId?: string | null;
      entryId?: string;
      status?: string;
      text?: unknown;
      content?: unknown;
      input?: unknown;
      message?: unknown;
      createdAt?: number;
      updatedAt?: number;
      startedAt?: number;
      completedAt?: number | null;
    };

export type GlobalSupplementalItemPayload = {
  id: string;
  type: string;
  text: string;
  noticeKind?: string;
  threadId?: string;
  createdAt: number;
};

export type ThreadTurnPayload = Pick<v2.Turn, 'id' | 'items' | 'status' | 'startedAt' | 'completedAt' | 'durationMs'> & {
  input?: unknown;
  output?: unknown;
  text?: string;
  summary?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type TimelineThreadEventParams = JsonValue | Record<string, unknown>;

export type TimelineEventPayload =
  | { type: 'turn_started'; threadId: string; turnId?: string; startedAt?: number }
  | { type: 'turn_completed'; threadId: string; turnId?: string }
  | { type: 'turn_plan_updated'; threadId: string; turnId?: string; explanation?: string; plan?: TurnPlanStepPayload[] }
  | { type: 'turn_diff_updated'; threadId: string; turnId?: string; diff?: string | Record<string, unknown> }
  | { type: 'hook_started'; threadId: string; turnId?: string; run?: HookRunPayload }
  | { type: 'hook_completed'; threadId: string; turnId?: string; run?: HookRunPayload }
  | { type: 'guardian_review_started'; threadId: string; turnId?: string }
  | { type: 'guardian_review_completed'; threadId: string; turnId?: string }
  | { type: 'plan_delta'; threadId: string; turnId?: string; itemId?: string; delta?: string; startedAt?: number }
  | { type: 'agent_delta'; threadId: string; turnId?: string; itemId?: string; delta?: string; startedAt?: number }
  | { type: 'mcp_tool_progress'; threadId: string; turnId?: string; itemId?: string; message?: string; startedAt?: number }
  | { type: 'item_started'; threadId: string; turnId?: string; item?: ThreadItemPayload; startedAt?: number }
  | { type: 'item_completed'; threadId: string; turnId?: string; item?: ThreadItemPayload; completedAt?: number }
  | {
      type: 'item_delta';
      threadId: string;
      turnId?: string;
      itemId?: string;
      method?: string;
      delta?: string;
      patch?: string;
      changes?: FileChangePayload[];
      part?: JsonValue | Record<string, unknown>;
      startedAt?: number;
    }
  | {
      type: 'thread_event';
      threadId: string;
      turnId?: string;
      itemId?: string;
      method: string;
      params?: TimelineThreadEventParams;
      message?: string;
      delta?: string;
      status?: string;
      createdAt?: number;
    }
  | { type: 'codex_error'; threadId?: string; error?: unknown }
  | { type: 'token_usage'; threadId: string; usage: TokenUsagePayload }
  | { type: 'model_rerouted'; threadId: string; turnId?: string; fromModel: string; toModel: string; reason?: string | GuardedRecord }
  | { type: 'warning'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string }
  | { type: 'error_notice'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string };

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
  arguments?: GuardedRecord;
  mode?: string;
  url?: string;
  elicitationId?: string;
  meta?: unknown;
  raw?: GuardedRecord;
};

export type ServerMessage =
  | { type: 'state'; tabs: SessionTabPayload[]; serverRequests: ServerRequestPayload[]; globalSupplementalItems: GlobalSupplementalItemPayload[] }
  | { type: 'server_request_required'; request: ServerRequestPayload }
  | { type: 'server_request_updated'; request: ServerRequestPayload }
  | { type: 'server_request_resolved'; requestId: string; threadId?: string }
  | { type: 'server_request_reset' }
  | { type: 'tab_updated'; tab: SessionTabPayload }
  | { type: 'tab_created'; threadId: string; tab?: SessionTabPayload }
  | { type: 'tab_removed'; threadId: string }
  | { type: 'unread'; threadId: string }
  | {
      type: 'thread_sync';
      threadId: string;
      turns?: ThreadTurnPayload[];
      supplementalItems?: SupplementalItemPayload[];
      globalSupplementalItems?: GlobalSupplementalItemPayload[];
      tokenUsage?: TokenUsagePayload;
      turnPlans?: TurnPlanPayload[];
      turnDiffs?: TurnDiffPayload[];
      timelineEvents?: TimelineEventPayload[];
    }
  | { type: 'turn_started'; threadId: string; turnId?: string; startedAt?: number }
  | { type: 'turn_completed'; threadId: string; turnId?: string }
  | { type: 'turn_plan_updated'; threadId: string; turnId?: string; explanation?: string; plan?: TurnPlanStepPayload[] }
  | { type: 'turn_diff_updated'; threadId: string; turnId?: string; diff?: string | Record<string, unknown> }
  | { type: 'hook_started'; threadId: string; turnId?: string; run?: HookRunPayload }
  | { type: 'hook_completed'; threadId: string; turnId?: string; run?: HookRunPayload }
  | { type: 'guardian_review_started'; threadId: string; turnId?: string }
  | { type: 'guardian_review_completed'; threadId: string; turnId?: string }
  | { type: 'plan_delta'; threadId: string; turnId?: string; itemId?: string; delta?: string; startedAt?: number }
  | { type: 'agent_delta'; threadId: string; turnId?: string; itemId?: string; delta?: string; startedAt?: number }
  | { type: 'mcp_tool_progress'; threadId: string; turnId?: string; itemId?: string; message?: string; startedAt?: number }
  | { type: 'item_started'; threadId: string; turnId?: string; item?: ThreadItemPayload; startedAt?: number }
  | { type: 'item_completed'; threadId: string; turnId?: string; item?: ThreadItemPayload; completedAt?: number }
  | {
      type: 'item_delta';
      threadId: string;
      turnId?: string;
      itemId?: string;
      method?: string;
      delta?: string;
      patch?: string;
      changes?: FileChangePayload[];
      part?: JsonValue | Record<string, unknown>;
      startedAt?: number;
    }
  | {
      type: 'thread_event';
      threadId: string;
      turnId?: string;
      itemId?: string;
      method: string;
      params?: TimelineThreadEventParams;
      message?: string;
      delta?: string;
      status?: string;
      createdAt?: number;
    }
  | { type: 'codex_error'; threadId?: string; error?: unknown }
  | { type: 'backend_error'; message: string }
  | { type: 'error'; message: string; code?: string; op?: string; threadId?: string; clientMessageId?: string }
  | { type: 'token_usage'; threadId: string; usage: TokenUsagePayload }
  | { type: 'model_rerouted'; threadId: string; turnId?: string; fromModel: string; toModel: string; reason?: string | GuardedRecord }
  | { type: 'warning'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string }
  | { type: 'error_notice'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string }
  | { type: 'notification'; method: string; params: unknown };
