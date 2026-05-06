const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { URL } = require('node:url');
const express = require('express');
const { WebSocketServer } = require('ws');

const { CodexAppServerClient } = require('./codexAppServerClient');
const { CodexWindowManager } = require('./windowManager');
const { applyLocalConfig } = require('./localConfig');

applyLocalConfig();

const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const WS_TOKEN = process.env.WS_TOKEN || '';
const MAX_CLIENT_MESSAGE_BYTES = parsePositiveInteger(process.env.MAX_CLIENT_MESSAGE_BYTES) || 65536;
const MAX_TURN_INPUT_LENGTH = parsePositiveInteger(process.env.MAX_TURN_INPUT_LENGTH) || 20000;
const MAX_TAB_NAME_LENGTH = parsePositiveInteger(process.env.MAX_TAB_NAME_LENGTH) || 120;
const CLOSED_TAB_TTL_MS = parsePositiveInteger(process.env.CLOSED_TAB_TTL_MS) || 30000;
const MAX_CLOSED_TABS = parsePositiveInteger(process.env.MAX_CLOSED_TABS) || 20;
const BOOTSTRAP_THREAD_LIMIT = parsePositiveInteger(process.env.BOOTSTRAP_THREAD_LIMIT) || 100;
const WINDOW_STATUS_REFRESH_MS = parsePositiveInteger(process.env.WINDOW_STATUS_REFRESH_MS) || 5000;
const THREAD_ID_REGEX = /^[0-9a-f]{8,12}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.get('/health', (_req, res) => {
  res.json({
    status: shuttingDown ? 'shutting_down' : 'ok',
    tabs: tabs.size,
    websocketClients: wss.clients.size,
    uptimeSec: Math.floor(process.uptime()),
  });
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const codex = new CodexAppServerClient({
  cwd: process.cwd(),
  codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
});
const windows = new CodexWindowManager({
  appServerWs: process.env.CODEX_APP_SERVER_WS,
});

const tabs = new Map();
const closedTabTimers = new Map();
const pendingWindowOpens = new Map();
const pendingServerRequests = new Map();
let shuttingDown = false;
let windowStatusTimer = null;

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  if (requestUrl.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeStatus(status, fallback = 'idle') {
  const raw = typeof status === 'object' && status ? status.type : status;
  return canonicalizeStatus(raw, fallback);
}

function normalizeTabStatusFromTurn(status, fallback = 'idle') {
  const normalized = normalizeStatus(status, fallback);
  const compact = normalized.replace(/[\s_-]/g, '').toLowerCase();

  if (compact === 'completed' || compact === 'succeeded' || compact === 'cancelled' || compact === 'aborted') {
    return 'idle';
  }

  if (compact === 'failed' || compact === 'systemerror') {
    return 'failed';
  }

  return normalized;
}

function canonicalizeStatus(value, fallback = 'idle') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const compact = trimmed.replace(/[\s_-]/g, '').toLowerCase();
  if (compact === 'notloaded' || compact === 'unloaded') {
    return 'idle';
  }
  if (compact === 'inprogress') {
    return 'active';
  }
  if (compact === 'systemerror') {
    return 'systemError';
  }

  return trimmed;
}

function getErrorMessage(error) {
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error.message === 'string') {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

function isThreadNotFoundError(error) {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    (message.includes('thread') && message.includes('not found'))
    || message.includes('thread_not_found')
  );
}

function assertThreadId(threadId) {
  if (!THREAD_ID_REGEX.test(threadId || '')) {
    throw new Error('invalid threadId');
  }
}

function ensureTab(thread) {
  assertThreadId(thread.id);
  const existing = tabs.get(thread.id);
  const detectedWindowPid = windows.getPid(thread.id);
  const threadWindowPid = Number.parseInt(thread.windowPid, 10);
  const existingWindowPid = Number.parseInt(existing?.windowPid, 10);
  const status = normalizeStatus(thread.status, existing?.status || 'idle');
  const tab = {
    threadId: thread.id,
    name: thread.name || existing?.name || makePreviewName(thread.preview),
    status,
    createdAt: thread.createdAt || existing?.createdAt || nowUnix(),
    updatedAt: thread.updatedAt || existing?.updatedAt || nowUnix(),
    windowPid: detectedWindowPid
      || (Number.isFinite(existingWindowPid) && existingWindowPid > 0 ? existingWindowPid : null)
      || (Number.isFinite(threadWindowPid) && threadWindowPid > 0 ? threadWindowPid : null),
  };

  tabs.set(thread.id, tab);
  if (status !== 'closed') {
    clearClosedTabCleanup(thread.id);
  }
  return tab;
}

function makePreviewName(preview) {
  if (!preview) {
    return 'New Tab';
  }
  return preview.substring(0, 20) + (preview.length > 20 ? '...' : '');
}

function clearClosedTabCleanup(threadId) {
  const timer = closedTabTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    closedTabTimers.delete(threadId);
  }
}

function scheduleClosedTabCleanup(threadId) {
  clearClosedTabCleanup(threadId);
  const timer = setTimeout(() => {
    closedTabTimers.delete(threadId);
    const tab = tabs.get(threadId);
    if (!tab || tab.status !== 'closed') {
      return;
    }
    removeTab(threadId, { broadcastRemoval: true });
  }, CLOSED_TAB_TTL_MS);
  timer.unref?.();
  closedTabTimers.set(threadId, timer);
  pruneClosedTabs();
  pruneClosedTabTimers();
}

function pruneClosedTabs() {
  const closedTabs = tabsList().filter((tab) => tab.status === 'closed');
  if (closedTabs.length <= MAX_CLOSED_TABS) {
    return;
  }

  for (const tab of closedTabs.slice(MAX_CLOSED_TABS)) {
    removeTab(tab.threadId, { broadcastRemoval: true });
  }
}

function pruneClosedTabTimers() {
  for (const [threadId, timer] of closedTabTimers.entries()) {
    const tab = tabs.get(threadId);
    if (tab?.status === 'closed') {
      continue;
    }
    clearTimeout(timer);
    closedTabTimers.delete(threadId);
  }
}

function markTabClosed(threadId) {
  const tab = tabs.get(threadId);
  if (!tab) {
    return;
  }

  tab.status = 'closed';
  tab.updatedAt = nowUnix();
  scheduleClosedTabCleanup(threadId);
  broadcast({ type: 'tab_updated', tab });
}

function removeTab(threadId, options = {}) {
  const { broadcastRemoval = false } = options;
  tabs.delete(threadId);
  clearClosedTabCleanup(threadId);
  if (broadcastRemoval) {
    broadcast({ type: 'tab_removed', threadId });
  }
}

function tabsList() {
  return Array.from(tabs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  for (const client of wss.clients) {
    send(client, payload);
  }
}

function toClientServerRequest(request) {
  const { rawRequestId, ...clientRequest } = request;
  return clientRequest;
}

function listPendingServerRequests(threadId = null) {
  const requests = Array.from(pendingServerRequests.values())
    .filter((request) => !threadId || request.threadId === threadId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((request) => toClientServerRequest(request));
  return requests;
}

function upsertPendingServerRequest(request) {
  pendingServerRequests.set(request.requestId, request);
  return request;
}

function getPendingServerRequest(requestId) {
  return pendingServerRequests.get(String(requestId));
}

function updatePendingServerRequest(requestId, patch) {
  const request = getPendingServerRequest(requestId);
  if (!request) {
    return null;
  }
  Object.assign(request, patch);
  return request;
}

function resolvePendingServerRequest(requestId) {
  const key = String(requestId);
  const request = pendingServerRequests.get(key) || null;
  pendingServerRequests.delete(key);
  return request;
}

function shouldBroadcastUnread(threadId) {
  if (!THREAD_ID_REGEX.test(threadId || '')) {
    return false;
  }

  for (const client of wss.clients) {
    if (client.readyState !== client.OPEN) {
      continue;
    }
    if (client.activeThreadId !== threadId) {
      return true;
    }
  }

  return false;
}

function broadcastUnreadIfNeeded(threadId) {
  if (!shouldBroadcastUnread(threadId)) {
    return;
  }
  broadcast({ type: 'unread', threadId });
}

async function ensureWindowForThread(threadId) {
  assertThreadId(threadId);
  const tab = tabs.get(threadId);
  const pid = windows.getPid(threadId) || tab?.windowPid;
  let alive = false;
  if (pid) {
    try {
      alive = await windows.isPidAlive(pid);
    } catch (error) {
      console.log(`[window] failed checking pid ${pid} for ${threadId}: ${error.message}`);
      alive = false;
    }
  }

  if (alive) {
    if (tab) {
      tab.windowPid = pid;
    }
    if (tab && tab.status === 'closed') {
      tab.status = 'idle';
      tab.updatedAt = nowUnix();
      clearClosedTabCleanup(threadId);
      broadcast({ type: 'tab_updated', tab });
    }
    return;
  }

  if (pid) {
    windows.clearPid(threadId);
  }

  let pendingOpen = pendingWindowOpens.get(threadId);
  if (!pendingOpen) {
    pendingOpen = windows.openWindow(threadId).finally(() => {
      pendingWindowOpens.delete(threadId);
    });
    pendingWindowOpens.set(threadId, pendingOpen);
  }

  const newPid = await pendingOpen;
  if (!tab) {
    return;
  }

  tab.windowPid = newPid;
  tab.status = 'idle';
  tab.updatedAt = nowUnix();
  clearClosedTabCleanup(threadId);
  broadcast({ type: 'tab_updated', tab });
}

async function syncThreadToClients(ws, threadId) {
  assertThreadId(threadId);
  const thread = await codex.resumeThread(threadId);
  const tab = ensureTab(thread);
  send(ws, { type: 'tab_updated', tab });
  send(ws, { type: 'thread_sync', threadId, turns: thread.turns || [] });
  return thread;
}

async function refreshAllTabWindowStatus() {
  const changedTabs = [];
  const checks = [];

  for (const tab of tabs.values()) {
    checks.push((async () => {
      const currentTab = tabs.get(tab.threadId);
      if (!currentTab || currentTab.status === 'closed') {
        return;
      }

      const pid = windows.getPid(currentTab.threadId) || currentTab.windowPid;
      if (!pid) {
        // No window PID known — cannot determine liveness.
        return;
      }

      let alive = false;
      try {
        alive = await windows.isPidAlive(pid);
      } catch (error) {
        console.log(`[bootstrap-window-check] failed checking pid ${pid} for ${currentTab.threadId}: ${error.message}`);
      }

      if (alive) {
        currentTab.windowPid = pid;
        return;
      }

      windows.clearPid(currentTab.threadId);
      currentTab.windowPid = null;
      currentTab.status = 'closed';
      currentTab.updatedAt = nowUnix();
      scheduleClosedTabCleanup(currentTab.threadId);
      changedTabs.push(currentTab);
    })());
  }

  await Promise.allSettled(checks);

  for (const tab of changedTabs) {
    broadcast({ type: 'tab_updated', tab });
  }
}

function normalizeClientMessage(raw) {
  if (Buffer.byteLength(raw) > MAX_CLIENT_MESSAGE_BYTES) {
    throw new Error('message too large');
  }

  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    throw new Error('invalid json');
  }

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('invalid message payload');
  }

  if (typeof message.type !== 'string') {
    throw new Error('message type required');
  }

  switch (message.type) {
    case 'tab_create':
      return {
        type: 'tab_create',
        name: normalizeOptionalString(message.name, MAX_TAB_NAME_LENGTH),
      };
    case 'tab_close':
      return {
        type: 'tab_close',
        threadId: normalizeThreadId(message.threadId),
      };
    case 'turn_send':
      return {
        type: 'turn_send',
        threadId: normalizeThreadId(message.threadId),
        text: normalizeRequiredString(message.text, MAX_TURN_INPUT_LENGTH, 'text'),
        clientMessageId: normalizeOptionalClientMessageId(message.clientMessageId),
      };
    case 'thread_sync':
      return {
        type: 'thread_sync',
        threadId: normalizeThreadId(message.threadId),
      };
    case 'server_request_respond':
      return {
        type: 'server_request_respond',
        requestId: normalizeRequestId(message.requestId),
        response: normalizeObject(message.response, 'response'),
      };
    default:
      throw new Error(`unknown message type: ${message.type}`);
  }
}

function normalizeThreadId(value) {
  if (typeof value !== 'string') {
    throw new Error('threadId required');
  }
  const threadId = value.trim();
  assertThreadId(threadId);
  return threadId;
}

function normalizeOptionalString(value, maxLength) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid string field');
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`field too long (max ${maxLength})`);
  }
  return normalized;
}

