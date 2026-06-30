import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@codex-remote/protocol';
import { ensureCodexReady } from './bridge.js';
import { toSessionTabPayload } from '../application/services/session-tabs.js';
import { sendServerMessage } from './send.js';

type WsLike = {
  send: (payload: string) => void;
};

function sendMessage(app: FastifyInstance, socket: WsLike, message: ServerMessage): boolean {
  return sendServerMessage(app, socket, message);
}

export async function routeClientMessage(app: FastifyInstance, socket: WsLike, message: ClientMessage): Promise<void> {
  await ensureCodexReady(app);

  if (message.type === 'tab_create') {
    const tab = await app.services.sessions.createTab(message);
    sendMessage(app, socket, { type: 'tab_created', threadId: tab.threadId, tab: toSessionTabPayload(tab) });
    return;
  }

  if (message.type === 'turn_send') {
    try {
      await app.services.turns.startTurn(message);
    } catch (error) {
      sendMessage(app, socket, {
        type: 'error',
        op: 'turn_send',
        threadId: message.threadId,
        clientMessageId: message.clientMessageId,
        message: error instanceof Error ? error.message : '发送消息失败',
      });
    }
    return;
  }

  if (message.type === 'command_send') {
    try {
      await app.services.commands.runCommand(message);
    } catch (error) {
      sendMessage(app, socket, {
        type: 'error',
        op: 'command_send',
        threadId: message.threadId,
        clientMessageId: message.clientMessageId,
        message: error instanceof Error ? error.message : '执行命令失败',
      });
    }
    return;
  }

  if (message.type === 'tab_close') {
    const tab = await app.services.sessions.closeTabWindow(message.threadId);
    if (tab) {
      sendMessage(app, socket, { type: 'tab_updated', tab: toSessionTabPayload(tab) });
    }
    return;
  }

  if (message.type === 'thread_sync') {
    const { tab, message: snapshot } = await app.services.sessions.syncThread(
      message.threadId,
      message.limit,
    );
    sendMessage(app, socket, { type: 'tab_updated', tab: toSessionTabPayload(tab) });
    sendMessage(app, socket, snapshot);
    return;
  }

  if (message.type === 'thread_history_load') {
    const snapshot = await app.services.sessions.loadThreadHistory(
      message.threadId,
      message.cursor,
      message.limit,
    );
    sendMessage(app, socket, snapshot);
    return;
  }

  if (message.type === 'thread_options_update') {
    await app.services.sessions.updateThreadOptions(message);
    return;
  }

  if (message.type === 'server_request_respond') {
    const errorMessage = app.services.approvals.respond(message);
    if (errorMessage) {
      sendMessage(app, socket, errorMessage);
    }
    return;
  }

  sendMessage(app, socket, {
    type: 'error',
    message: 'Unsupported message type in scaffold',
  });
}
