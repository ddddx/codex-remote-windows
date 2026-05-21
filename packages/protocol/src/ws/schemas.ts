import { z } from 'zod';

const attachmentSchema = z.object({
  path: z.string(),
  name: z.string().optional(),
});

const serverRequestDecisionSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
]);

const fileChangeSchema = z.object({
  path: z.string().optional(),
  kind: z.string().optional(),
  addedLines: z.number().optional(),
  deletedLines: z.number().optional(),
  diff: z.string().optional(),
});

const approvalQuestionOptionSchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
});

const approvalQuestionSchema = z.object({
  id: z.string().optional(),
  question: z.string().optional(),
  header: z.string().optional(),
  isOther: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  options: z.array(approvalQuestionOptionSchema).optional(),
});

const serverRequestSchema = z.object({
  requestId: z.string(),
  method: z.string().optional(),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  itemId: z.string().optional(),
  kind: z.string().optional(),
  status: z.enum(['pending', 'submitting']).optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  tool: z.string().optional(),
  namespace: z.string().optional(),
  serverName: z.string().optional(),
  patch: z.string().optional(),
  changes: z.array(fileChangeSchema).optional(),
  questions: z.array(approvalQuestionSchema).optional(),
  permissions: z.unknown().optional(),
  availableDecisions: z.array(serverRequestDecisionSchema).optional(),
  createdAt: z.number().optional(),
  responseSchema: z.unknown().optional(),
  requestedSchema: z.unknown().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  mode: z.string().optional(),
  url: z.string().optional(),
  elicitationId: z.string().optional(),
  meta: z.unknown().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tab_create'),
    name: z.string().optional(),
    cwd: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
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
    type: z.literal('command_send'),
    threadId: z.string(),
    text: z.string(),
    clientMessageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('thread_sync'),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal('thread_options_update'),
    threadId: z.string(),
    model: z.string().optional(),
    effort: z.string().optional(),
    approvalPolicy: z.string().optional(),
    sandboxMode: z.string().optional(),
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
    serverRequests: z.array(serverRequestSchema),
    globalSupplementalItems: z.array(z.unknown()),
  }),
  z.object({
    type: z.literal('server_request_required'),
    request: serverRequestSchema,
  }),
  z.object({
    type: z.literal('server_request_updated'),
    request: serverRequestSchema,
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
    completedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('item_delta'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    method: z.string().optional(),
    delta: z.string().optional(),
    patch: z.string().optional(),
    changes: z.array(fileChangeSchema).optional(),
    part: z.unknown().optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('thread_event'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    method: z.string(),
    params: z.unknown().optional(),
    message: z.string().optional(),
    delta: z.string().optional(),
    status: z.string().optional(),
    createdAt: z.number().optional(),
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
    type: z.literal('model_rerouted'),
    threadId: z.string(),
    turnId: z.string().optional(),
    fromModel: z.string(),
    toModel: z.string(),
    reason: z.unknown().optional(),
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
