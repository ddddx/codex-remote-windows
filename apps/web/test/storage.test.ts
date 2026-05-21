import test from 'node:test';
import assert from 'node:assert/strict';

test('active session id storage reads, writes, and clears values', async () => {
  const originalWindow = (globalThis as any).window;
  const store = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key) || null : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };

  (globalThis as any).window = {
    localStorage,
    location: { href: 'http://127.0.0.1:4173/' },
    history: { replaceState() {} },
  };

  try {
    const storage = await import('../src/lib/storage.js');
    assert.equal(storage.readStoredActiveSessionId(), '');
    assert.equal(storage.writeStoredActiveSessionId(' thread-1 '), 'thread-1');
    assert.equal(storage.readStoredActiveSessionId(), 'thread-1');
    assert.equal(storage.writeStoredActiveSessionId(''), '');
    assert.equal(storage.readStoredActiveSessionId(), '');
  } finally {
    (globalThis as any).window = originalWindow;
  }
});
