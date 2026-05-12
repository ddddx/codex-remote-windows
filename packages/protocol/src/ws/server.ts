export type ServerMessage =
  | { type: 'state'; tabs: unknown[]; serverRequests: unknown[]; globalSupplementalItems: unknown[] }
  | { type: 'server_request_required'; request: unknown }
  | { type: 'server_request_updated'; request: unknown }
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
  | { type: 'item_completed'; threadId: string; turnId?: string; item?: unknown }
  | { type: 'item_delta'; threadId: string; turnId?: string; itemId?: string; method?: string; delta?: string; patch?: string; changes?: unknown[]; part?: unknown; startedAt?: number }
  | { type: 'codex_error'; threadId?: string; error?: unknown }
  | { type: 'backend_error'; message: string }
  | { type: 'error'; message: string; code?: string; op?: string; threadId?: string; clientMessageId?: string }
  | { type: 'token_usage'; threadId: string; usage: unknown }
  | { type: 'warning'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string }
  | { type: 'error_notice'; message: string; threadId?: string; noticeId?: string; createdAt?: number; noticeKind?: string }
  | { type: 'notification'; method: string; params: unknown };
