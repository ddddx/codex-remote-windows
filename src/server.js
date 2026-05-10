const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const express = require('express');
const { WebSocketServer } = require('ws');

const { CodexAppServerClient } = require('./codexAppServerClient');
const { CodexWindowManager } = require('./windowManager');
const { createWindowAttachmentService } = require('./windowAttachment');
const { applyLocalConfig } = require('./localConfig');
const { WorkspaceManager } = require('./workspaceManager');

applyLocalConfig();

const PORT = Number.parseInt(process.env.PORT || '18637', 10);
const WS_TOKEN = process.env.WS_TOKEN || '';
const MAX_CLIENT_MESSAGE_BYTES = parsePositiveInteger(process.env.MAX_CLIENT_MESSAGE_BYTES) || 65536;
const MAX_TURN_INPUT_LENGTH = parsePositiveInteger(process.env.MAX_TURN_INPUT_LENGTH) || 20000;
const MAX_TURN_ATTACHMENTS = parsePositiveInteger(process.env.MAX_TURN_ATTACHMENTS) || 8;
const MAX_TAB_NAME_LENGTH = parsePositiveInteger(process.env.MAX_TAB_NAME_LENGTH) || 120;
const MAX_WORKSPACE_PATH_LENGTH = parsePositiveInteger(process.env.MAX_WORKSPACE_PATH_LENGTH) || 2048;
const MAX_IMAGE_UPLOAD_BYTES = parsePositiveInteger(process.env.MAX_IMAGE_UPLOAD_BYTES) || (15 * 1024 * 1024);
const BOOTSTRAP_THREAD_LIMIT = parsePositiveInteger(process.env.BOOTSTRAP_THREAD_LIMIT) || 100;
const WINDOW_STATUS_REFRESH_MS = parsePositiveInteger(process.env.WINDOW_STATUS_REFRESH_MS) || 5000;
const THREAD_ID_REGEX = /^[0-9a-f]{8,12}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const APPROVAL_POLICIES = new Set(['untrusted', 'on-failure', 'on-request', 'never']);
const SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const STREAM_ITEM_DELTA_METHODS = new Set([
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
]);
const IMAGE_CONTENT_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/bmp', '.bmp'],
]);
const UPLOAD_ROOT = path.join(process.cwd(), '.codex-remote-uploads');

const app = express();
app.use(express.json({ limit: '32kb' }));
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
const workspaces = new WorkspaceManager({
  projectRoot: process.cwd(),
});

const tabs = new Map();
const closedTabTimers = new Map();
const pendingWindowOpens = new Map();
const pendingServerRequests = new Map();
let shuttingDown = false;
let windowStatusTimer = null;
let windowAttachments = null;

process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaught exception in web server:', error?.stack || error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection in web server:', reason);
  process.exit(1);
});

server.on('error', (error) => {
  console.error('[http] server error:', error?.stack || error);
  process.exit(1);
});

app.get('/api/workspace/shortcuts', (req, res) => {
  if (!isAuthorizedHttpRequest(req)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  res.json(workspaces.getShortcuts());
});

app.get('/api/workspace/list', (req, res) => {
  if (!isAuthorizedHttpRequest(req)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    res.json(workspaces.listDirectory(normalizeWorkspaceInput(req.query?.path)));
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) || '无法读取工作区目录' });
  }
});

app.post('/api/workspace/create-directory', (req, res) => {
  if (!isAuthorizedHttpRequest(req)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const createdPath = workspaces.createDirectory(
      normalizeWorkspaceInput(req.body?.parentPath),
      req.body?.folderName
    );
    res.json({ path: createdPath });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) || '无法创建工作区目录' });
  }
});