function normalizeOptionalClientMessageId(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid clientMessageId');
  }
  return value.trim().slice(0, 128);
}

function normalizeRequestId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('invalid requestId');
  }
  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error('invalid requestId');
  }
  if (normalized.length > 128) {
    throw new Error('requestId too long');
  }
  return normalized;
}

function normalizeObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
}

function normalizeRequiredString(value, maxLength, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} required`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} too long (max ${maxLength})`);
  }
  return normalized;
}

function createServerRequestRecord(msg) {
  const method = msg.method;
  const params = msg.params || {};
  const requestId = normalizeRequestId(msg.id);

  if (method === 'item/commandExecution/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method,
      kind: 'command_approval',
      status: 'pending',
      createdAt: Date.now(),
      threadId: params.threadId || null,
      turnId: params.turnId || null,
      itemId: params.itemId || null,
      approvalId: params.approvalId || null,
      reason: params.reason || '',
      command: params.command || '',
      cwd: params.cwd || '',
      commandActions: Array.isArray(params.commandActions) ? params.commandActions : [],
      proposedExecpolicyAmendment: params.proposedExecpolicyAmendment || null,
      proposedNetworkPolicyAmendments: Array.isArray(params.proposedNetworkPolicyAmendments)
        ? params.proposedNetworkPolicyAmendments
        : [],
    };
  }

  if (method === 'item/fileChange/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method,
      kind: 'file_change_approval',
      status: 'pending',
      createdAt: Date.now(),
      threadId: params.threadId || null,
      turnId: params.turnId || null,
      itemId: params.itemId || null,
      reason: params.reason || '',
      grantRoot: params.grantRoot || null,
    };
  }

  if (method === 'item/permissions/requestApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method,
      kind: 'permissions_approval',
      status: 'pending',
      createdAt: Date.now(),
      threadId: params.threadId || null,
      turnId: params.turnId || null,
      itemId: params.itemId || null,
      reason: params.reason || '',
      cwd: params.cwd || '',
      permissions: params.permissions || {},
    };
  }

  if (method === 'item/tool/requestUserInput') {
    return {
      requestId,
      rawRequestId: msg.id,
      method,
      kind: 'user_input',
      status: 'pending',
      createdAt: Date.now(),
      threadId: params.threadId || null,
      turnId: params.turnId || null,
      itemId: params.itemId || null,
      questions: Array.isArray(params.questions) ? params.questions : [],
    };
  }

  if (method === 'execCommandApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method,
      kind: 'command_approval_legacy',
      status: 'pending',
      createdAt: Date.now(),
      threadId: params.conversationId || null,
      turnId: null,
      itemId: params.callId || null,
      approvalId: params.approvalId || null,
      reason: params.reason || '',
      command: Array.isArray(params.command) ? params.command.join(' ') : '',
      cwd: params.cwd || '',
      commandActions: Array.isArray(params.parsedCmd) ? params.parsedCmd : [],
    };
  }

  if (method === 'applyPatchApproval') {
    return {
      requestId,
      rawRequestId: msg.id,
      method,
      kind: 'file_change_approval_legacy',
      status: 'pending',
      createdAt: Date.now(),
      threadId: params.conversationId || null,
      turnId: null,
      itemId: params.callId || null,
      reason: params.reason || '',
      grantRoot: params.grantRoot || null,
      fileChanges: params.fileChanges || {},
    };
  }

  throw new Error(`unsupported server request method: ${method}`);
}

