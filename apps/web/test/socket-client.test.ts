import test from 'node:test';
import assert from 'node:assert/strict';

test('socket client queues outbound messages until websocket opens', async () => {
  const sockets: MockWebSocket[] = [];
  const sentPayloads: string[] = [];
  const originalWindow = (globalThis as any).window;
  const originalWebSocket = (globalThis as any).WebSocket;

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    onopen: ((event?: unknown) => void) | null = null;
    onclose: ((event?: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event?: unknown) => void) | null = null;

    constructor(readonly url: string) {
      sockets.push(this);
    }

    send(payload: string) {
      sentPayloads.push(payload);
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({});
    }

    open() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }
  }

  (globalThis as any).window = {
    setTimeout,
    clearTimeout,
    location: { origin: 'http://127.0.0.1:18637' },
  };
  (globalThis as any).WebSocket = MockWebSocket;

  try {
    const { createSocketClient } = await import('../src/transport/ws/createSocketClient.js');
    const client = createSocketClient({
      onMessage() {},
      onStatusChange() {},
    });

    await client.connect('token-1');
    assert.equal(sockets.length, 1);

    const queued = client.send({
      type: 'thread_sync',
      threadId: 'thread-1',
    });
    assert.equal(queued, true);
    assert.equal(sentPayloads.length, 0);

    sockets[0]?.open();
    assert.equal(sentPayloads.length, 1);
    assert.deepEqual(JSON.parse(sentPayloads[0] || '{}'), {
      type: 'thread_sync',
      threadId: 'thread-1',
    });
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
  }
});
