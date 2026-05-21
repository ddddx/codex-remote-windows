import test from 'node:test';
import assert from 'node:assert/strict';
import {
  restoreServerRequestRecord,
  toServerRequestPayload,
} from '../src/application/services/server-requests.js';

test('restoreServerRequestRecord rebuilds official method-backed request state from payloadJson', () => {
  const restored = restoreServerRequestRecord({
    requestId: 'req-restore-1',
    method: 'mcpServer/elicitation/request',
    kind: 'mcp_server_elicitation',
    status: 'pending',
    createdAt: 10,
    submittedAt: null,
    payloadJson: JSON.stringify({
      requestId: 'req-restore-1',
      rawRequestId: 'raw-restore-1',
      method: 'mcpServer/elicitation/request',
      kind: 'mcp_server_elicitation',
      status: 'pending',
      createdAt: 10,
      threadId: 'thread-restore',
      turnId: 'turn-restore',
      serverName: 'docs',
      mode: 'form',
      requestedSchema: {
        properties: {
          apiKey: { type: 'string' },
        },
      },
      raw: {
        message: 'Need credentials',
      },
    }),
  });

  assert.equal(restored?.method, 'mcpServer/elicitation/request');
  assert.equal(restored?.threadId, 'thread-restore');
  assert.equal(restored?.turnId, 'turn-restore');
  assert.equal(restored?.serverName, 'docs');
  assert.deepEqual(restored?.requestedSchema, {
    properties: {
      apiKey: { type: 'string' },
    },
  });
});

test('toServerRequestPayload strips runtime-only fields and normalizes nulls for websocket clients', () => {
  const payload = toServerRequestPayload({
    requestId: 'req-payload-1',
    rawRequestId: 'raw-payload-1',
    method: 'item/tool/requestUserInput',
    kind: 'user_input',
    status: 'pending',
    createdAt: 1,
    submittedAt: null,
    threadId: 'thread-1',
    turnId: null,
    itemId: 'item-1',
    questions: [{ id: 'q1', question: 'Continue?' }],
    raw: { questions: 1 },
  });

  assert.deepEqual(payload, {
    requestId: 'req-payload-1',
    method: 'item/tool/requestUserInput',
    threadId: 'thread-1',
    turnId: undefined,
    itemId: 'item-1',
    kind: 'user_input',
    status: 'pending',
    reason: undefined,
    message: undefined,
    command: undefined,
    cwd: undefined,
    tool: undefined,
    namespace: undefined,
    serverName: undefined,
    patch: undefined,
    changes: undefined,
    questions: [{ id: 'q1', question: 'Continue?' }],
    permissions: undefined,
    availableDecisions: undefined,
    createdAt: 1,
    responseSchema: undefined,
    requestedSchema: undefined,
    arguments: undefined,
    mode: undefined,
    url: undefined,
    elicitationId: undefined,
    meta: undefined,
    raw: { questions: 1 },
  });
});