codex.on('notification', (msg) => {
  const method = msg.method;
  const params = msg.params || {};
  console.log(`[notification] ${method}`, JSON.stringify(params).substring(0, 200));

  if (method === 'thread/started' && params.thread) {
    const tab = ensureTab(params.thread);
    broadcast({ type: 'tab_updated', tab });
    return;
  }

  if (method === 'thread/status/changed') {
    const tab = tabs.get(params.threadId);
    const status = normalizeStatus(params.status, tab?.status || 'idle');

    if (tab) {
      tab.status = status;
      tab.updatedAt = nowUnix();
      broadcast({ type: 'tab_updated', tab });
    }

    if (status === 'closed') {
      markTabClosed(params.threadId);
    }
    return;
  }

  if (method === 'thread/name/updated') {
    const tab = tabs.get(params.threadId);
    if (!tab) {
      return;
    }

    if (tab) {
      tab.name = params.threadName || tab.name;
      tab.updatedAt = nowUnix();
      broadcast({ type: 'tab_updated', tab });
    }
    return;
  }

  if (method === 'thread/closed') {
    markTabClosed(params.threadId);
    return;
  }

  if (method === 'thread/tokenUsage/updated') {
    broadcast({ type: 'token_usage', threadId: params.threadId, turnId: params.turnId, usage: params.tokenUsage });
    return;
  }

  if (method === 'turn/started') {
    const tab = tabs.get(params.threadId);
    if (tab) {
      tab.status = 'running';
      tab.updatedAt = nowUnix();
      broadcast({ type: 'tab_updated', tab });
    }
    broadcast({ type: 'turn_started', threadId: params.threadId, turnId: params.turn?.id || null });
    return;
  }

  if (method === 'turn/completed') {
    const tab = tabs.get(params.threadId);
    if (tab) {
      tab.status = normalizeTabStatusFromTurn(params.turn?.status, 'idle');
      tab.updatedAt = nowUnix();
      broadcast({ type: 'tab_updated', tab });
    }

    broadcast({
      type: 'turn_completed',
      threadId: params.threadId,
      turnId: params.turn?.id || null,
      status: params.turn?.status || 'unknown',
      error: params.turn?.error || null,
    });
    broadcastUnreadIfNeeded(params.threadId);
    return;
  }

  if (method === 'item/started') {
    broadcast({ type: 'item_started', threadId: params.threadId, turnId: params.turnId, item: params.item });
    return;
  }

  if (method === 'item/completed') {
    broadcast({ type: 'item_completed', threadId: params.threadId, turnId: params.turnId, item: params.item });
    if (params.item?.type === 'agentMessage') {
      broadcastUnreadIfNeeded(params.threadId);
    }
    return;
  }

  if (method === 'item/agentMessage/delta') {
    broadcast({
      type: 'agent_delta',
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      delta: params.delta,
    });
    broadcastUnreadIfNeeded(params.threadId);
    return;
  }

  if (method === 'serverRequest/resolved') {
    const resolvedRequest = resolvePendingServerRequest(params.requestId);
    broadcast({
      type: 'server_request_resolved',
      threadId: resolvedRequest?.threadId || params.threadId || null,
      requestId: normalizeRequestId(params.requestId),
    });
    return;
  }

  if (method === 'error') {
    broadcast({ type: 'codex_error', threadId: params.threadId, error: params.error });
    return;
  }

  broadcast({ type: 'notification', method, params });
});

