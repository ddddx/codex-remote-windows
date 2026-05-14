import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CodexAppServerSupervisor } from '../src/platform/app-server-supervisor.js';

test('ensureStarted rejects when ws port is occupied by a non-Codex service', async () => {
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end('not codex');
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  const supervisor = new CodexAppServerSupervisor({
    wsUrl: `ws://127.0.0.1:${port}`,
    connectTimeoutMs: 1500,
  });

  await assert.rejects(
    () => supervisor.ensureStarted(),
    /non-Codex service/,
  );

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});
