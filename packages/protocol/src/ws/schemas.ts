import { z } from 'zod';

const attachmentSchema = z.object({
  path: z.string(),
  name: z.string().optional(),
});

const jsonSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(jsonSchema),
  z.record(z.string(), jsonSchema),
]));

const recordSchema = z.record(z.string(), jsonSchema);

const serverRequestDecisionSchema = z.union([
  z.string(),
  recordSchema,
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

const tokenUsageBreakdownSchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
});

const threadTokenUsageSchema = z.object({
  total: tokenUsageBreakdownSchema,
  last: tokenUsageBreakdownSchema,
  modelContextWindow: z.number().nullable(),
});

const tokenUsagePayloadSchema = z.union([
  threadTokenUsageSchema,
  recordSchema,
  z.null(),
]);

const sessionTabSchema = z.object({
  threadId: z.string(),
  name: z.string(),
  cwd: z.string().optional(),
  status: z.string().optional(),
  windowStatus: z.string().optional(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  tokenUsage: tokenUsagePayloadSchema.optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

const turnPlanStepSchema = z.object({
  step: z.string().optional(),
  status: z.string().optional(),
});

const turnPlanSchema = z.object({
  turnId: z.string(),
  explanation: z.string(),
  plan: z.array(turnPlanStepSchema),
  updatedAt: z.number(),
});

const turnDiffSchema = z.object({
  turnId: z.string(),
  diff: z.string(),
  updatedAt: z.number(),
});

const hookRunSchema = z.object({
  id: z.string(),
  eventName: z.string().optional(),
  handlerType: z.string().optional(),
  executionMode: z.string().optional(),
  scope: z.string().optional(),
  sourcePath: z.string().optional(),
  source: z.string().optional(),
  displayOrder: z.number().optional(),
  status: z.string().optional(),
  statusMessage: z.string().nullable().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  command: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  entries: z.array(recordSchema).optional(),
});

const supplementalItemSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('hookEvent'),
    _turnId: z.string().nullable().optional(),
    phase: z.string().optional(),
    status: z.string().optional(),
    run: hookRunSchema.optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().nullable().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('guardianReview'),
    _turnId: z.string().nullable().optional(),
    phase: z.string().optional(),
    status: z.string().optional(),
    review: recordSchema.nullable().optional(),
    action: recordSchema.nullable().optional(),
    targetItemId: z.string().nullable().optional(),
    decisionSource: z.string().nullable().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().nullable().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('pendingUserMessage'),
    _turnId: z.string().nullable().optional(),
    entryId: z.string().optional(),
    status: z.string().optional(),
    text: jsonSchema.optional(),
    content: jsonSchema.optional(),
    input: jsonSchema.optional(),
    message: jsonSchema.optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().nullable().optional(),
  }),
]);

const globalSupplementalItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string(),
  noticeKind: z.string().optional(),
  threadId: z.string().optional(),
  createdAt: z.number(),
});

const threadItemSchema: z.ZodType<unknown> = z.object({
  id: z.string().optional(),
  type: z.string(),
}).catchall(jsonSchema);

