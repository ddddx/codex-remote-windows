let reconnectTimer = null;
let reconnectAttempt = 0;

const WEBSOCKET_TOKEN_STORAGE_KEY = 'codex-remote-ws-token';
const EMPTY_THREAD_KEY = '__empty__';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_PROMPT_PLACEHOLDER = '给当前标签对应的 Codex 发送指令...';

function getReconnectDelayMs(attempt) {
  const baseDelay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * (2 ** attempt));
  const jitter = 0.85 + (Math.random() * 0.3);
  return Math.round(baseDelay * jitter);
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function markAuthFailed(message) {
  clearReconnectTimer();
  reconnectAttempt = 0;
  const changed = !state.authFailed || state.connectionError !== message;
  state.authFailed = true;
  state.connectionError = message;
  if (changed) {
    render();
  }
  if (!modalState.resolve) {
    void promptForWebSocketToken({
      title: 'WebSocket 鉴权失败',
      label: '访问 Token',
      placeholder: '请输入服务端配置的 WS_TOKEN',
      defaultValue: getWebSocketToken(),
      confirmText: '保存并重连',
      inputType: 'password',
    });
  }
}

function clearConnectionError() {
  if (!state.authFailed && !state.connectionError) {
    return;
  }
  state.authFailed = false;
  state.connectionError = '';
  render();
}

function isAuthFailureClose(event) {
  return event.code === 4401 || event.reason === 'Unauthorized';
}

function getWebSocketToken() {
  const queryToken = new URLSearchParams(window.location.search).get('token');
  try {
    if (queryToken) {
      window.localStorage.setItem(WEBSOCKET_TOKEN_STORAGE_KEY, queryToken);
      return queryToken;
    }
    return window.localStorage.getItem(WEBSOCKET_TOKEN_STORAGE_KEY) || '';
  } catch (_error) {
    return queryToken || '';
  }
}

function setWebSocketToken(token) {
  const normalized = typeof token === 'string' ? token.trim() : '';
  try {
    if (normalized) {
      window.localStorage.setItem(WEBSOCKET_TOKEN_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(WEBSOCKET_TOKEN_STORAGE_KEY);
    }
  } catch (_error) {
    // Ignore storage failures and still keep the token in the URL.
  }

  try {
    const nextUrl = new URL(window.location.href);
    if (normalized) {
      nextUrl.searchParams.set('token', normalized);
    } else {
      nextUrl.searchParams.delete('token');
    }
    window.history.replaceState(null, '', nextUrl);
  } catch (_error) {
    // Ignore URL rewrite failures.
  }

  return normalized;
}

function disconnectSocket() {
  const socket = window._ws;
  window._ws = null;
  if (!socket) {
    return;
  }

  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

function reconnectNow() {
  clearReconnectTimer();
  reconnectAttempt = 0;
  disconnectSocket();
  connect();
}

async function promptForWebSocketToken(options = {}) {
  const token = await openTextModal({
    title: options.title || '设置 WebSocket Token',
    label: options.label || '访问 Token',
    placeholder: options.placeholder || '请输入服务端配置的 WS_TOKEN',
    defaultValue: options.defaultValue ?? getWebSocketToken(),
    confirmText: options.confirmText || '保存并重连',
    inputType: options.inputType || 'password',
  });

  if (token === null) {
    return false;
  }

  setWebSocketToken(token);
  clearConnectionError();
  reconnectNow();
  return true;
}

function scheduleReconnect() {
  if (reconnectTimer || state.authFailed) {
    return;
  }

  const delay = getReconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  console.log(`ws closed, reconnecting in ${Math.round(delay / 1000)}s...`);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = new URL(`${wsProtocol}://${window.location.host}/ws`);
  const token = getWebSocketToken();
  if (token) {
    wsUrl.searchParams.set('token', token);
  }

  const socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('ws connected');
    reconnectAttempt = 0;
    clearReconnectTimer();
    clearConnectionError();
    if (state.activeThreadId) {
      send({ type: 'thread_sync', threadId: state.activeThreadId });
    }
  };

  socket.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (error) {
      console.error('ws parse error', error);
    }
  };

  socket.onclose = (event) => {
    if (isAuthFailureClose(event)) {
      markAuthFailed('WebSocket 鉴权失败，请检查 token 是否正确，然后刷新页面重试。');
      return;
    }
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error('ws error', error);
    socket.close();
  };

  window._ws = socket;
}

connect();

// DOM
const sidebar = document.getElementById('sidebar');
const sidebarClose = document.getElementById('sidebarClose');
const menuBtn = document.getElementById('menuBtn');
const tabList = document.getElementById('tabList');
const newTabBtn = document.getElementById('newTabBtn');
const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const promptInput = document.getElementById('promptInput');
const composerSubmitBtn = composer.querySelector('button[type="submit"]');
const activeTitle = document.getElementById('activeTitle');
const tokenBtn = document.getElementById('tokenBtn');
const activeStatus = document.getElementById('activeStatus');
const mainArea = document.querySelector('.main-area');
const tabTpl = document.getElementById('tabTpl');
const textModal = document.getElementById('textModal');
const textModalForm = document.getElementById('textModalForm');
const modalTitle = document.getElementById('modalTitle');
const modalLabel = document.getElementById('modalLabel');
const modalInput = document.getElementById('modalInput');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');

const state = {
  tabs: [],
  activeThreadId: null,
  itemsByThread: new Map(),
  partialByThread: new Map(),
  turnActiveByThread: new Map(),
  unreadThreadIds: new Set(),
  pendingUserMessages: new Map(),
  serverRequests: [],
  creatingTab: false,
  authFailed: false,
  connectionError: '',
};

const messageDomByThread = new Map();
const modalState = {
  resolve: null,
  previousFocus: null,
};

