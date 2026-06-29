import type { ClientMessage, ServerMessage } from '@codex-remote/protocol';
import type { FastifyInstance } from 'fastify';
import { broadcastMessage, ensureCodexReady } from '../../ws/bridge.js';
import { flushPendingAgentDeltas } from './event-bridge.js';
import {
  buildThreadHistoryMessage,
  buildThreadSyncMessage,
  bootstrapTabs,
  defaultThreadSyncTurnLimit,
  type RuntimeThread,
} from './thread-sync.js';
import { toSessionTabPayload, upsertRuntimeTab, type RuntimeTab } from './session-tabs.js';

type CreateTabMessage = Extract<ClientMessage, { type: 'tab_create' }>;
type ThreadOptionsUpdateMessage = Extract<ClientMessage, { type: 'thread_options_update' }>;

export type SessionService = ReturnType<typeof createSessionService>;

export function createSessionService(app: FastifyInstance) {
  async function applyThreadOptions(message: {
    threadId: string;
    model?: string;
    effort?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  }): Promise<RuntimeTab | null> {
    const current = app.runtimeState.tabsById.get(message.threadId);
    if (!current) {
      return null;
    }
    const nextPrefs = {
      model: message.model || current.model || '',
      reasoningEffort: message.effort || current.reasoningEffort || '',
      approvalPolicy: message.approvalPolicy || current.approvalPolicy || '',
      sandboxMode: message.sandboxMode || current.sandboxMode || '',
    };
    const updated = await app.codexClient.updateThreadSettings(message.threadId, {
      cwd: current.cwd || null,
      model: nextPrefs.model || null,
      effort: nextPrefs.reasoningEffort || null,
      approvalPolicy: nextPrefs.approvalPolicy || null,
      sandbox: nextPrefs.sandboxMode || null,
    });
    return upsertRuntimeTab(app, {
      ...current,
      ...updated,
      threadId: current.threadId,
      cwd: updated.cwd || current.cwd,
      model: nextPrefs.model,
      reasoningEffort: nextPrefs.reasoningEffort,
      approvalPolicy: nextPrefs.approvalPolicy,
      sandboxMode: nextPrefs.sandboxMode,
      updatedAt: Math.floor(Date.now() / 1000),
    });
  }

  return {
    async createTab(message: CreateTabMessage): Promise<RuntimeTab> {
      await ensureCodexReady(app);
      const workspacePath = app.workspaceManager.resolveWorkspacePath(message.cwd);
      const thread = await app.codexClient.startThread({
        name: message.name || null,
        cwd: workspacePath,
        model: message.model || null,
        effort: message.effort || null,
        approvalPolicy: message.approvalPolicy || null,
        sandbox: message.sandboxMode || null,
      });
      const tab = upsertRuntimeTab(app, {
        ...thread,
        cwd: typeof thread.cwd === 'string' ? thread.cwd : workspacePath,
        approvalPolicy: message.approvalPolicy || '',
        sandboxMode: message.sandboxMode || '',
        model: message.model || '',
        reasoningEffort: message.effort || '',
      });
      const attachedTab = await app.windowAttachments.openWindowForThread(tab.threadId) as RuntimeTab | null;
      const nextTab = attachedTab || tab;
      broadcastMessage(app, { type: 'tab_updated', tab: toSessionTabPayload(nextTab) });
      return nextTab;
    },

    async syncThread(threadId: string): Promise<{
      tab: RuntimeTab;
      message: Extract<ServerMessage, { type: 'thread_sync' }>;
    }> {
      await ensureCodexReady(app);
      flushPendingAgentDeltas(app, threadId);
      const current = app.runtimeState.tabsById.get(threadId);
      const thread = await app.codexClient.resumeThread(threadId, {
        cwd: current?.cwd || null,
        model: current?.model || null,
        effort: current?.reasoningEffort || null,
        approvalPolicy: current?.approvalPolicy || null,
        sandbox: current?.sandboxMode || null,
        initialTurnsLimit: defaultThreadSyncTurnLimit(),
      });
      const tab = upsertRuntimeTab(app, {
        ...(current || {}),
        ...thread,
        threadId,
        model: typeof thread.model === 'string' ? thread.model : current?.model || '',
        reasoningEffort: typeof thread.reasoningEffort === 'string' ? thread.reasoningEffort : current?.reasoningEffort || '',
        approvalPolicy: typeof thread.approvalPolicy === 'string' ? thread.approvalPolicy : current?.approvalPolicy || '',
        sandboxMode: typeof thread.sandboxMode === 'string' ? thread.sandboxMode : current?.sandboxMode || '',
      });
      const refreshedTab = await app.windowAttachments.refreshTabWindowStatus(threadId, {
        allowDiscovery: true,
        allowLaunch: true,
        broadcastUpdate: false,
        touchUpdatedAt: false,
      }) as RuntimeTab | null;
      const nextTab = refreshedTab || tab;
      return {
        tab: nextTab,
        message: buildThreadSyncMessage(app, threadId, thread as RuntimeThread),
      };
    },

    async loadThreadHistory(threadId: string, cursor?: string | null, limit?: number): Promise<Extract<ServerMessage, { type: 'thread_history' }>> {
      await ensureCodexReady(app);
      const page = await app.codexClient.listThreadTurns(threadId, {
        cursor: cursor || null,
        limit: limit || defaultThreadSyncTurnLimit(),
      });
      return buildThreadHistoryMessage(app, threadId, page as any);
    },

    async updateThreadOptions(message: ThreadOptionsUpdateMessage): Promise<RuntimeTab | null> {
      await ensureCodexReady(app);
      const tab = await applyThreadOptions(message);
      if (tab) {
        broadcastMessage(app, { type: 'tab_updated', tab: toSessionTabPayload(tab) });
      }
      return tab;
    },

    async refreshTabsAfterActivity(): Promise<void> {
      await ensureCodexReady(app);
      await bootstrapTabs(app);
    },

    async closeTabWindow(threadId: string): Promise<RuntimeTab | null> {
      await ensureCodexReady(app);
      const closedTab = await app.windowAttachments.closeWindowForThread(threadId) as RuntimeTab | null;
      if (closedTab) {
        return closedTab;
      }
      return app.runtimeState.tabsById.get(threadId) || null;
    },
  };
}
