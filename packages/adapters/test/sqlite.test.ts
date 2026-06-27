import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSqliteDatabase,
  createSqliteRepositories,
  importLegacyState,
} from '../src/index.js';
import {
  createPendingRequestRecord,
  createSessionRecord,
  createThreadPreferenceRecord,
  createUploadRecord,
} from '@codex-remote/domain';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('sqlite migrations create repositories that can round-trip records', () => {
  const tempDir = createTempDir('codex-remote-adapters-');
  const database = createSqliteDatabase({
    filePath: path.join(tempDir, 'state.sqlite'),
  });
  const repositories = createSqliteRepositories(database);

  repositories.sessions.upsertSession(
    createSessionRecord({
      threadId: 'thread-1',
      name: 'Demo',
      cwd: 'C:\\workspace',
      status: 'idle',
    }),
  );
  repositories.pendingRequests.upsertPendingRequest(
    createPendingRequestRecord({
      requestId: 'req-1',
      threadId: 'thread-1',
      turnId: null,
      itemId: null,
      kind: 'command_approval',
      method: 'item/commandExecution/requestApproval',
      status: 'pending',
      payloadJson: '{"ok":true}',
    }),
  );
  repositories.threadPreferences.upsertThreadPreference(
    createThreadPreferenceRecord({
      threadId: 'thread-1',
      approvalPolicy: 'on-request',
      sandboxMode: 'danger-full-access',
    }),
  );
  repositories.uploads.upsertUpload(
    createUploadRecord({
      id: 'upload-1',
      savedName: 'upload-1.png',
      originalName: 'demo.png',
      contentType: 'image/png',
      filePath: 'C:\\uploads\\upload-1.png',
      createdAt: Date.now(),
    }),
  );
  const firstEvent = repositories.timelineEvents.appendTimelineEvent({
    threadId: 'thread-1',
    eventJson: '{"type":"agent_delta","delta":"a"}',
    createdAt: 1000,
  });
  const secondEvent = repositories.timelineEvents.appendTimelineEvent({
    threadId: 'thread-1',
    eventJson: '{"type":"item_completed"}',
    createdAt: 1001,
  });

  assert.equal(repositories.sessions.listSessions().length, 1);
  assert.equal(repositories.pendingRequests.listPendingRequests().length, 1);
  assert.equal(
    repositories.threadPreferences.getThreadPreference('thread-1')?.sandboxMode,
    'danger-full-access',
  );
  assert.equal(repositories.uploads.listUploads().length, 1);
  assert.equal(secondEvent.sequence, firstEvent.sequence + 1);
  assert.deepEqual(
    repositories.timelineEvents
      .listTimelineEvents('thread-1')
      .map((event) => event.eventJson),
    ['{"type":"agent_delta","delta":"a"}', '{"type":"item_completed"}'],
  );
  database.close();
});

test('legacy import populates thread preferences and window bindings', () => {
  const tempDir = createTempDir('codex-remote-import-');
  const database = createSqliteDatabase({
    filePath: path.join(tempDir, 'state.sqlite'),
  });

  const appStatePath = path.join(tempDir, '.codex-remote-state.json');
  const windowMapPath = path.join(tempDir, '.window-map.json');
  fs.writeFileSync(
    appStatePath,
    JSON.stringify(
      {
        lastWorkspacePath: 'C:\\workspace',
        threadPrefs: {
          'thread-2': {
            approvalPolicy: 'never',
            sandboxMode: 'workspace-write',
          },
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    windowMapPath,
    JSON.stringify(
      {
        'thread-2': 4321,
      },
      null,
      2,
    ),
  );

  importLegacyState(database, {
    appStatePath,
    windowMapPath,
  });

  const repositories = createSqliteRepositories(database);
  assert.equal(
    repositories.threadPreferences.getThreadPreference('thread-2')
      ?.approvalPolicy,
    'never',
  );
  assert.equal(repositories.windowBindings.listWindowBindings()[0]?.pid, 4321);
  assert.equal(
    repositories.appState.getAppState('lastWorkspacePath')?.valueJson,
    JSON.stringify('C:\\workspace'),
  );
  database.close();
});