function send(payload) {
  if (window._ws && window._ws.readyState === WebSocket.OPEN) {
    window._ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function createLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) {
    return '';
  }

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/\n/g, '<br>');

  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(html);
  }
  return html;
}

function ensureItems(threadId) {
  if (!state.itemsByThread.has(threadId)) {
    state.itemsByThread.set(threadId, []);
  }
  return state.itemsByThread.get(threadId);
}

function ensurePartials(threadId) {
  if (!state.partialByThread.has(threadId)) {
    state.partialByThread.set(threadId, new Map());
  }
  return state.partialByThread.get(threadId);
}

function ensureMessageDomMap(threadKey) {
  if (!messageDomByThread.has(threadKey)) {
    messageDomByThread.set(threadKey, new Map());
  }
  return messageDomByThread.get(threadKey);
}

function registerPendingUserMessage(clientMessageId, threadId, itemId, text) {
  if (!clientMessageId) {
    return;
  }
  state.pendingUserMessages.set(clientMessageId, {
    threadId,
    itemId,
    text: typeof text === 'string' ? text.trim() : '',
  });
}

function removeItemById(threadId, itemId) {
  const items = state.itemsByThread.get(threadId);
  if (!items?.length) {
    return false;
  }
  const nextItems = items.filter((item) => item.id !== itemId);
  if (nextItems.length === items.length) {
    return false;
  }
  state.itemsByThread.set(threadId, nextItems);
  return true;
}

function rollbackPendingUserMessage(clientMessageId) {
  const pending = state.pendingUserMessages.get(clientMessageId);
  if (!pending) {
    return false;
  }
  state.pendingUserMessages.delete(clientMessageId);
  return removeItemById(pending.threadId, pending.itemId);
}

function prunePendingUserMessages(threadId) {
  const existingIds = new Set((state.itemsByThread.get(threadId) || []).map((item) => item.id));
  for (const [clientMessageId, pending] of state.pendingUserMessages.entries()) {
    if (pending.threadId === threadId && !existingIds.has(pending.itemId)) {
      state.pendingUserMessages.delete(clientMessageId);
    }
  }
}

function removePendingUserMessagesForThread(threadId) {
  for (const [clientMessageId, pending] of state.pendingUserMessages.entries()) {
    if (pending.threadId === threadId) {
      state.pendingUserMessages.delete(clientMessageId);
    }
  }
}

