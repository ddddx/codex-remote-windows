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
