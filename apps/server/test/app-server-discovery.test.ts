import test from 'node:test';
import assert from 'node:assert/strict';
import { __appServerDiscoveryTestUtils } from '../src/platform/app-server-discovery.js';

test('extractAppServerWsUrl reads ws listen target from codex command line', () => {
  const commandLine = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js app-server --listen ws://127.0.0.1:4792';
  assert.equal(
    __appServerDiscoveryTestUtils.extractAppServerWsUrl(commandLine),
    'ws://127.0.0.1:4792',
  );
});
