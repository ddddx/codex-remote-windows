import { z } from 'zod';

const attachmentSchema = z.object({
  path: z.string(),
  name: z.string().optional(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tab_create'),
    name: z.string().optional(),
    cwd: z.string().optional(),
    model: z.string().optional(),
    approvalPolicy: z.string().optional(),
    sandboxMode: z.string().optional(),
  }),
  z.object({
    type: z.literal('tab_close'),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal('turn_send'),
    threadId: z.string(),
    text: z.string(),
    attachments: z.array(attachmentSchema),
    clientMessageId: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    approvalPolicy: z.string().optional(),
    sandboxMode: z.string().optional(),
  }),
  z.object({
    type: z.literal('thread_sync'),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal('server_request_respond'),
    requestId: z.string(),
    response: z.unknown(),
  }),
]);

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    tabs: z.array(z.unknown()),
    serverRequests: z.array(z.unknown()),
    globalSupplementalItems: z.array(z.unknown()),
  }),
  z.object({
    type: z.literal('server_request_required'),
    request: z.unknown(),
  }),
  z.object({
    type: z.literal('server_request_updated'),
    request: z.unknown(),
  }),
  z.object({
    type: z.literal('server_request_resolved'),
    requestId: z.string(),
    threadId: z.string().optional(),
  }),
  z.object({ type: z.literal('server_request_reset') }),
  z.object({
    type: z.literal('tab_updated'),
    tab: z.unknown(),
  }),
  z.object({
    type: z.literal('tab_created'),
    threadId: z.string(),
    tab: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('tab_removed'),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal('unread'),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal('thread_sync'),
    threadId: z.string(),
    turns: z.array(z.unknown()).optional(),
    supplementalItems: z.array(z.unknown()).optional(),
    globalSupplementalItems: z.array(z.unknown()).optional(),
    tokenUsage: z.unknown().optional(),
    turnPlans: z.array(z.unknown()).optional(),
    turnDiffs: z.array(z.unknown()).optional(),
    timelineEvents: z.array(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('turn_started'),
    threadId: z.string(),
    turnId: z.string().optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('turn_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
  }),
  z.object({
    type: z.literal('turn_plan_updated'),
    threadId: z.string(),
    turnId: z.string().optional(),
    explanation: z.string().optional(),
    plan: z.array(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('turn_diff_updated'),
    threadId: z.string(),
    turnId: z.string().optional(),
    diff: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('hook_started'),
    threadId: z.string(),
    turnId: z.string().optional(),
    run: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('hook_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
    run: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('guardian_review_started'),
    threadId: z.string(),
    turnId: z.string().optional(),
  }),
  z.object({
    type: z.literal('guardian_review_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
  }),
  z.object({
    type: z.literal('plan_delta'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    delta: z.string().optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('agent_delta'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    delta: z.string().optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('mcp_tool_progress'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    message: z.string().optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('item_started'),
    threadId: z.string(),
    turnId: z.string().optional(),
    item: z.unknown().optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('item_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
    item: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('item_delta'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    method: z.string().optional(),
    delta: z.string().optional(),
    patch: z.string().optional(),
    changes: z.array(z.unknown()).optional(),
    part: z.unknown().optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('codex_error'),
    threadId: z.string().optional(),
    error: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('backend_error'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
    op: z.string().optional(),
    threadId: z.string().optional(),
    clientMessageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('token_usage'),
    threadId: z.string(),
    usage: z.unknown(),
  }),
  z.object({
    type: z.literal('warning'),
    message: z.string(),
    threadId: z.string().optional(),
    noticeId: z.string().optional(),
    createdAt: z.number().optional(),
    noticeKind: z.string().optional(),
  }),
  z.object({
    type: z.literal('error_notice'),
    message: z.string(),
    threadId: z.string().optional(),
    noticeId: z.string().optional(),
    createdAt: z.number().optional(),
    noticeKind: z.string().optional(),
  }),
  z.object({
    type: z.literal('notification'),
    method: z.string(),
    params: z.unknown(),
  }),
]);

export type ClientMessageSchema = z.infer<typeof clientMessageSchema>;
export type ServerMessageSchema = z.infer<typeof serverMessageSchema>;