app.post('/api/uploads/image', express.raw({ type: 'image/*', limit: MAX_IMAGE_UPLOAD_BYTES }), async (req, res) => {
  if (!isAuthorizedHttpRequest(req)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const contentType = normalizeImageContentType(req.headers['content-type']);
    const originalName = decodeUploadFileName(req.headers['x-upload-filename']);
    const savedName = buildUploadFileName(originalName, contentType);
    const filePath = path.join(UPLOAD_ROOT, savedName);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) {
      throw new Error('图片内容为空');
    }

    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    await fsp.writeFile(filePath, body);

    res.json({
      id: savedName,
      name: originalName || savedName,
      contentType,
      filePath,
      url: `/api/uploads/${encodeURIComponent(savedName)}`,
    });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) || '图片上传失败' });
  }
});

app.get('/api/uploads/:fileName', (req, res) => {
  if (!isAuthorizedHttpRequest(req)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const resolved = resolveUploadedFile(req.params.fileName);
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ message: '图片不存在' });
      return;
    }
    res.sendFile(resolved);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) || '无法读取图片' });
  }
});

app.get('/api/codex/options', async (req, res) => {
  if (!isAuthorizedHttpRequest(req)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const cwd = normalizeWorkspaceInput(req.query?.cwd);
    const [models, configResponse] = await Promise.all([
      codex.listModels({ includeHidden: false }),
      codex.readConfig({ cwd: cwd || process.cwd() }),
    ]);
    const config = configResponse?.config || {};
    const defaultModel = typeof config.model === 'string' ? config.model : '';
    const defaultReasoningEffort = typeof config.model_reasoning_effort === 'string'
      ? config.model_reasoning_effort
      : '';
    const defaultApprovalPolicy = normalizeOptionalApprovalPolicy(config.approval_policy);
    const defaultSandboxMode = normalizeOptionalSandboxMode(config.sandbox_mode);

    res.json({
      models: models.map((model) => ({
        id: model.id || model.model || '',
        model: model.model || model.id || '',
        displayName: model.displayName || model.model || model.id || '',
        description: model.description || '',
        isDefault: model.isDefault === true,
        defaultReasoningEffort: model.defaultReasoningEffort || '',
        supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts
            .map((entry) => entry?.reasoningEffort || entry?.value || entry)
            .filter(Boolean)
          : [],
      })),
      defaults: {
        model: defaultModel,
        reasoningEffort: defaultReasoningEffort,
        approvalPolicy: defaultApprovalPolicy,
        sandboxMode: defaultSandboxMode,
      },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) || '无法读取 Codex 选项' });
  }
});

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

function isAuthorizedHttpRequest(req) {
  if (!WS_TOKEN) {
    return true;
  }

  const queryToken = typeof req.query?.token === 'string' ? req.query.token : '';
  const headerToken = typeof req.headers['x-codex-remote-token'] === 'string'
    ? req.headers['x-codex-remote-token']
    : '';
  return queryToken === WS_TOKEN || headerToken === WS_TOKEN;
}

