import { createWindowBindingRecord } from '@codex-remote/domain';
import type { FastifyInstance } from 'fastify';
import type { RuntimeTab } from './session-tabs.js';
import type { CodexWindowManager, WindowDiscoverySnapshot } from '../../platform/window-manager.js';
import { broadcastMessage } from '../../ws/bridge.js';

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function applyWindowState(
  app: FastifyInstance,
  threadId: string,
  nextState: { windowStatus: string; windowPid: number | null; commandLine?: string },
  options: { broadcastUpdate?: boolean; touchUpdatedAt?: boolean } = {},
): RuntimeTab | null {
  const tab = app.runtimeState.tabsById.get(threadId);
  if (!tab) {
    return null;
  }
  const nextStatus = nextState.windowStatus === 'attached' ? 'attached' : 'detached';
  const changed = tab.windowStatus !== nextStatus;
  tab.windowStatus = nextStatus;
  if (options.touchUpdatedAt !== false && changed) {
    tab.updatedAt = nowUnix();
  }
  app.repositories.sessions.upsertSession({
    ...tab,
    approvalPolicy: tab.approvalPolicy || '',
    sandboxMode: tab.sandboxMode || '',
    updatedAt: tab.updatedAt || nowUnix(),
  });
  app.repositories.windowBindings.upsertWindowBinding(createWindowBindingRecord({
    threadId,
    pid: nextState.windowPid,
    commandLine: nextState.commandLine || '',
    updatedAt: Date.now(),
  }));
  if (options.broadcastUpdate !== false && changed) {
    broadcastMessage(app, { type: 'tab_updated', tab });
  }
  return tab;
}

export function createWindowAttachmentService(app: FastifyInstance, windows: CodexWindowManager) {
  const pendingWindowOpens = new Map<string, Promise<number>>();

  async function launchWindow(threadId: string): Promise<number> {
    let pending = pendingWindowOpens.get(threadId);
    if (!pending) {
      pending = windows.openWindow(threadId).finally(() => {
        pendingWindowOpens.delete(threadId);
      });
      pendingWindowOpens.set(threadId, pending);
    }
    return pending;
  }

  async function refreshTabWindowStatus(
    threadId: string,
    options: {
      allowDiscovery?: boolean;
      allowLaunch?: boolean;
      broadcastUpdate?: boolean;
      touchUpdatedAt?: boolean;
      snapshot?: WindowDiscoverySnapshot | null;
    } = {},
  ) {
    const allowDiscovery = options.allowDiscovery !== false;
    const allowLaunch = options.allowLaunch === true;
    const snapshot = options.snapshot || null;

    if (allowDiscovery) {
      try {
        const discovered = await windows.findResumeWindow(threadId, snapshot);
        if (discovered?.pid) {
          windows.rememberPid(threadId, discovered.pid);
          return applyWindowState(app, threadId, {
            windowStatus: 'attached',
            windowPid: discovered.pid,
            commandLine: discovered.commandLine,
          }, options);
        }
      } catch {
        // Ignore discovery failures and fall back to tracked pid.
      }
    }

    const trackedPid = windows.getPid(threadId);
    if (trackedPid && await windows.isPidAliveInSnapshot(trackedPid, snapshot)) {
      return applyWindowState(app, threadId, {
        windowStatus: 'attached',
        windowPid: trackedPid,
      }, options);
    }

    if (trackedPid) {
      windows.clearPid(threadId);
    }

    if (allowLaunch) {
      try {
        const pid = await launchWindow(threadId);
        windows.rememberPid(threadId, pid);
        return applyWindowState(app, threadId, {
          windowStatus: 'attached',
          windowPid: pid,
        }, options);
      } catch {
        // Fall through to detached state.
      }
    }

    return applyWindowState(app, threadId, {
      windowStatus: 'detached',
      windowPid: null,
    }, options);
  }

  async function refreshAllTabsWindowStatus(): Promise<void> {
    const threadIds = Array.from(app.runtimeState.tabsById.keys());
    const snapshot = threadIds.length ? await windows.createDiscoverySnapshot().catch(() => null) : null;
    await Promise.allSettled(threadIds.map((threadId) => refreshTabWindowStatus(threadId, {
      allowDiscovery: true,
      allowLaunch: false,
      broadcastUpdate: true,
      touchUpdatedAt: false,
      snapshot,
    })));
  }

  return {
    refreshTabWindowStatus,
    refreshAllTabsWindowStatus,
    async openWindowForThread(threadId: string) {
      return refreshTabWindowStatus(threadId, {
        allowDiscovery: true,
        allowLaunch: true,
        broadcastUpdate: true,
        touchUpdatedAt: true,
      });
    },
    async closeWindowForThread(threadId: string) {
      await windows.closeWindow(threadId);
      windows.clearPid(threadId);
      return applyWindowState(app, threadId, {
        windowStatus: 'detached',
        windowPid: null,
      }, {
        broadcastUpdate: true,
        touchUpdatedAt: true,
      });
    },
  };
}
