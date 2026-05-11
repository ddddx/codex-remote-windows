import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('migration script imports legacy state and prints summary', () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tempDir = createTempDir('codex-remote-migrate-');
  const sqliteFile = path.join(tempDir, 'state.sqlite');
  const appStatePath = path.join(tempDir, '.codex-remote-state.json');
  const windowMapPath = path.join(tempDir, '.window-map.json');

  fs.writeFileSync(appStatePath, JSON.stringify({
    lastWorkspacePath: 'C:\\workspace',
    threadPrefs: {
      'thread-1': {
        approvalPolicy: 'never',
        sandboxMode: 'workspace-write',
      },
    },
  }, null, 2));
  fs.writeFileSync(windowMapPath, JSON.stringify({
    'thread-1': 1234,
  }, null, 2));

  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    'scripts/migrate-legacy-state.ts',
    '--sqlite-file',
    sqliteFile,
    '--app-state',
    appStatePath,
    '--window-map',
    windowMapPath,
  ], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.appStateExists, true);
  assert.equal(payload.windowMapExists, true);
  assert.equal(payload.imported.threadPreferences, 1);
  assert.equal(payload.imported.windowBindings, 1);
});
