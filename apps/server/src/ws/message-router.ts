import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@codex-remote/protocol';
import { bootstrapTabs, broadcastMessage, buildThreadSyncMessage, ensureCodexReady, resetServerRequestPending, setServerRequestSubmitting, upsertRuntimeTab } from './bridge.js';

type WsLike = {
  send: (payload: string) => void;
};

function sendMessage(socket: WsLike, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

export async function routeClientMessage(app: FastifyInstance, socket: WsLike, message: ClientMessage): Promise<void> {
  await ensureCodexReady(app);

  if (message.type === 'tab_create') {
    const workspacePath = app.workspaceManager.resolveWorkspacePath(message.cwd);
    const thread = await app.codexClient.startThread({
      name: message.name || null,
      cwd: workspacePath,
      model: message.model || null,
      approvalPolicy: message.approvalPolicy || null,
      sandbox: message.sandboxMode || null,
    });
    const tab = upsertRuntimeTab(app, {
      ...thread,
      cwd: typeof thread.cwd === 'string' ? thread.cwd : workspacePath,
      approvalPolicy: message.approvalPolicy || '',
      sandboxMode: message.sandboxMode || '',
    });
    broadcastMessage(app, { type: 'tab_updated', tab });
    sendMessage(socket, { type: 'tab_created', threadId: tab.threadId, tab });
    return;
  }

  if (message.type === 'turn_send') {
    await app.codexClient.startTurn(message.threadId, message.text, {
      attachments: message.attachments,
      model: message.model || null,
      effort: message.effort || null,
      approvalPolicy: message.approvalPolicy || null,
      sandboxPolicy: message.sandboxMode ? { mode: message.sandboxMode } : null,
    });
    const current = app.runtimeState.tabsById.get(message.threadId);
    if (current) {
      const tab = upsertRuntimeTab(app, {
        ...current,
        status: 'running',
        updatedAt: Math.floor(Date.now() / 1000),
        approvalPolicy: message.approvalPolicy || current.approvalPolicy || '',
        sandboxMode: message.sandboxMode || current.sandboxMode || '',
      });
      broadcastMessage(app, { type: 'tab_updated', tab });
    } else {
      await bootstrapTabs(app);
    }
    return;
  }

  if (message.type === 'thread_sync') {
    const thread = await app.codexClient.resumeThread(message.threadId);
    const tab = upsertRuntimeTab(app, thread);
    sendMessage(socket, { type: 'tab_updated', tab });
    sendMessage(socket, buildThreadSyncMessage(app, message.threadId, thread));
    return;
  }

  if (message.type === 'server_request_respond') {
    const request = app.runtimeState.serverRequestsById.get(message.requestId);
    if (!request) {
      sendMessage(socket, {
        type: 'error',
        code: 'REQUEST_NOT_FOUND',
        message: '待处理请求不存在或已失效。',
      });
      return;
    }

    setServerRequestSubmitting(app, message.requestId);
    try {
      app.codexClient.respond(request.rawRequestId, message.response);
    } catch (error) {
      resetServerRequestPending(app, message.requestId);
      sendMessage(socket, {
        type: 'error',
        threadId: request.threadId || undefined,
        message: error instanceof Error ? error.message : '批准响应发送失败',
      });
    }
    return;
  }

  sendMessage(socket, {
    type: 'error',
    message: `Unsupported message type in scaffold: ${message.type}`,
  });
}