codex.on('log', (line) => {
  if (!line) {
    return;
  }
  console.log(`[codex] ${line}`);
});

codex.on('server_request', (msg) => {
  try {
    const request = upsertPendingServerRequest(createServerRequestRecord(msg));
    broadcast({ type: 'server_request_required', request: toClientServerRequest(request) });
    broadcastUnreadIfNeeded(request.threadId);
  } catch (error) {
    const requestId = Object.prototype.hasOwnProperty.call(msg, 'id') ? msg.id : null;
    if (requestId != null) {
      codex.respondError(requestId, {
        code: -32601,
        message: getErrorMessage(error) || 'unsupported server request',
      });
    }
    broadcast({
      type: 'warning',
      threadId: msg.params?.threadId || msg.params?.conversationId || null,
      message: `未处理的 Codex 请求：${msg.method}`,
    });
  }
});

codex.on('exit', ({ code, signal }) => {
  pendingServerRequests.clear();
  if (!shuttingDown) {
    broadcast({ type: 'backend_error', message: `codex app-server exited (code=${code}, signal=${signal})` });
  }
});

wss.on('connection', (ws, request) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  if (WS_TOKEN && requestUrl.searchParams.get('token') !== WS_TOKEN) {
    send(ws, {
      type: 'error',
      code: 'AUTH_FAILED',
      message: 'WebSocket 鉴权失败，请检查 token 是否正确。',
    });
    ws.close(4401, 'Unauthorized');
    return;
  }

  ws.activeThreadId = null;
  send(ws, { type: 'state', tabs: tabsList(), serverRequests: listPendingServerRequests() });

  ws.on('message', async (raw) => {
    let message;
    try {
      message = normalizeClientMessage(raw);
    } catch (error) {
      send(ws, { type: 'error', message: error.message });
      return;
    }

    try {
      if (message.type === 'tab_create') {
        const thread = await codex.startThread({ name: message.name || null });
        const tab = ensureTab(thread);

        try {
          await ensureWindowForThread(thread.id);
        } catch (error) {
          send(ws, {
            type: 'warning',
            message: `thread created but local codex window failed: ${error.message}`,
            threadId: thread.id,
          });
        }

        broadcast({ type: 'tab_updated', tab });
        send(ws, { type: 'tab_created', threadId: thread.id, tab });
        return;
      }

      if (message.type === 'tab_close') {
        await windows.closeWindow(message.threadId);
        try {
          await codex.archiveThread(message.threadId);
        } catch (error) {
          if (!isThreadNotFoundError(error)) {
            throw error;
          }
        }
        markTabClosed(message.threadId);
        return;
      }

      if (message.type === 'turn_send') {
        try {
          await ensureWindowForThread(message.threadId);
          await codex.startTurn(message.threadId, message.text);
        } catch (error) {
          if (isThreadNotFoundError(error)) {
            markTabClosed(message.threadId);
            send(ws, {
              type: 'error',
              code: 'THREAD_NOT_FOUND',
              op: 'turn_start',
              threadId: message.threadId,
              clientMessageId: message.clientMessageId,
              message: '该标签对应的会话在 Codex 中不存在，可能已被删除。请新建标签或关闭此标签后重试。',
            });
            return;
          }
          send(ws, {
            type: 'error',
            op: 'turn_start',
            threadId: message.threadId,
            clientMessageId: message.clientMessageId,
            message: getErrorMessage(error) || '服务端请求失败',
          });
          return;
        }
        return;
      }

      if (message.type === 'server_request_respond') {
        const request = getPendingServerRequest(message.requestId);
        if (!request) {
          send(ws, {
            type: 'error',
            code: 'REQUEST_NOT_FOUND',
            message: '待处理的批准请求不存在或已失效。',
          });
          return;
        }

        updatePendingServerRequest(message.requestId, {
          status: 'submitting',
          submittedAt: Date.now(),
        });
        broadcast({
          type: 'server_request_updated',
          request: toClientServerRequest(getPendingServerRequest(message.requestId)),
        });

        try {
          codex.respond(request.rawRequestId, message.response);
        } catch (error) {
          updatePendingServerRequest(message.requestId, {
            status: 'pending',
            submittedAt: null,
          });
          broadcast({
            type: 'server_request_updated',
            request: toClientServerRequest(getPendingServerRequest(message.requestId)),
          });
          send(ws, {
            type: 'error',
            threadId: request.threadId,
            message: getErrorMessage(error) || '批准响应发送失败',
          });
        }
        return;
      }

      if (message.type === 'thread_sync') {
        ws.activeThreadId = message.threadId;
        try {
          await ensureWindowForThread(message.threadId);
        } catch (error) {
          send(ws, {
            type: 'warning',
            message: `local codex window restore failed: ${error.message}`,
            threadId: message.threadId,
          });
        }
        await syncThreadToClients(ws, message.threadId);
      }
    } catch (error) {
      send(ws, { type: 'error', message: getErrorMessage(error) || '服务端请求失败' });
    }
  });
});

