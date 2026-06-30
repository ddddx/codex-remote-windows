import test from 'node:test';
import assert from 'node:assert/strict';
import { clientMessageSchema, serverMessageSchema } from '../src/ws/schemas.js';

test('client message schema accepts turn_send payload', () => {
  const result = clientMessageSchema.safeParse({
    type: 'turn_send',
    threadId: 'thread-1',
    text: 'hello',
    attachments: [{ path: 'C:\\workspace\\image.png', name: 'image.png' }],
  });

  assert.equal(result.success, true);
});

test('client message schema rejects turn_send without attachments array', () => {
  const result = clientMessageSchema.safeParse({
    type: 'turn_send',
    threadId: 'thread-1',
    text: 'hello',
  });

  assert.equal(result.success, false);
});

test('client message schema accepts thread_options_update payload', () => {
  const result = clientMessageSchema.safeParse({
    type: 'thread_options_update',
    threadId: 'thread-1',
    model: 'gpt-5.5',
    effort: 'high',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  });

  assert.equal(result.success, true);
});

test('client message schema accepts thread_sync limit', () => {
  const result = clientMessageSchema.safeParse({
    type: 'thread_sync',
    threadId: 'thread-1',
    limit: 20,
  });

  assert.equal(result.success, true);
});

test('server message schema accepts thread_sync payload', () => {
  const result = serverMessageSchema.safeParse({
    type: 'thread_sync',
    threadId: 'thread-1',
    turns: [],
    supplementalItems: [],
    globalSupplementalItems: [],
    tokenUsage: null,
    turnPlans: [],
    turnDiffs: [],
    timelineEvents: [],
  });

  assert.equal(result.success, true);
});

test('server message schema rejects missing required threadId for token usage', () => {
  const result = serverMessageSchema.safeParse({
    type: 'token_usage',
    usage: { totalTokens: 1 },
  });

  assert.equal(result.success, false);
});

test('server message schema accepts generic thread event payloads', () => {
  const result = serverMessageSchema.safeParse({
    type: 'thread_event',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'process-1',
    method: 'process/outputDelta',
    params: { processHandle: 'process-1', deltaBase64: 'aGVsbG8=' },
    delta: 'aGVsbG8=',
    createdAt: 1,
  });

  assert.equal(result.success, true);
});

test('server message schema accepts official method-backed approval payloads', () => {
  const result = serverMessageSchema.safeParse({
    type: 'server_request_required',
    request: {
      requestId: 'req-1',
      method: 'mcpServer/elicitation/request',
      threadId: 'thread-1',
      turnId: 'turn-1',
      kind: 'mcp_server_elicitation',
      status: 'pending',
      mode: 'form',
      requestedSchema: {
        properties: {
          apiKey: { title: 'API Key', type: 'string' },
        },
      },
      raw: {
        serverName: 'docs',
      },
      createdAt: 1,
    },
  });

  assert.equal(result.success, true);
});