function decodeUploadFileName(value) {
  if (Array.isArray(value)) {
    return decodeUploadFileName(value[0]);
  }
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeImageContentType(value) {
  if (Array.isArray(value)) {
    return normalizeImageContentType(value[0]);
  }
  const normalized = typeof value === 'string' ? value.trim().toLowerCase().split(';', 1)[0] : '';
  if (!IMAGE_CONTENT_TYPES.has(normalized)) {
    throw new Error('不支持的图片类型');
  }
  return normalized;
}

function sanitizeUploadBaseName(fileName) {
  const parsed = path.parse(String(fileName || '').trim());
  const stem = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return stem || 'image';
}

function buildUploadFileName(originalName, contentType) {
  const extension = IMAGE_CONTENT_TYPES.get(contentType) || '.bin';
  const safeBase = sanitizeUploadBaseName(originalName);
  return `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${safeBase}${extension}`;
}

function isPathInsideRoot(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveUploadedFile(fileName) {
  const normalized = path.basename(String(fileName || '').trim());
  if (!normalized) {
    throw new Error('invalid upload file');
  }
  const resolved = path.resolve(UPLOAD_ROOT, normalized);
  if (!isPathInsideRoot(UPLOAD_ROOT, resolved)) {
    throw new Error('invalid upload path');
  }
  return resolved;
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

function isThreadUnmaterializedError(error) {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes('not materialized yet')
    || message.includes('no rollout found')
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
  const persistedPrefs = workspaces.getThreadPrefs(thread.id);
  const detectedWindowPid = windows.getPid(thread.id);
  const threadWindowPid = Number.parseInt(thread.windowPid, 10);
  const existingWindowPid = Number.parseInt(existing?.windowPid, 10);
  const status = normalizeStatus(thread.status, existing?.status || 'idle');
  const hasExistingApprovalPolicy = !!existing && Object.prototype.hasOwnProperty.call(existing, 'approvalPolicy');
  const hasExistingSandboxMode = !!existing && Object.prototype.hasOwnProperty.call(existing, 'sandboxMode');
  const hasPersistedApprovalPolicy = Object.prototype.hasOwnProperty.call(persistedPrefs, 'approvalPolicy');
  const hasPersistedSandboxMode = Object.prototype.hasOwnProperty.call(persistedPrefs, 'sandboxMode');
  const threadApprovalPolicy = extractThreadApprovalPolicy(thread);
  const threadSandboxMode = extractThreadSandboxMode(thread);
  const tab = {
    threadId: thread.id,
    name: thread.name || existing?.name || makePreviewName(thread.preview),
    cwd: thread.cwd || existing?.cwd || process.cwd(),
    status,
    createdAt: thread.createdAt || existing?.createdAt || nowUnix(),
    updatedAt: thread.updatedAt || existing?.updatedAt || nowUnix(),
    windowPid: detectedWindowPid
      || (Number.isFinite(existingWindowPid) && existingWindowPid > 0 ? existingWindowPid : null)
      || (Number.isFinite(threadWindowPid) && threadWindowPid > 0 ? threadWindowPid : null),
    windowStatus: existing?.windowStatus || 'attached',
  };

  if (threadApprovalPolicy) {
    tab.approvalPolicy = threadApprovalPolicy;
  } else if (hasExistingApprovalPolicy) {
    tab.approvalPolicy = existing.approvalPolicy || '';
  } else if (hasPersistedApprovalPolicy) {
    tab.approvalPolicy = persistedPrefs.approvalPolicy || '';
  }

  if (threadSandboxMode) {
    tab.sandboxMode = threadSandboxMode;
  } else if (hasExistingSandboxMode) {
    tab.sandboxMode = existing.sandboxMode || '';
  } else if (hasPersistedSandboxMode) {
    tab.sandboxMode = persistedPrefs.sandboxMode || '';
  }

  if (threadApprovalPolicy || threadSandboxMode) {
    workspaces.setThreadPrefs(thread.id, {
      ...(threadApprovalPolicy ? { approvalPolicy: threadApprovalPolicy } : {}),
      ...(threadSandboxMode ? { sandboxMode: threadSandboxMode } : {}),
    });
  }

  tabs.set(thread.id, tab);
  if (status !== 'closed') {
    clearClosedTabCleanup(thread.id);
  }
  return tab;
}

function makePreviewName(preview) {
  if (!preview) {
    return '未命名会话';
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

function pruneClosedTabTimers() {
  for (const [threadId, timer] of closedTabTimers.entries()) {
    const tab = tabs.get(threadId);
    if (tab?.windowStatus === 'closed') {
      continue;
    }
    clearTimeout(timer);
    closedTabTimers.delete(threadId);
  }
}

function markTabClosed(threadId) {
  return windowAttachments?.markTabClosed(threadId) || null;
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
  return Array.from(tabs.values()).sort(compareTabs);
}

function compareTabs(a, b) {
  const aWindowClosed = a?.windowStatus === 'closed';
  const bWindowClosed = b?.windowStatus === 'closed';
  if (aWindowClosed !== bWindowClosed) {
    return aWindowClosed ? 1 : -1;
  }

  const updatedDiff = (b?.updatedAt || 0) - (a?.updatedAt || 0);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const createdDiff = (b?.createdAt || 0) - (a?.createdAt || 0);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return String(a?.threadId || '').localeCompare(String(b?.threadId || ''));
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

windowAttachments = createWindowAttachmentService({
  tabs,
  windows,
  pendingWindowOpens,
  nowUnix,
  clearClosedTabCleanup,
  broadcast,
});

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
  if (!windowAttachments) {
    return;
  }
  await windowAttachments.refreshTabWindowStatus(threadId, {
    allowDiscovery: true,
    allowLaunch: true,
    broadcastUpdate: true,
    touchUpdatedAt: true,
  });
}

async function syncThreadToClients(ws, threadId) {
  assertThreadId(threadId);
  let thread;
  let materialized = true;
  try {
    thread = await codex.resumeThread(threadId);
  } catch (error) {
    if (!isThreadUnmaterializedError(error)) {
      throw error;
    }

    materialized = false;
    const existingTab = tabs.get(threadId);
    if (!existingTab) {
      throw error;
    }

    thread = {
      id: threadId,
      name: existingTab.name,
      cwd: existingTab.cwd,
      status: existingTab.status || 'idle',
      createdAt: existingTab.createdAt || nowUnix(),
      updatedAt: existingTab.updatedAt || nowUnix(),
      turns: [],
    };
  }
  const tab = ensureTab(thread);
  send(ws, { type: 'tab_updated', tab });
  send(ws, {
    type: 'thread_sync',
    threadId,
    turns: thread.turns || [],
    tokenUsage: thread.tokenUsage || thread.token_usage || null,
  });
  return { thread, materialized };
}

async function refreshAllTabWindowStatus() {
  if (!windowAttachments) {
    return;
  }
  await windowAttachments.refreshAllTabsWindowStatus({
    broadcastUpdates: true,
    touchUpdatedAt: true,
  });
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
        cwd: normalizeWorkspaceInput(message.cwd),
        model: normalizeOptionalModel(message.model),
        approvalPolicy: normalizeOptionalApprovalPolicy(message.approvalPolicy),
        sandboxMode: normalizeOptionalSandboxMode(message.sandboxMode),
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
        text: normalizeOptionalTurnText(message.text),
        attachments: normalizeTurnAttachments(message.attachments),
        clientMessageId: normalizeOptionalClientMessageId(message.clientMessageId),
        model: normalizeOptionalModel(message.model),
        effort: normalizeOptionalReasoningEffort(message.effort),
        approvalPolicy: normalizeOptionalApprovalPolicy(message.approvalPolicy),
        sandboxMode: normalizeOptionalSandboxMode(message.sandboxMode),
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

function normalizeOptionalTurnText(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid text');
  }
  const normalized = value.trim();
  if (normalized.length > MAX_TURN_INPUT_LENGTH) {
    throw new Error(`text too long (max ${MAX_TURN_INPUT_LENGTH})`);
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

function normalizeOptionalModel(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid model');
  }
  return value.trim().slice(0, 200);
}

function normalizeOptionalReasoningEffort(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid reasoning effort');
  }
  const normalized = value.trim().toLowerCase();
  if (!REASONING_EFFORTS.has(normalized)) {
    throw new Error('invalid reasoning effort');
  }
  return normalized;
}

function normalizeOptionalApprovalPolicy(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid approval policy');
  }
  const normalized = value.trim().toLowerCase();
  if (!APPROVAL_POLICIES.has(normalized)) {
    throw new Error('invalid approval policy');
  }
  return normalized;
}

function normalizeOptionalSandboxMode(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid sandbox mode');
  }
  const normalized = value.trim().toLowerCase();
  if (!SANDBOX_MODES.has(normalized)) {
    throw new Error('invalid sandbox mode');
  }
  return normalized;
}

function normalizeTurnAttachments(value) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('attachments must be an array');
  }
  if (value.length > MAX_TURN_ATTACHMENTS) {
    throw new Error(`too many attachments (max ${MAX_TURN_ATTACHMENTS})`);
  }
  return value.map((entry) => normalizeTurnAttachment(entry));
}

function normalizeTurnAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid attachment');
  }
  const attachmentPath = normalizeWorkspaceInput(value.path);
  if (!attachmentPath) {
    throw new Error('attachment path required');
  }
  const resolved = path.resolve(attachmentPath);
  if (!isPathInsideRoot(UPLOAD_ROOT, resolved)) {
    throw new Error('attachment path out of range');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('attachment file not found');
  }
  return {
    path: resolved,
    name: normalizeOptionalString(value.name, 255) || path.basename(resolved),
  };
}