async function bootstrap() {
  await codex.start();
  windows.load();
  const threadList = await codex.listThreads(BOOTSTRAP_THREAD_LIMIT);

  await Promise.all(threadList.map(async (thread) => {
    let verifiedThread = thread;
    try {
      verifiedThread = await codex.readThread(thread.id);
    } catch (error) {
      if (isThreadNotFoundError(error)) {
        console.log(`[bootstrap] skip missing thread ${thread.id}`);
        return;
      }
      throw error;
    }

    const status = normalizeStatus(verifiedThread.status, 'idle');
    if (['closed', 'archived'].includes(status)) {
      return;
    }

    const windowPid = windows.getPid(verifiedThread.id);
    if (!windowPid) {
      return;
    }

    let windowAlive = false;
    try {
      windowAlive = await windows.isPidAlive(windowPid);
    } catch (error) {
      console.log(`[bootstrap] failed checking pid ${windowPid} for ${verifiedThread.id}: ${error.message}`);
      windowAlive = false;
    }

    if (!windowAlive) {
      return;
    }

    // Lazy: only register tab metadata, load full data on click
    const tab = ensureTab(verifiedThread);
    tab.status = 'idle';
    tab.updatedAt = nowUnix();
  }));

  server.listen(PORT, () => {
    console.log(`Web control ready: http://localhost:${PORT}`);
    void refreshAllTabWindowStatus().catch((error) => {
      console.log(`[bootstrap-window-check] failed: ${error.message}`);
    });
    startWindowStatusTimer();
  });
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[shutdown] received ${signal}`);

  if (windowStatusTimer) {
    clearInterval(windowStatusTimer);
    windowStatusTimer = null;
  }

  for (const timer of closedTabTimers.values()) {
    clearTimeout(timer);
  }
  closedTabTimers.clear();

  for (const client of wss.clients) {
    try {
      client.close(1001, 'server shutdown');
    } catch (_error) {
      // Ignore close failures during shutdown.
    }
  }

  await Promise.allSettled([
    closeWithTimeout(server, 'http server'),
    closeWithTimeout(wss, 'websocket server'),
    codex.stop(),
  ]);

  process.exit(0);
}

function closeWithTimeout(target, label) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        console.error(`[shutdown] timeout while closing ${label}`);
        settled = true;
        resolve();
      }
    }, 5000);
    timer.unref?.();

    target.close(() => {
      if (settled) {
        return;
      }
      clearTimeout(timer);
      settled = true;
      resolve();
    });
  });
}

function startWindowStatusTimer() {
  if (windowStatusTimer) {
    return;
  }

  windowStatusTimer = setInterval(() => {
    void refreshAllTabWindowStatus().catch((error) => {
      console.log(`[window-status] failed: ${error.message}`);
    });
  }, WINDOW_STATUS_REFRESH_MS);
  windowStatusTimer.unref?.();
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
