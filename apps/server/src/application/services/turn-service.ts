import type { ClientMessage } from '@codex-remote/protocol';
import type { v2 } from '@codex-remote/codex-app-server-types';
import type { FastifyInstance } from 'fastify';
import { broadcastMessage, ensureCodexReady } from '../../ws/bridge.js';
import { upsertSupplementalItem } from './runtime-cache.js';
import { bootstrapTabs } from './thread-sync.js';
import { toSessionTabPayload, upsertRuntimeTab } from './session-tabs.js';

type TurnSendMessage = Extract<ClientMessage, { type: 'turn_send' }>;

function buildSandboxPolicyOverride(
  sandboxMode: string | undefined,
  cwd: string | undefined,
): v2.SandboxPolicy | null {
  const normalized = (sandboxMode || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }
  if (normalized === 'read-only') {
    return { type: 'readOnly', networkAccess: false };
  }
  if (normalized === 'workspace-write') {
    return {
      type: 'workspaceWrite',
      networkAccess: false,
      writableRoots: cwd ? [cwd] : [],
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
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
      const turn = await app.codexClient.startTurn(message.threadId, message.text, {
        attachments: message.attachments,
        model: message.model || null,
        effort: message.effort || null,
        approvalPolicy: message.approvalPolicy || null,
        sandboxPolicy: buildSandboxPolicyOverride(message.sandboxMode, current?.cwd),
      });
      const turnId = typeof turn?.id === 'string' ? turn.id : '';
      const text = typeof message.text === 'string' ? message.text.trim() : '';

      if (turnId && text) {
        upsertSupplementalItem(app.runtimeState, message.threadId, {
          id: `pending-user:${turnId}`,
          type: 'pendingUserMessage',
          _turnId: turnId,
          text,
          createdAt: Date.now(),
        });
      }

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
        broadcastMessage(app, { type: 'tab_updated', tab: toSessionTabPayload(tab) });
        return;
      }

      await bootstrapTabs(app);
    },
  };
}