function getUserMessageText(item) {
  if (!item || item.type !== 'userMessage') {
    return '';
  }

  return (item.content || [])
    .filter((entry) => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
    .trim();
}

function reconcilePendingUserMessage(threadId, item) {
  const text = getUserMessageText(item);
  if (!text) {
    return false;
  }

  for (const [clientMessageId, pending] of state.pendingUserMessages.entries()) {
    if (pending.threadId !== threadId || pending.text !== text) {
      continue;
    }

    state.pendingUserMessages.delete(clientMessageId);
    removeItemById(threadId, pending.itemId);
    return true;
  }

  return false;
}

function reconcilePendingUserMessagesFromSync(threadId, items) {
  for (const item of items) {
    reconcilePendingUserMessage(threadId, item);
  }
}

function pruneUnreadThreads() {
  const validThreadIds = new Set(state.tabs.map((tab) => tab.threadId));
  for (const threadId of state.unreadThreadIds) {
    if (!validThreadIds.has(threadId)) {
      state.unreadThreadIds.delete(threadId);
    }
  }
}

function markThreadUnread(threadId) {
  if (!threadId || threadId === state.activeThreadId) {
    return false;
  }
  if (!state.tabs.some((tab) => tab.threadId === threadId)) {
    return false;
  }
  const sizeBefore = state.unreadThreadIds.size;
  state.unreadThreadIds.add(threadId);
  return state.unreadThreadIds.size !== sizeBefore;
}

function normalizeServerRequestStatus(status) {
  return status === 'submitting' ? 'submitting' : 'pending';
}

function upsertServerRequest(request) {
  if (!request || !request.requestId) {
    return;
  }

  const normalized = {
    ...request,
    status: normalizeServerRequestStatus(request.status),
  };
  const index = state.serverRequests.findIndex((entry) => entry.requestId === normalized.requestId);
  if (index >= 0) {
    state.serverRequests[index] = normalized;
  } else {
    state.serverRequests.push(normalized);
  }
  state.serverRequests.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function removeServerRequest(requestId) {
  state.serverRequests = state.serverRequests.filter((entry) => entry.requestId !== requestId);
}

function getServerRequestsForThread(threadId) {
  return state.serverRequests.filter((entry) => entry.threadId === threadId);
}

function hasPendingServerRequest(threadId) {
  return state.serverRequests.some((entry) => entry.threadId === threadId);
}

function findPendingRequestForItem(threadId, itemId) {
  if (!threadId || !itemId) {
    return null;
  }
  return state.serverRequests.find((entry) => entry.threadId === threadId && entry.itemId === itemId) || null;
}

function upsertTab(tab) {
  const index = state.tabs.findIndex((entry) => entry.threadId === tab.threadId);
  if (index >= 0) {
    state.tabs[index] = tab;
  } else {
    state.tabs.push(tab);
  }

  state.tabs.sort((a, b) => b.updatedAt - a.updatedAt);
  if (!state.activeThreadId) {
    setActiveTab(tab.threadId);
  }
}

function removeTab(threadId) {
  state.tabs = state.tabs.filter((tab) => tab.threadId !== threadId);
  state.itemsByThread.delete(threadId);
  state.partialByThread.delete(threadId);
  state.turnActiveByThread.delete(threadId);
  state.serverRequests = state.serverRequests.filter((entry) => entry.threadId !== threadId);
  removePendingUserMessagesForThread(threadId);
  state.unreadThreadIds.delete(threadId);
  messageDomByThread.delete(threadId);

  if (state.activeThreadId === threadId) {
    state.activeThreadId = state.tabs[0]?.threadId || null;
    if (state.activeThreadId) {
      send({ type: 'thread_sync', threadId: state.activeThreadId });
    }
  }

  render();
}

function markTabClosedLocally(threadId) {
  if (!threadId) {
    return false;
  }
  const tab = state.tabs.find((entry) => entry.threadId === threadId);
  if (!tab) {
    return false;
  }

  tab.status = 'closed';
  tab.updatedAt = Math.floor(Date.now() / 1000);
  state.turnActiveByThread.set(threadId, false);
  return true;
}

function setActiveTab(threadId, options = {}) {
  const { skipSync = false } = options;
  if (!threadId) {
    return;
  }

  if (!state.tabs.some((entry) => entry.threadId === threadId)) {
    upsertTab({
      threadId,
      name: 'New Tab',
      status: 'idle',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      windowPid: null,
    });
  }

  state.activeThreadId = threadId;
  state.unreadThreadIds.delete(threadId);
  if (!skipSync && !send({ type: 'thread_sync', threadId })) {
    const items = ensureItems(threadId);
    items.push({
      type: '_warning',
      id: createLocalId('ws'),
      text: '连接尚未建立，已自动重连。连接恢复后会同步消息。',
    });
  }
  render();
}

function syncTurns(threadId, turns) {
  const syncedItems = [];
  for (const turn of turns || []) {
    for (const item of turn.items || []) {
      syncedItems.push(item);
    }
  }

  reconcilePendingUserMessagesFromSync(threadId, syncedItems);

  const existing = state.itemsByThread.get(threadId) || [];
  const syncedIds = new Set(syncedItems.map((item) => item.id));
  const partials = state.partialByThread.get(threadId) || new Map();
  const merged = [...syncedItems];

  for (const item of existing) {
    const isLocalNotice = item.type === '_error' || item.type === '_warning';
    const isPartial = item._partial || partials.has(item.id);
    if (isLocalNotice && !syncedIds.has(item.id)) {
      merged.push(item);
      continue;
    }
    if (isPartial && !syncedIds.has(item.id)) {
      partials.delete(item.id);
    }
  }

  for (const itemId of Array.from(partials.keys())) {
    if (!syncedIds.has(itemId)) {
      partials.delete(itemId);
    }
  }

  state.itemsByThread.set(threadId, dedupeItems(merged));
  if (partials.size) {
    state.partialByThread.set(threadId, partials);
  } else {
    state.partialByThread.delete(threadId);
  }
  prunePendingUserMessages(threadId);

  const lastTurn = turns?.[turns.length - 1];
  const lastTurnStatus = normalizeTurnStatus(lastTurn?.status);
  if (['completed', 'failed', 'cancelled', 'aborted', 'idle'].includes(lastTurnStatus)) {
    state.partialByThread.delete(threadId);
    state.turnActiveByThread.set(threadId, false);
  } else if (lastTurnStatus === 'inProgress') {
    state.turnActiveByThread.set(threadId, true);
  }
}

function dedupeItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.type}:${item.id || ''}:${item.text || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function normalizeTurnStatus(status) {
  const raw = typeof status === 'object' && status ? status.type : status;
  if (typeof raw !== 'string') {
    return '';
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  const compact = trimmed.replace(/[\s_-]/g, '').toLowerCase();
  if (compact === 'inprogress' || compact === 'active' || compact === 'running') {
    return 'inProgress';
  }
  if (compact === 'completed' || compact === 'succeeded') {
    return 'completed';
  }
  if (compact === 'failed' || compact === 'systemerror') {
    return 'failed';
  }
  if (compact === 'cancelled' || compact === 'aborted' || compact === 'idle') {
    return compact;
  }
  return trimmed;
}

function upsertStreamingItem(threadId, itemId, delta) {
  if (!itemId) {
    return;
  }

  const items = ensureItems(threadId);
  const partials = ensurePartials(threadId);
  const current = partials.get(itemId) || '';
  partials.set(itemId, current + delta);

  let existing = items.find((entry) => entry.type === 'agentMessage' && entry.id === itemId);
  if (existing) {
    existing.text = partials.get(itemId);
    existing._partial = true;
    return;
  }

  existing = { type: 'agentMessage', id: itemId, text: partials.get(itemId), _partial: true };
  items.push(existing);
}

function finalizeItem(threadId, item) {
  if (!item || !item.id) {
    return;
  }

  const items = ensureItems(threadId);
  const partials = ensurePartials(threadId);
  partials.delete(item.id);

  const index = items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    items[index] = { ...item, _partial: false };
    return;
  }

  items.push({ ...item, _partial: false });
}

function renderTabs() {
  tabList.innerHTML = '';
  for (const tab of state.tabs) {
    const status = normalizeTabStatus(tab.status);
    const isClosed = status === 'closed';
    const isWaitingApproval = !isClosed && hasPendingServerRequest(tab.threadId);
    const hasUnread = state.unreadThreadIds.has(tab.threadId) && tab.threadId !== state.activeThreadId;
    const node = tabTpl.content.firstElementChild.cloneNode(true);
    node.dataset.threadId = tab.threadId;
    node.classList.toggle('active', tab.threadId === state.activeThreadId);
    node.classList.toggle('closed', isClosed);
    node.classList.toggle('has-unread', hasUnread);
    node.querySelector('.name').textContent = tab.name || 'New Tab';
    const meta = node.querySelector('.meta');
    meta.replaceChildren();
    const statusDot = document.createElement('span');
    statusDot.className = `status-dot ${isClosed ? 'closed' : (isWaitingApproval ? 'waiting' : 'open')}`;
    const statusText = document.createElement('span');
    statusText.className = 'status-text';
    statusText.textContent = isClosed ? '已关闭' : (isWaitingApproval ? '待批准' : '在线');
    meta.append(statusDot, statusText);

    node.querySelector('.close').addEventListener('click', (event) => {
      event.stopPropagation();
      send({ type: 'tab_close', threadId: tab.threadId });
    });

    node.addEventListener('click', () => setActiveTab(tab.threadId));
    tabList.appendChild(node);
  }
}

function normalizeTabStatus(status) {
  const raw = typeof status === 'object' && status ? status.type : status;
  if (typeof raw !== 'string') {
    return 'idle';
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return 'idle';
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

function renderHeader() {
  const tab = state.tabs.find((entry) => entry.threadId === state.activeThreadId);
  activeTitle.textContent = tab ? (tab.name || 'New Tab') : 'Codex Remote Control';
  tokenBtn.textContent = state.authFailed ? '设置 Token' : 'Token';
  tokenBtn.classList.toggle('btn-alert', state.authFailed);

  if (state.authFailed) {
    activeStatus.textContent = '鉴权失败';
    activeStatus.className = 'status-badge failed';
    return;
  }

  if (state.creatingTab) {
    activeStatus.textContent = '创建中';
    activeStatus.className = 'status-badge running';
    return;
  }

  if (tab && hasPendingServerRequest(tab.threadId)) {
    activeStatus.textContent = '待批准';
    activeStatus.className = 'status-badge waiting';
    return;
  }

  const status = tab ? normalizeTabStatus(tab.status) : '';
  activeStatus.textContent = status === 'closed' ? '已关闭' : status;
  activeStatus.className = 'status-badge';
  if (status === 'running' || status === 'active') {
    activeStatus.classList.add('running');
  }
  if (status === 'failed' || status === 'systemError') {
    activeStatus.classList.add('failed');
  }
  if (status === 'closed') {
    activeStatus.classList.add('closed');
  }
}

function renderComposer() {
  const disabled = state.authFailed;
  promptInput.disabled = disabled;
  composerSubmitBtn.disabled = disabled;
  promptInput.placeholder = disabled
    ? 'WebSocket 鉴权失败，请点击右上角“设置 Token”。'
    : DEFAULT_PROMPT_PLACEHOLDER;
}

function renderMessages() {
  const threadKey = state.activeThreadId || EMPTY_THREAD_KEY;
  const entries = buildMessageEntries(state.activeThreadId);
  const domMap = ensureMessageDomMap(threadKey);
  const nextKeys = new Set(entries.map((entry) => entry.key));
  const shouldStickToBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 24;

  for (const [key] of domMap) {
    if (!nextKeys.has(key)) {
      domMap.delete(key);
    }
  }

  const orderedNodes = [];
  for (const entry of entries) {
    let record = domMap.get(entry.key);
    if (!record) {
      record = { node: document.createElement('div'), signature: '' };
      domMap.set(entry.key, record);
    }

    if (record.signature !== entry.signature) {
      populateMessageNode(record.node, entry);
      record.signature = entry.signature;
    }

    orderedNodes.push(record.node);
  }

  orderedNodes.forEach((node, index) => {
    const current = messagesEl.childNodes[index];
    if (current !== node) {
      messagesEl.insertBefore(node, current || null);
    }
  });

  while (messagesEl.childNodes.length > orderedNodes.length) {
    messagesEl.removeChild(messagesEl.lastChild);
  }

  if (shouldStickToBottom || entries.some((entry) => entry.kind === 'thinking' || entry.partial)) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function buildMessageEntries(threadId) {
  const connectionEntries = state.connectionError
    ? [{
      key: '__connection_error__',
      kind: '_error',
      text: state.connectionError,
      signature: JSON.stringify(['connection_error', state.connectionError]),
    }]
    : [];

  if (!threadId) {
    if (connectionEntries.length) {
      return connectionEntries;
    }
    if (state.creatingTab) {
      return [{
        key: 'creating',
        kind: 'empty',
        text: '正在新建会话并拉起本地 Codex 窗口...',
        signature: 'creating',
      }];
    }
    return [{
      key: 'empty',
      kind: 'empty',
      text: '还没有标签，点左侧 "+ 新建标签" 开始。',
      signature: 'empty',
    }];
  }

  const items = ensureItems(threadId);
  const partials = state.partialByThread.get(threadId) || new Map();
  const entries = items.map((item, index) => buildEntryFromItem(threadId, item, partials, index));
  const requestEntries = getServerRequestsForThread(threadId).map((request) => buildEntryFromServerRequest(request));
  entries.push(...requestEntries);

  const hasPartialAgent = items.some((item) => item.type === 'agentMessage' && (item._partial || partials.has(item.id)));
  if (state.turnActiveByThread.get(threadId) && !hasPartialAgent) {
    entries.push({
      key: '__thinking__',
      kind: 'thinking',
      signature: 'thinking',
    });
  }

  return connectionEntries.concat(entries);
}

function buildEntryFromItem(threadId, item, partials, index) {
  const key = `${item.type}:${item.id || index}`;

  if (item.type === 'userMessage') {
    const text = (item.content || [])
      .filter((entry) => entry.type === 'text')
      .map((entry) => entry.text)
      .join('\n');
    return {
      key,
      kind: 'user',
      text,
      signature: JSON.stringify(['user', key, text]),
    };
  }

  if (item.type === 'agentMessage') {
    const partial = item._partial || partials.has(item.id);
    const text = partial ? (partials.get(item.id) || item.text || '') : (item.text || '');
    return {
      key,
      kind: 'agent',
      text,
      partial,
      phase: item.phase || '',
      signature: JSON.stringify(['agent', key, text, partial, item.phase || '']),
    };
  }

  if (item.type === 'reasoning') {
    const summary = (item.summary || []).map((entry) => entry.text || entry).join('\n');
    return {
      key,
      kind: 'reasoning',
      text: summary,
      signature: JSON.stringify(['reasoning', key, summary]),
    };
  }

  if (item.type === 'webSearch') {
    const desc = describeWebSearch(item);
    return {
      key,
      kind: 'tool',
      label: desc,
      signature: JSON.stringify(['tool', key, desc]),
    };
  }

  if (item.type === 'commandExecution') {
    const command = item.command || item.input || '';
    const pendingRequest = findPendingRequestForItem(threadId, item.id);
    const status = pendingRequest ? 'pendingApproval' : (item.status || '');
    const output = item.aggregatedOutput || item.output || '';
    return {
      key,
      kind: 'command',
      command: typeof command === 'string' ? command : JSON.stringify(command),
      status,
      output,
      signature: JSON.stringify(['command', key, command, status, output]),
    };
  }

  if (item.type === 'fileChange') {
    const pendingRequest = findPendingRequestForItem(threadId, item.id);
    const status = pendingRequest ? 'pendingApproval' : (item.status || '');
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return {
      key,
      kind: 'fileChange',
      status,
      changes,
      signature: JSON.stringify(['fileChange', key, status, JSON.stringify(changes)]),
    };
  }

  if (item.type === '_error' || item.type === '_warning') {
    return {
      key,
      kind: item.type,
      text: item.text || '',
      signature: JSON.stringify([item.type, key, item.text || '']),
    };
  }

  return {
    key,
    kind: 'generic',
    label: item.type || 'unknown',
    preview: JSON.stringify(item, null, 2).substring(0, 500),
    signature: JSON.stringify(['generic', key, item.type || 'unknown', JSON.stringify(item)]),
  };
}

function buildEntryFromServerRequest(request) {
  const summary = JSON.stringify([
    request.kind,
    request.status,
    request.reason || '',
    request.command || '',
    request.cwd || '',
    request.grantRoot || '',
    JSON.stringify(request.permissions || {}),
    JSON.stringify(request.questions || []),
    JSON.stringify(request.fileChanges || {}),
  ]);

  return {
    key: `server_request:${request.requestId}`,
    kind: 'serverRequest',
    request,
    signature: summary,
  };
}

function describeWebSearch(item) {
  const action = item.action || {};
  if (action.type === 'search') {
    return `🔍 搜索 "${action.query || item.query || ''}"`;
  }
  if (action.type === 'openPage') {
    return `🌐 打开 ${action.url || ''}`;
  }
  return `🔍 ${item.query || JSON.stringify(action)}`;
}

function populateMessageNode(node, entry) {
  node.className = 'message';
  node.replaceChildren();

  if (entry.kind === 'empty') {
    node.classList.add('empty-state');
    node.textContent = entry.text;
    return;
  }

  if (entry.kind === 'thinking') {
    node.classList.add('agent', 'thinking');
    node.appendChild(createDot());
    node.appendChild(createDot());
    node.appendChild(createDot());
    return;
  }

  if (entry.kind === 'user') {
    node.classList.add('user');
    node.textContent = entry.text;
    return;
  }

  if (entry.kind === 'agent') {
    node.classList.add('agent');
    if (entry.phase && entry.phase !== 'final_answer') {
      const phase = document.createElement('div');
      phase.className = 'item-phase';
      phase.textContent = entry.phase;
      node.appendChild(phase);
    }

    const body = createMessageBody(renderMarkdown(entry.text));
    node.appendChild(body);
    if (entry.partial) {
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      cursor.textContent = ' ▌';
      body.appendChild(cursor);
    }
    return;
  }

  if (entry.kind === 'reasoning') {
    node.classList.add('reasoning');
    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = entry.text ? '思考' : '思考中...';
    node.appendChild(label);
    if (entry.text) {
      node.appendChild(createMessageBody(renderMarkdown(entry.text)));
    }
    return;
  }

  if (entry.kind === 'tool') {
    node.classList.add('tool-call');
    node.textContent = entry.label;
    return;
  }

  if (entry.kind === 'command') {
    node.classList.add('tool-call');
    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = `${commandStatusIcon(entry.status)} 命令执行`;
    node.appendChild(label);

    const code = document.createElement('code');
    code.textContent = entry.command;
    node.appendChild(code);

    if (entry.output) {
      const output = document.createElement('pre');
      output.className = 'cmd-output';
      output.textContent = entry.output;
      node.appendChild(output);
    }
    return;
  }

  if (entry.kind === 'fileChange') {
    node.classList.add('tool-call');
    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = `${commandStatusIcon(entry.status)} 文件修改`;
    node.appendChild(label);

    const changes = document.createElement('div');
    changes.className = 'file-change-list';
    for (const change of entry.changes.slice(0, 6)) {
      const line = document.createElement('div');
      line.className = 'file-change-entry';
      line.textContent = `${formatFileChangeKind(change.kind)} ${change.path}`;
      changes.appendChild(line);
    }
    if (entry.changes.length > 6) {
      const more = document.createElement('div');
      more.className = 'file-change-entry muted';
      more.textContent = `还有 ${entry.changes.length - 6} 项未展开`;
      changes.appendChild(more);
    }
    node.appendChild(changes);
    return;
  }

  if (entry.kind === 'serverRequest') {
    node.classList.add('approval-card');
    populateServerRequestNode(node, entry.request);
    return;
  }

  if (entry.kind === '_error' || entry.kind === '_warning') {
    node.classList.add(entry.kind);
    node.textContent = entry.text;
    return;
  }

  node.classList.add('tool-call');
  const label = document.createElement('div');
  label.className = 'item-label';
  label.textContent = `⚙ ${entry.label}`;
  node.appendChild(label);

  const preview = document.createElement('pre');
  preview.textContent = entry.preview;
  node.appendChild(preview);
}

function formatFileChangeKind(kind) {
  if (kind === 'add') {
    return '新增';
  }
  if (kind === 'delete') {
    return '删除';
  }
  if (kind === 'update') {
    return '修改';
  }
  return '变更';
}

function populateServerRequestNode(node, request) {
  const title = document.createElement('div');
  title.className = 'item-label';
  title.textContent = describeServerRequestTitle(request);
  node.appendChild(title);

  if (request.reason) {
    const reason = document.createElement('div');
    reason.className = 'approval-reason';
    reason.textContent = request.reason;
    node.appendChild(reason);
  }

  if (request.command) {
    const code = document.createElement('code');
    code.textContent = request.command;
    node.appendChild(code);
  }

  if (request.cwd) {
    const cwd = document.createElement('div');
    cwd.className = 'approval-meta';
    cwd.textContent = `目录: ${request.cwd}`;
    node.appendChild(cwd);
  }

  if (request.grantRoot) {
    const grantRoot = document.createElement('div');
    grantRoot.className = 'approval-meta';
    grantRoot.textContent = `授权根目录: ${request.grantRoot}`;
    node.appendChild(grantRoot);
  }

  if (request.kind === 'permissions_approval') {
    const permissionList = document.createElement('div');
    permissionList.className = 'approval-meta';
    permissionList.textContent = describePermissions(request.permissions);
    node.appendChild(permissionList);
  }

  if ((request.kind === 'file_change_approval_legacy') && request.fileChanges) {
    const changes = document.createElement('div');
    changes.className = 'file-change-list';
    Object.entries(request.fileChanges).slice(0, 6).forEach(([filePath, change]) => {
      const line = document.createElement('div');
      line.className = 'file-change-entry';
      line.textContent = `${formatFileChangeKind(change?.kind || change?.type)} ${filePath}`;
      changes.appendChild(line);
    });
    node.appendChild(changes);
  }

  if (request.kind === 'user_input') {
    renderUserInputRequest(node, request);
    return;
  }

  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const submitting = request.status === 'submitting';

  if (request.kind === 'permissions_approval') {
    actions.appendChild(createActionButton('允许本次', submitting, () => {
      submitServerRequestResponse(request, {
        permissions: request.permissions || {},
        scope: 'turn',
      });
    }));
    actions.appendChild(createActionButton('允许本会话', submitting, () => {
      submitServerRequestResponse(request, {
        permissions: request.permissions || {},
        scope: 'session',
      });
    }));
    actions.appendChild(createActionButton('拒绝', submitting, () => {
      submitServerRequestResponse(request, {
        permissions: {},
        scope: 'turn',
      });
    }, 'btn-secondary'));
  } else {
    actions.appendChild(createActionButton('批准', submitting, () => {
      submitServerRequestResponse(request, {
        decision: request.kind.startsWith('file_change_approval_legacy') || request.kind.startsWith('command_approval_legacy')
          ? 'approved'
          : 'accept',
      });
    }));
    actions.appendChild(createActionButton('本会话允许', submitting, () => {
      submitServerRequestResponse(request, {
        decision: request.kind.startsWith('file_change_approval_legacy') || request.kind.startsWith('command_approval_legacy')
          ? 'approved_for_session'
          : 'acceptForSession',
      });
    }));
    actions.appendChild(createActionButton('拒绝', submitting, () => {
      submitServerRequestResponse(request, {
        decision: request.kind.startsWith('file_change_approval_legacy') || request.kind.startsWith('command_approval_legacy')
          ? 'denied'
          : 'decline',
      });
    }, 'btn-secondary'));
  }

  node.appendChild(actions);

  if (submitting) {
    const pending = document.createElement('div');
    pending.className = 'approval-meta';
    pending.textContent = '已提交，等待 Codex 确认...';
    node.appendChild(pending);
  }
}

function renderUserInputRequest(node, request) {
  const form = document.createElement('form');
  form.className = 'approval-form';
  const submitting = request.status === 'submitting';

  for (const question of request.questions || []) {
    const block = document.createElement('div');
    block.className = 'approval-question';

    const header = document.createElement('div');
    header.className = 'approval-question-header';
    header.textContent = question.header || question.question || question.id;
    block.appendChild(header);

    const prompt = document.createElement('div');
    prompt.className = 'approval-meta';
    prompt.textContent = question.question || '';
    block.appendChild(prompt);

    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length) {
      const optionList = document.createElement('div');
      optionList.className = 'approval-options';
      options.forEach((option, index) => {
        const label = document.createElement('label');
        label.className = 'approval-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `question-${question.id}`;
        radio.value = option.label;
        radio.disabled = submitting;
        if (index === 0 && !question.isOther) {
          radio.checked = true;
        }
        label.appendChild(radio);

        const text = document.createElement('span');
        text.textContent = option.label;
        label.appendChild(text);
        optionList.appendChild(label);
      });
      block.appendChild(optionList);
    }

    if (question.isOther || question.isSecret || !options.length) {
      const input = document.createElement(question.isSecret ? 'input' : 'textarea');
      input.name = `question-input-${question.id}`;
      input.className = 'approval-text-input';
      if (question.isSecret) {
        input.type = 'password';
      } else {
        input.rows = 2;
      }
      input.placeholder = '填写回答';
      input.disabled = submitting;
      block.appendChild(input);
    }

    form.appendChild(block);
  }

  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn';
  submitBtn.textContent = submitting ? '提交中...' : '提交';
  submitBtn.disabled = submitting;
  actions.appendChild(submitBtn);
  form.appendChild(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const answers = {};
    for (const question of request.questions || []) {
      const selected = form.querySelector(`input[name="question-${question.id}"]:checked`);
      const freeform = form.querySelector(`[name="question-input-${question.id}"]`);
      const value = selected?.value || freeform?.value?.trim() || '';
      if (!value) {
        continue;
      }
      answers[question.id] = { answers: [value] };
    }
    submitServerRequestResponse(request, { answers });
  });

  node.appendChild(form);
}

function describeServerRequestTitle(request) {
  if (request.kind === 'permissions_approval') {
    return '⏳ 额外权限请求';
  }
  if (request.kind === 'file_change_approval' || request.kind === 'file_change_approval_legacy') {
    return '⏳ 文件修改待批准';
  }
  if (request.kind === 'user_input') {
    return '⏳ 等待人工输入';
  }
  return '⏳ 命令执行待批准';
}

function describePermissions(permissions) {
  const parts = [];
  const networkEnabled = permissions?.network?.enabled;
  if (networkEnabled) {
    parts.push('网络访问');
  }

  const readPaths = permissions?.fileSystem?.read || [];
  const writePaths = permissions?.fileSystem?.write || [];
  if (readPaths.length) {
    parts.push(`读: ${readPaths.join(', ')}`);
  }
  if (writePaths.length) {
    parts.push(`写: ${writePaths.join(', ')}`);
  }

  const entries = permissions?.fileSystem?.entries || [];
  if (entries.length && !readPaths.length && !writePaths.length) {
    parts.push(`文件系统项: ${entries.length}`);
  }

  return parts.length ? parts.join(' | ') : '无额外权限详情';
}

function createActionButton(label, disabled, onClick, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = extraClass ? `btn ${extraClass}` : 'btn';
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function submitServerRequestResponse(request, response) {
  if (!request?.requestId) {
    return;
  }

  if (!send({ type: 'server_request_respond', requestId: request.requestId, response })) {
    const threadId = request.threadId || state.activeThreadId;
    if (threadId) {
      ensureItems(threadId).push({
        type: '_error',
        id: createLocalId('approval-send'),
        text: '批准响应发送失败：WebSocket 未连接，请稍后重试。',
      });
    }
    render();
    return;
  }

  upsertServerRequest({ ...request, status: 'submitting' });
  render();
}

function createMessageBody(html) {
  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = html;
  return body;
}

function createDot() {
  const dot = document.createElement('span');
  dot.className = 'dot';
  return dot;
}

function commandStatusIcon(status) {
  if (status === 'completed') {
    return '✅';
  }
  if (status === 'failed' || status === 'declined') {
    return '❌';
  }
  if (status === 'pendingApproval') {
    return '⏳';
  }
  return '⚡';
}

function render() {
  renderTabs();
  renderHeader();
  renderNewTabButton();
  renderComposer();
  renderMessages();
}

function renderNewTabButton() {
  newTabBtn.disabled = state.creatingTab || state.authFailed;
  newTabBtn.classList.toggle('is-loading', state.creatingTab);
  newTabBtn.textContent = state.creatingTab ? '创建中...' : '+ 新建标签';
}

function openTextModal(options = {}) {
  if (modalState.resolve) {
    closeTextModal(null);
  }

  modalState.previousFocus = document.activeElement;
  modalTitle.textContent = options.title || '输入';
  modalLabel.textContent = options.label || '输入内容';
  modalInput.value = options.defaultValue || '';
  modalInput.placeholder = options.placeholder || '';
  modalInput.type = options.inputType || 'text';
  modalConfirmBtn.textContent = options.confirmText || '确定';
  textModal.classList.add('open');
  textModal.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    modalState.resolve = resolve;
    window.setTimeout(() => {
      modalInput.focus();
      modalInput.select();
    }, 0);
  });
}

function closeTextModal(value) {
  if (!modalState.resolve) {
    return;
  }

  const resolve = modalState.resolve;
  modalState.resolve = null;
  textModal.classList.remove('open');
  textModal.setAttribute('aria-hidden', 'true');
  resolve(value);

  if (modalState.previousFocus && typeof modalState.previousFocus.focus === 'function') {
    modalState.previousFocus.focus();
  }
}

function toggleSidebar(event) {
  if (event) {
    event.stopPropagation();
  }
  sidebar.classList.toggle('hidden');
  mainArea.classList.toggle('full');
}

sidebarClose.addEventListener('click', toggleSidebar);
menuBtn.addEventListener('click', toggleSidebar);

mainArea.addEventListener('click', (event) => {
  if (event.target === menuBtn || menuBtn.contains(event.target)) {
    return;
  }
  if (!sidebar.classList.contains('hidden') && window.innerWidth <= 680) {
    sidebar.classList.add('hidden');
    mainArea.classList.add('full');
  }
});

newTabBtn.addEventListener('click', async () => {
  if (state.creatingTab) {
    return;
  }

  const name = await openTextModal({
    title: '新建标签',
    label: '标签名称',
    placeholder: '可留空',
    confirmText: '创建',
    inputType: 'text',
  });

  if (name === null) {
    return;
  }

  state.creatingTab = true;
  render();
  if (!send({ type: 'tab_create', name })) {
    state.creatingTab = false;
    render();
    return;
  }
  if (window.innerWidth <= 680) {
    sidebar.classList.add('hidden');
    mainArea.classList.add('full');
  }
});

tokenBtn.addEventListener('click', async () => {
  await promptForWebSocketToken({
    title: '设置 WebSocket Token',
    label: '访问 Token',
    placeholder: '请输入服务端配置的 WS_TOKEN',
    confirmText: '保存并重连',
    inputType: 'password',
  });
});

textModalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  closeTextModal(modalInput.value.trim());
});

