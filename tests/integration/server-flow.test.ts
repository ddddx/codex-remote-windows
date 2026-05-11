import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../apps/server/src/app.js';
import { createUploadRecord } from '@codex-remote/domain';
import { bootstrapTabs, buildInitialState } from '../../apps/server/src/application/services/thread-sync.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createWorkspaceStub() {
  return {
    getShortcuts() {
      return {
        projectRoot: 'C:\\workspace',
        desktopPath: 'C:\\Users\\Administrator\\Desktop',
        lastUsedPath: 'C:\\workspace',
        preferredPath: 'C:\\workspace',
        roots: ['C:\\workspace'],
      };
    },
    listDirectory(targetPath?: string) {
      return {
        path: targetPath || 'C:\\workspace',
        parentPath: 'C:\\',
        entries: [{ name: 'demo', path: 'C:\\workspace\\demo' }],
      };
    },
    createDirectory(parentPath: string, folderName: string) {
      return `${parentPath}\\${folderName}`;
    },
    resolveWorkspacePath(inputPath?: string) {
      return inputPath || 'C:\\workspace';
    },
  };
}

function createCodexStub() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    listeners,
    client: {
      async start() {},
      async stop() {},
      async listThreads() {
        return [{
          id: 'thread-sync',
          name: 'Synced thread',
          cwd: 'C:\\workspace',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }];
      },
      async startThread() {
        return {
          id: 'thread-created',
          name: 'Created thread',
          cwd: 'C:\\workspace',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
        };
      },
      async resumeThread(threadId: string) {
        return {
          id: threadId,
          name: 'Recovered',
          cwd: 'C:\\workspace',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
          turns: [{
            id: 'turn-1',
            input: [{ type: 'text', text: 'hello' }],
            output: 'world',
          }],
          tokenUsage: { totalTokens: 42 },
        };
      },
      async startTurn() {
        return { id: 'turn-live' };
      },
      async listModels() {
        return [{
          id: 'gpt-test',
          model: 'gpt-test',
          displayName: 'GPT Test',
          description: 'Testing model',
          isDefault: true,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: ['low', 'medium'],
        }];
      },
      async readConfig() {
        return {
          config: {
            model: 'gpt-test',
            model_reasoning_effort: 'medium',
            approval_policy: 'on-request',
            sandbox_mode: 'workspace-write',
          },
        };
      },
      respond() {},
      respondError() {},
      on(event: string, listener: (...args: any[]) => void) {
        const existing = listeners.get(event) || [];
        existing.push(listener);
        listeners.set(event, existing);
      },
    },
  };
}

async function buildIntegrationApp() {
  const tempDir = createTempDir('codex-remote-integration-');
  const app = await createApp({
    host: '127.0.0.1',
    port: 18637,
    wsToken: 'secret-token',
    nodeEnv: 'test',
    maxImageUploadBytes: 2048,
    sqliteFile: path.join(tempDir, 'state.sqlite'),
  });

  const codex = createCodexStub();
  app.workspaceManager = createWorkspaceStub() as any;
  app.codexClient = codex.client as any;
  app.services = (await import('../../apps/server/src/application/services/index.js')).createAppServices(app);

  return {
    app,
    codex,
    tempDir,
  };
}

test('workspace, codex options, upload and thread sync flow work together', async () => {
  const { app, tempDir } = await buildIntegrationApp();
  try {
    const workspace = await app.inject({
      method: 'GET',
      url: '/api/workspace/list?path=C:%5Cworkspace',
      headers: {
        'x-codex-remote-token': 'secret-token',
      },
    });
    assert.equal(workspace.statusCode, 200);
    assert.equal(workspace.json().path, 'C:\\workspace');

    const options = await app.inject({
      method: 'GET',
      url: '/api/codex/options?cwd=C:%5Cworkspace',
      headers: {
        'x-codex-remote-token': 'secret-token',
      },
    });
    assert.equal(options.statusCode, 200);
    assert.equal(options.json().models[0]?.id, 'gpt-test');

    const upload = await app.inject({
      method: 'POST',
      url: '/api/uploads/image',
      headers: {
        'x-codex-remote-token': 'secret-token',
        'content-type': 'image/png',
        'x-upload-filename': encodeURIComponent('demo.png'),
      },
      payload: Buffer.from([137, 80, 78, 71]),
    });
    assert.equal(upload.statusCode, 200);
    const uploadPayload = upload.json();
    assert.equal(uploadPayload.contentType, 'image/png');
    assert.equal(app.repositories.uploads.listUploads().length, 1);

    const threadSync = await app.services.sessions.syncThread('thread-sync');
    assert.equal(threadSync.tab.threadId, 'thread-sync');
    assert.equal(threadSync.message.turns?.length, 1);
    assert.equal((threadSync.message.tokenUsage as any)?.totalTokens, 42);

    const fetchedUpload = await app.inject({
      method: 'GET',
      url: uploadPayload.url,
      headers: {
        'x-codex-remote-token': 'secret-token',
      },
    });
    assert.equal(fetchedUpload.statusCode, 200);
    assert.equal(Buffer.compare(fetchedUpload.rawPayload, Buffer.from([137, 80, 78, 71])), 0);
  } finally {
    await app.close();
    app.sqlite.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('thread sync restores persisted requests and upload metadata from repositories', async () => {
  const { app, tempDir } = await buildIntegrationApp();
  try {
    app.repositories.uploads.upsertUpload(createUploadRecord({
      id: 'upload-seeded',
      savedName: 'upload-seeded.png',
      originalName: 'seeded.png',
      contentType: 'image/png',
      filePath: path.join(tempDir, 'upload-seeded.png'),
      createdAt: Date.now(),
    }));
    app.repositories.pendingRequests.upsertPendingRequest({
      requestId: 'req-seeded',
      threadId: 'thread-sync',
      turnId: 'turn-1',
      itemId: 'item-1',
      kind: 'command_approval',
      method: 'item/commandExecution/requestApproval',
      status: 'pending',
      payloadJson: JSON.stringify({
        requestId: 'req-seeded',
        threadId: 'thread-sync',
        turnId: 'turn-1',
        itemId: 'item-1',
        kind: 'command_approval',
        method: 'item/commandExecution/requestApproval',
        status: 'pending',
        command: 'npm test',
        createdAt: 1,
      }),
      createdAt: 1,
      submittedAt: null,
    });

    await bootstrapTabs(app);
    const stateMessage = buildInitialState(app);
    assert.equal(stateMessage.serverRequests.length, 1);
    assert.equal((stateMessage.serverRequests[0] as any).requestId, 'req-seeded');
    assert.equal(app.repositories.uploads.listUploads().length, 1);
  } finally {
    await app.close();
    app.sqlite.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
