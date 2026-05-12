import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowAttachmentService } from '../src/application/services/window-attachment.js';

function createAppStub(threadIds: string[]) {
  const tabsById = new Map(threadIds.map((threadId, index) => [threadId, {
    threadId,
    name: `Thread ${index + 1}`,
    cwd: 'C:\\workspace',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    windowStatus: 'detached',
    approvalPolicy: '',
    sandboxMode: '',
  }]));

  const app = {
    runtimeState: {
      tabsById,
      clients: new Set(),
    },
    repositories: {
      sessions: {
        upsertSession() {},
      },
      windowBindings: {
        upsertWindowBinding() {},
      },
    },
  };

  return app as any;
}

test('refreshAllTabsWindowStatus reuses one discovery snapshot for all tabs', async () => {
  const threadIds = [
    '00000000-0000-0000-0000-000000000111',
    '00000000-0000-0000-0000-000000000222',
    '00000000-0000-0000-0000-000000000333',
  ];
  const app = createAppStub(threadIds);
  const calls = {
    createDiscoverySnapshot: 0,
    findResumeWindow: [] as Array<{ threadId: string; snapshot: unknown }>,
    isPidAliveInSnapshot: [] as Array<{ pid: number | string; snapshot: unknown }>,
  };
  const snapshot = {
    alivePids: new Set<number>(),
    resumeWindowsByThread: new Map(),
  };
  const windows = {
    async openWindow() {
      return 1;
    },
    async closeWindow() {},
    rememberPid() {
      return null;
    },
    getPid() {
      return null;
    },
    clearPid() {},
    async isPidAlive() {
      return false;
    },
    async isPidAliveInSnapshot(pid: number | string, maybeSnapshot: unknown) {
      calls.isPidAliveInSnapshot.push({ pid, snapshot: maybeSnapshot });
      return false;
    },
    async listProcesses() {
      return [];
    },
    async createDiscoverySnapshot() {
      calls.createDiscoverySnapshot += 1;
      return snapshot;
    },
    async listResumeWindows() {
      return [];
    },
    async findResumeWindow(threadId: string, maybeSnapshot: unknown) {
      calls.findResumeWindow.push({ threadId, snapshot: maybeSnapshot });
      return null;
    },
  };

  const service = createWindowAttachmentService(app, windows as any);
  await service.refreshAllTabsWindowStatus();

  assert.equal(calls.createDiscoverySnapshot, 1);
  assert.equal(calls.findResumeWindow.length, threadIds.length);
  for (const call of calls.findResumeWindow) {
    assert.equal(call.snapshot, snapshot);
  }
});