modalCancelBtn.addEventListener('click', () => {
  closeTextModal(null);
});

textModal.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.modalClose === 'true') {
    closeTextModal(null);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalState.resolve) {
    closeTextModal(null);
  }
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  composer.requestSubmit();
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  if (!text || !state.activeThreadId) {
    return;
  }

  const threadId = state.activeThreadId;
  const clientMessageId = createLocalId('turn');
  const localMessageId = createLocalId('local');
  const items = ensureItems(threadId);
  items.push({
    type: 'userMessage',
    id: localMessageId,
    content: [{ type: 'text', text }],
  });
  registerPendingUserMessage(clientMessageId, threadId, localMessageId, text);

  state.turnActiveByThread.set(threadId, true);
  if (!send({ type: 'turn_send', threadId, text, clientMessageId })) {
    rollbackPendingUserMessage(clientMessageId);
    state.turnActiveByThread.set(threadId, false);
    ensureItems(threadId).push({
      type: '_error',
      id: createLocalId('send'),
      text: '消息发送失败：WebSocket 未连接，请稍后重试。',
    });
  }
  promptInput.value = '';
  renderMessages();
});

function handleMessage(msg) {
  if (msg.type === 'state') {
    state.tabs = msg.tabs || [];
    state.serverRequests = [];
    for (const request of msg.serverRequests || []) {
      upsertServerRequest(request);
    }
    pruneUnreadThreads();
    if (!state.activeThreadId && state.tabs.length) {
      state.activeThreadId = state.tabs[0].threadId;
    }
    if (state.activeThreadId && !state.tabs.some((tab) => tab.threadId === state.activeThreadId)) {
      state.activeThreadId = state.tabs[0]?.threadId || null;
    }
    if (state.activeThreadId) {
      state.unreadThreadIds.delete(state.activeThreadId);
    }
    if (state.activeThreadId) {
      send({ type: 'thread_sync', threadId: state.activeThreadId });
    }
    render();
    return;
  }

  if (msg.type === 'server_request_required') {
    upsertServerRequest(msg.request);
    if (markThreadUnread(msg.request?.threadId)) {
      renderTabs();
    }
    if (msg.request?.threadId === state.activeThreadId) {
      render();
    } else {
      renderTabs();
    }
    return;
  }

  if (msg.type === 'server_request_updated') {
    upsertServerRequest(msg.request);
    if (msg.request?.threadId === state.activeThreadId) {
      render();
    } else {
      renderTabs();
    }
    return;
  }

  if (msg.type === 'server_request_resolved') {
    removeServerRequest(msg.requestId);
    if (msg.threadId === state.activeThreadId) {
      render();
    } else {
      renderTabs();
    }
    return;
  }

  if (msg.type === 'tab_updated') {
    upsertTab(msg.tab);
    render();
    return;
  }

  if (msg.type === 'tab_created') {
    state.creatingTab = false;
    if (msg.tab) {
      upsertTab(msg.tab);
    }
    setActiveTab(msg.threadId || msg.tab?.threadId || null, { skipSync: true });
    return;
  }

  if (msg.type === 'tab_removed') {
    removeTab(msg.threadId);
    return;
  }

  if (msg.type === 'unread') {
    if (markThreadUnread(msg.threadId)) {
      renderTabs();
    }
    return;
  }

  if (msg.type === 'thread_sync') {
    syncTurns(msg.threadId, msg.turns || []);
    render();
    return;
  }

  if (msg.type === 'turn_started') {
    state.turnActiveByThread.set(msg.threadId, true);
    if (msg.threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'turn_completed') {
    state.turnActiveByThread.set(msg.threadId, false);
    if (msg.threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'agent_delta') {
    state.turnActiveByThread.set(msg.threadId, true);
    upsertStreamingItem(msg.threadId, msg.itemId, msg.delta || '');
    if (msg.threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'item_started') {
    const items = ensureItems(msg.threadId);
    const item = msg.item;
    reconcilePendingUserMessage(msg.threadId, item);
    if (item && item.id && !items.find((entry) => entry.id === item.id)) {
      items.push({ ...item, _partial: true });
    }
    if (msg.threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'item_completed') {
    reconcilePendingUserMessage(msg.threadId, msg.item);
    finalizeItem(msg.threadId, msg.item);
    if (msg.threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'codex_error') {
    const threadId = msg.threadId || state.activeThreadId;
    const items = ensureItems(threadId);
    const error = msg.error || {};
    items.push({
      type: '_error',
      id: createLocalId('err'),
      text: error.message || JSON.stringify(error),
    });
    if (threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'backend_error') {
    if (!state.activeThreadId) {
      return;
    }
    const items = ensureItems(state.activeThreadId);
    items.push({
      type: '_error',
      id: createLocalId('backend'),
      text: msg.message,
    });
    renderMessages();
    return;
  }

  if (msg.type === 'error') {
    if (state.creatingTab && !msg.threadId && !msg.op) {
      state.creatingTab = false;
    }
    if (msg.code === 'AUTH_FAILED') {
      markAuthFailed(msg.message || 'WebSocket 鉴权失败，请检查 token 是否正确。');
      return;
    }

    const threadId = msg.threadId || state.activeThreadId;
    if (!threadId) {
      return;
    }

    if (msg.op === 'turn_start' && msg.clientMessageId) {
      rollbackPendingUserMessage(msg.clientMessageId);
      state.turnActiveByThread.set(threadId, false);
    }

    if (msg.code === 'THREAD_NOT_FOUND' && msg.op === 'turn_start') {
      const marked = markTabClosedLocally(threadId);
      const items = ensureItems(threadId);
      items.push({
        type: '_error',
        id: createLocalId('thread-missing'),
        text: msg.message || '该标签对应的会话不存在，已标记为关闭。',
      });
      if (threadId === state.activeThreadId) {
        render();
      } else if (marked) {
        renderTabs();
      }
      return;
    }

    const items = ensureItems(threadId);
    items.push({
      type: '_error',
      id: createLocalId('api'),
      text: msg.message || '服务端请求失败',
    });
    if (threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'token_usage') {
    return;
  }

  if (msg.type === 'warning') {
    const threadId = msg.threadId || state.activeThreadId;
    const items = ensureItems(threadId);
    items.push({
      type: '_warning',
      id: createLocalId('warn'),
      text: msg.message,
    });
    if (threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  console.log('Unhandled message:', msg.type, msg);
}