function toTurnSandboxPolicy(sandboxMode) {
  if (!sandboxMode) {
    return null;
  }
  if (sandboxMode === 'read-only') {
    return { type: 'readOnly' };
  }
  if (sandboxMode === 'workspace-write') {
    return { type: 'workspaceWrite' };
  }
  if (sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }
  return null;
}

function extractThreadApprovalPolicy(thread) {
  const raw = typeof thread?.approvalPolicy === 'string'
    ? thread.approvalPolicy
    : (typeof thread?.approval_policy === 'string' ? thread.approval_policy : '');
  return normalizeOptionalApprovalPolicy(raw);
}

function extractThreadSandboxMode(thread) {
  const raw = typeof thread?.sandbox === 'string'
    ? thread.sandbox
    : (typeof thread?.sandboxMode === 'string' ? thread.sandboxMode : '');
  return normalizeOptionalSandboxMode(raw);
}

function normalizeWorkspaceInput(value) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('invalid workspace path');
  }

  const normalized = value.trim();
  if (normalized.length > MAX_WORKSPACE_PATH_LENGTH) {
    throw new Error(`workspace path too long (max ${MAX_WORKSPACE_PATH_LENGTH})`);
  }
  return normalized;
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
      patch: typeof params.patch === 'string' ? params.patch : '',
      changes: Array.isArray(params.changes) ? params.changes : [],
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
    broadcast({
      type: 'turn_started',
      threadId: params.threadId,
      turnId: params.turn?.id || null,
      startedAt: params.turn?.startedAt || params.turn?.createdAt || Date.now(),
    });
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
    broadcast({
      type: 'item_started',
      threadId: params.threadId,
      turnId: params.turnId,
      item: params.item,
      startedAt: params.item?.startedAt || params.item?.createdAt || Date.now(),
    });
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
      startedAt: params.startedAt || Date.now(),
    });
    broadcastUnreadIfNeeded(params.threadId);
    return;
  }

  if (STREAM_ITEM_DELTA_METHODS.has(method)) {
    if (method === 'item/fileChange/patchUpdated') {
      const requestId = params.requestId != null ? String(params.requestId) : '';
      const request = requestId ? getPendingServerRequest(requestId) : null;
      if (request && (request.kind === 'file_change_approval' || request.kind === 'file_change_approval_legacy')) {
        updatePendingServerRequest(requestId, {
          patch: typeof params.patch === 'string' ? params.patch : (request.patch || ''),
          changes: Array.isArray(params.changes) ? params.changes : (request.changes || []),
        });
        broadcast({
          type: 'server_request_updated',
          request: toClientServerRequest(getPendingServerRequest(requestId)),
        });
      }
    }
    broadcast({
      type: 'item_delta',
      method,
      ...params,
      startedAt: params.startedAt || Date.now(),
    });
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
        const workspacePath = workspaces.resolveWorkspacePath(message.cwd || workspaces.getPreferredPath());
        const thread = await codex.startThread({
          name: message.name || null,
          cwd: workspacePath,
          model: message.model || null,
          approvalPolicy: message.approvalPolicy || null,
          sandbox: message.sandboxMode || null,
        });
        workspaces.rememberPath(workspacePath);
        const tab = ensureTab(thread);
        tab.approvalPolicy = message.approvalPolicy || '';
        tab.sandboxMode = message.sandboxMode || '';
        workspaces.setThreadPrefs(thread.id, {
          approvalPolicy: tab.approvalPolicy,
          sandboxMode: tab.sandboxMode,
        });

        broadcast({ type: 'tab_updated', tab });
        send(ws, { type: 'tab_created', threadId: thread.id, tab });
        return;
      }

      if (message.type === 'tab_close') {
        await windows.closeWindow(message.threadId);
        markTabClosed(message.threadId);
        return;
      }

      if (message.type === 'turn_send') {
        if (!message.text && !message.attachments.length) {
          send(ws, {
            type: 'error',
            op: 'turn_start',
            threadId: message.threadId,
            clientMessageId: message.clientMessageId,
            message: '消息内容不能为空。',
          });
          return;
        }
        try {
          await codex.startTurn(message.threadId, message.text, {
            attachments: message.attachments,
            model: message.model || null,
            effort: message.effort || null,
            approvalPolicy: message.approvalPolicy || null,
            sandboxPolicy: toTurnSandboxPolicy(message.sandboxMode),
          });
          const tab = tabs.get(message.threadId);
          if (tab) {
            tab.approvalPolicy = message.approvalPolicy || '';
            tab.sandboxMode = message.sandboxMode || '';
            tab.updatedAt = nowUnix();
            workspaces.setThreadPrefs(message.threadId, {
              approvalPolicy: tab.approvalPolicy,
              sandboxMode: tab.sandboxMode,
            });
            broadcast({ type: 'tab_updated', tab });
          }
          try {
            await ensureWindowForThread(message.threadId);
          } catch (error) {
            send(ws, {
              type: 'warning',
              message: `local codex window restore failed: ${error.message}`,
              threadId: message.threadId,
            });
          }
        } catch (error) {
          if (isThreadNotFoundError(error)) {
            removeTab(message.threadId, { broadcastRemoval: true });
            send(ws, {
              type: 'error',
              code: 'THREAD_NOT_FOUND',
              op: 'turn_start',
              threadId: message.threadId,
              clientMessageId: message.clientMessageId,
              message: '该会话在 Codex 中不存在，可能已被删除。请新建会话或关闭此会话后重试。',
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
        let syncResult;
        try {
          syncResult = await syncThreadToClients(ws, message.threadId);
        } catch (error) {
          if (isThreadNotFoundError(error)) {
            removeTab(message.threadId, { broadcastRemoval: true });
            send(ws, {
              type: 'error',
              code: 'THREAD_NOT_FOUND',
              threadId: message.threadId,
              message: '该会话在 Codex 中不存在，已从列表移除。',
            });
            return;
          }
          throw error;
        }
        if (!syncResult.materialized) {
          return;
        }
        try {
          await ensureWindowForThread(message.threadId);
        } catch (error) {
          send(ws, {
            type: 'warning',
            message: `local codex window restore failed: ${error.message}`,
            threadId: message.threadId,
          });
        }
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
  let discoveredWindows = null;
  if (windowAttachments) {
    try {
      discoveredWindows = await windowAttachments.snapshotDiscoveredWindows();
    } catch (error) {
      console.log(`[bootstrap-window-discovery] failed: ${error.message}`);
    }
  }

  await Promise.allSettled(threadList.map(async (thread) => {
    let verifiedThread = thread;
    try {
      verifiedThread = await codex.readThread(thread.id);
    } catch (error) {
      if (isThreadNotFoundError(error)) {
        console.log(`[bootstrap] skip missing thread ${thread.id}`);
        return;
      }
      console.log(`[bootstrap] skip unreadable thread ${thread.id}: ${getErrorMessage(error) || error.message}`);
      return;
    }

    const status = normalizeStatus(verifiedThread.status, 'idle');
    if (['closed', 'archived'].includes(status)) {
      return;
    }

    const tab = ensureTab(verifiedThread);
    tab.status = 'idle';
    if (windowAttachments) {
      await windowAttachments.refreshTabWindowStatus(verifiedThread.id, {
        allowDiscovery: true,
        allowLaunch: false,
        broadcastUpdate: false,
        touchUpdatedAt: false,
        discoveredWindows,
      });
    } else {
      tab.windowPid = null;
      tab.windowStatus = 'closed';
    }
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