const threadTurnSchema = z.object({
  id: z.string(),
  items: z.array(threadItemSchema),
  status: z.string(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  input: jsonSchema.optional(),
  output: jsonSchema.optional(),
  text: z.string().optional(),
  summary: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

const timelineEventSchema = z.discriminatedUnion('type', [
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
    plan: z.array(turnPlanStepSchema).optional(),
  }),
  z.object({
    type: z.literal('turn_diff_updated'),
    threadId: z.string(),
    turnId: z.string().optional(),
    diff: z.union([z.string(), recordSchema]).optional(),
  }),
  z.object({
    type: z.literal('hook_started'),
    threadId: z.string(),
    turnId: z.string().optional(),
    run: hookRunSchema.optional(),
  }),
  z.object({
    type: z.literal('hook_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
    run: hookRunSchema.optional(),
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
    item: threadItemSchema.optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('item_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
    item: threadItemSchema.optional(),
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
    part: z.union([jsonSchema, recordSchema]).optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('thread_event'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    method: z.string(),
    params: z.union([jsonSchema, recordSchema]).optional(),
    message: z.string().optional(),
    delta: z.string().optional(),
    status: z.string().optional(),
    createdAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('codex_error'),
    threadId: z.string().optional(),
    error: jsonSchema.optional(),
  }),
  z.object({
    type: z.literal('token_usage'),
    threadId: z.string(),
    usage: tokenUsagePayloadSchema,
  }),
  z.object({
    type: z.literal('model_rerouted'),
    threadId: z.string(),
    turnId: z.string().optional(),
    fromModel: z.string(),
    toModel: z.string(),
    reason: z.union([z.string(), recordSchema]).optional(),
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
]);
const sequencedTimelineEventSchema = timelineEventSchema.and(z.object({
  sequence: z.number().optional(),
}));

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
  permissions: jsonSchema.optional(),
  availableDecisions: z.array(serverRequestDecisionSchema).optional(),
  createdAt: z.number().optional(),
  responseSchema: jsonSchema.optional(),
  requestedSchema: jsonSchema.optional(),
  arguments: recordSchema.optional(),
  mode: z.string().optional(),
  url: z.string().optional(),
  elicitationId: z.string().optional(),
  meta: jsonSchema.optional(),
  raw: recordSchema.optional(),
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
    limit: z.number().optional(),
  }),
  z.object({
    type: z.literal('thread_history_load'),
    threadId: z.string(),
    cursor: z.string().nullable().optional(),
    limit: z.number().optional(),
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
    response: jsonSchema,
  }),
]);

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    tabs: z.array(sessionTabSchema),
    serverRequests: z.array(serverRequestSchema),
    globalSupplementalItems: z.array(globalSupplementalItemSchema),
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
    tab: sessionTabSchema,
  }),
  z.object({
    type: z.literal('tab_created'),
    threadId: z.string(),
    tab: sessionTabSchema.optional(),
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
    turns: z.array(threadTurnSchema).optional(),
    supplementalItems: z.array(supplementalItemSchema).optional(),
    globalSupplementalItems: z.array(globalSupplementalItemSchema).optional(),
    tokenUsage: tokenUsagePayloadSchema.optional(),
    turnPlans: z.array(turnPlanSchema).optional(),
    turnDiffs: z.array(turnDiffSchema).optional(),
    timelineEvents: z.array(sequencedTimelineEventSchema).optional(),
    historyCursor: z.string().nullable().optional(),
    hasMoreHistory: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('thread_history'),
    threadId: z.string(),
    turns: z.array(threadTurnSchema).optional(),
    turnPlans: z.array(turnPlanSchema).optional(),
    turnDiffs: z.array(turnDiffSchema).optional(),
    historyCursor: z.string().nullable().optional(),
    hasMoreHistory: z.boolean().optional(),
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
    plan: z.array(turnPlanStepSchema).optional(),
  }),
  z.object({
    type: z.literal('turn_diff_updated'),
    threadId: z.string(),
    turnId: z.string().optional(),
    diff: z.union([z.string(), recordSchema]).optional(),
  }),
  z.object({
    type: z.literal('hook_started'),
    threadId: z.string(),
    turnId: z.string().optional(),
    run: hookRunSchema.optional(),
  }),
  z.object({
    type: z.literal('hook_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
    run: hookRunSchema.optional(),
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
    item: threadItemSchema.optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('item_completed'),
    threadId: z.string(),
    turnId: z.string().optional(),
    item: threadItemSchema.optional(),
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
    part: z.union([jsonSchema, recordSchema]).optional(),
    startedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('thread_event'),
    threadId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    method: z.string(),
    params: z.union([jsonSchema, recordSchema]).optional(),
    message: z.string().optional(),
    delta: z.string().optional(),
    status: z.string().optional(),
    createdAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('codex_error'),
    threadId: z.string().optional(),
    error: jsonSchema.optional(),
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
    usage: tokenUsagePayloadSchema,
  }),
  z.object({
    type: z.literal('model_rerouted'),
    threadId: z.string(),
    turnId: z.string().optional(),
    fromModel: z.string(),
    toModel: z.string(),
    reason: z.union([z.string(), recordSchema]).optional(),
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
    params: jsonSchema,
  }),
]);

export type ClientMessageSchema = z.infer<typeof clientMessageSchema>;
export type ServerMessageSchema = z.infer<typeof serverMessageSchema>;
