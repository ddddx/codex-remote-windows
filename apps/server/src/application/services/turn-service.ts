import type { ClientMessage } from '@codex-remote/protocol';
import type { FastifyInstance } from 'fastify';
import { broadcastMessage, ensureCodexReady } from '../../ws/bridge.js';
import { bootstrapTabs } from './thread-sync.js';
import { upsertRuntimeTab } from './session-tabs.js';

type TurnSendMessage = Extract<ClientMessage, { type: 'turn_send' }>;

function buildSandboxPolicyOverride(
  sandboxMode: string | undefined,
  cwd: string | undefined,
): Record<string, unknown> | null {
  const normalized = (sandboxMode || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }
  if (normalized === 'read-only') {
    return { type: 'readOnly' };
  }
  if (normalized === 'workspace-write') {
    return {
      type: 'workspaceWrite',
      networkAccess: false,
      writableRoots: cwd ? [cwd] : [],
    };
  }
  return null;
}

export type TurnService = ReturnType<typeof createTurnService>;

export function createTurnService(app: FastifyInstance) {
  return {
    async startTurn(message: TurnSendMessage): Promise<void> {
      await ensureCodexReady(app);
      const current = app.runtimeState.tabsById.get(message.threadId);
      await app.codexClient.startTurn(message.threadId, message.text, {
        attachments: message.attachments,
        model: message.model || null,
        effort: message.effort || null,
        approvalPolicy: message.approvalPolicy || null,
        sandboxPolicy: buildSandboxPolicyOverride(message.sandboxMode, current?.cwd),
      });

      if (current) {
        const tab = upsertRuntimeTab(app, {
          ...current,
          status: 'running',
          updatedAt: Math.floor(Date.now() / 1000),
          approvalPolicy: message.approvalPolicy || current.approvalPolicy || '',
          sandboxMode: message.sandboxMode || current.sandboxMode || '',
          model: message.model || current.model || '',
          reasoningEffort: message.effort || current.reasoningEffort || '',
        });
        broadcastMessage(app, { type: 'tab_updated', tab });
        return;
      }

      await bootstrapTabs(app);
    },
  };
}
