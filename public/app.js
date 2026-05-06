let reconnectTimer = null;
let reconnectAttempt = 0;

const WEBSOCKET_TOKEN_STORAGE_KEY = 'codex-remote-ws-token';
const EMPTY_THREAD_KEY = '__empty__';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_SESSION_NAME = '未命名会话';
const DEFAULT_PROMPT_PLACEHOLDER = '给当前会话发送指令...';
const COMPOSER_PREFS_STORAGE_KEY = 'codex-remote-composer-prefs';
const THEME_STORAGE_KEY = 'codex-remote-theme';
const REASONING_EFFORT_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const THEME_OPTIONS = [
  { value: 'paper', label: '纸墨' },
  { value: 'bay', label: '海湾' },
  { value: 'night', label: '夜航' },
];

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

function stripTokenFromLocation() {
  try {
    const nextUrl = new URL(window.location.href);
    if (!nextUrl.searchParams.has('token')) {
      return;
    }
    nextUrl.searchParams.delete('token');
    window.history.replaceState(null, '', nextUrl);
  } catch (_error) {
    // Ignore URL rewrite failures.
  }
}

function getWebSocketToken() {
  const queryToken = new URLSearchParams(window.location.search).get('token');
  try {
    if (queryToken) {
      window.localStorage.setItem(WEBSOCKET_TOKEN_STORAGE_KEY, queryToken);
      stripTokenFromLocation();
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
    // Ignore storage failures.
  } finally {
    stripTokenFromLocation();
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
    void loadComposerOptions({ render: false });
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
void loadComposerOptions({ render: false });

// DOM
const sidebar = document.getElementById('sidebar');
const sidebarClose = document.getElementById('sidebarClose');
const menuBtn = document.getElementById('menuBtn');
const tabList = document.getElementById('tabList');
const newTabBtn = document.getElementById('newTabBtn');
const messagesEl = document.getElementById('messages');
const sessionCreatingOverlay = document.getElementById('sessionCreatingOverlay');
const composer = document.getElementById('composer');
const modelSelect = document.getElementById('modelSelect');
const reasoningEffortSelect = document.getElementById('reasoningEffortSelect');
const promptInput = document.getElementById('promptInput');
const composerSubmitBtn = composer.querySelector('button[type="submit"]');
const activeTitle = document.getElementById('activeTitle');
const themeSelect = document.getElementById('themeSelect');
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
const sessionModal = document.getElementById('sessionModal');
const sessionModalForm = document.getElementById('sessionModalForm');
const sessionNameInput = document.getElementById('sessionNameInput');
const sessionWorkspaceInput = document.getElementById('sessionWorkspaceInput');
const browseWorkspaceBtn = document.getElementById('browseWorkspaceBtn');
const workspaceUpBtn = document.getElementById('workspaceUpBtn');
const workspaceRefreshBtn = document.getElementById('workspaceRefreshBtn');
const createWorkspaceBtn = document.getElementById('createWorkspaceBtn');
const useCurrentWorkspaceBtn = document.getElementById('useCurrentWorkspaceBtn');
const workspaceShortcutList = document.getElementById('workspaceShortcutList');
const workspaceBrowserPath = document.getElementById('workspaceBrowserPath');
const workspaceBrowserList = document.getElementById('workspaceBrowserList');
const sessionModalHint = document.getElementById('sessionModalHint');
const sessionModalCancelBtn = document.getElementById('sessionModalCancelBtn');
const sessionModalConfirmBtn = document.getElementById('sessionModalConfirmBtn');
const customSelectControllers = new WeakMap();
let activeCustomSelect = null;

ensureCustomSelect(themeSelect);
ensureCustomSelect(modelSelect);
ensureCustomSelect(reasoningEffortSelect);

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) {
    closeActiveCustomSelect();
    return;
  }
  if (activeCustomSelect && !activeCustomSelect.wrapper.contains(target)) {
    closeActiveCustomSelect();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeActiveCustomSelect();
  }
});

window.addEventListener('resize', () => {
  if (activeCustomSelect) {
    positionCustomSelectMenu(activeCustomSelect);
  }
});

const state = {
  tabs: [],
  activeThreadId: null,
  itemsByThread: new Map(),
  partialByThread: new Map(),
  turnActiveByThread: new Map(),
  currentTurnIdByThread: new Map(),
  turnStartedAtByThread: new Map(),
  unreadThreadIds: new Set(),
  pendingUserMessages: new Map(),
  serverRequests: [],
  availableModels: [],
  composerOptionsLoading: false,
  composerOptionsLoaded: false,
  composerModelDefault: '',
  composerEffortDefault: '',
  composerPrefsByThread: new Map(),
  composerGlobalPrefs: { model: '', effort: '' },
  currentTheme: 'paper',
  creatingTab: false,
  authFailed: false,
  connectionError: '',
};

const messageDomByThread = new Map();
const modalState = {
  resolve: null,
  previousFocus: null,
};
const sessionModalState = {
  resolve: null,
  previousFocus: null,
  shortcuts: null,
  loadingShortcuts: false,
  creatingWorkspace: false,
  browserLoading: false,
  browserPath: '',
  browserParentPath: '',
  browserEntries: [],
};

loadComposerGlobalPrefs();
loadThemePreference();

function send(payload) {
  if (window._ws && window._ws.readyState === WebSocket.OPEN) {
    window._ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

async function apiFetchJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getWebSocketToken();
  if (token) {
    headers.set('x-codex-remote-token', token);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return data;
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

function normalizeComposerModel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeComposerEffort(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return REASONING_EFFORT_OPTIONS.includes(normalized) ? normalized : '';
}

function normalizeTheme(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return THEME_OPTIONS.some((theme) => theme.value === normalized) ? normalized : 'paper';
}

function applyTheme(theme) {
  const normalized = normalizeTheme(theme);
  state.currentTheme = normalized;
  if (normalized === 'paper') {
    document.body.removeAttribute('data-theme');
  } else {
    document.body.setAttribute('data-theme', normalized);
  }
}

function loadThemePreference() {
  try {
    applyTheme(window.localStorage.getItem(THEME_STORAGE_KEY) || 'paper');
  } catch (_error) {
    applyTheme('paper');
  }
}

function saveThemePreference(theme) {
  const normalized = normalizeTheme(theme);
  applyTheme(normalized);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function normalizeEffortOptionValue(value) {
  if (typeof value === 'string') {
    return normalizeComposerEffort(value);
  }
  if (value && typeof value === 'object') {
    return normalizeComposerEffort(value.reasoningEffort || value.value || '');
  }
  return '';
}

function loadComposerGlobalPrefs() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPOSER_PREFS_STORAGE_KEY) || '{}');
    state.composerGlobalPrefs = {
      model: normalizeComposerModel(parsed?.model),
      effort: normalizeComposerEffort(parsed?.effort),
    };
  } catch (_error) {
    state.composerGlobalPrefs = { model: '', effort: '' };
  }
}

function saveComposerGlobalPrefs() {
  try {
    window.localStorage.setItem(COMPOSER_PREFS_STORAGE_KEY, JSON.stringify(state.composerGlobalPrefs));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function getActiveComposerPrefs() {
  const threadId = state.activeThreadId;
  if (threadId) {
    const threadPrefs = state.composerPrefsByThread.get(threadId);
    if (threadPrefs) {
      return threadPrefs;
    }
  }
  return state.composerGlobalPrefs;
}

function setComposerPrefsForThread(threadId, prefs) {
  const normalized = {
    model: normalizeComposerModel(prefs?.model),
    effort: normalizeComposerEffort(prefs?.effort),
  };

  if (threadId) {
    state.composerPrefsByThread.set(threadId, normalized);
  }
  state.composerGlobalPrefs = normalized;
  saveComposerGlobalPrefs();
}

function buildModelSelectOptions() {
  const options = [{
    value: '',
    label: state.composerModelDefault ? `跟随当前配置（${state.composerModelDefault}）` : '跟随当前配置',
  }];

  for (const model of state.availableModels) {
    const value = normalizeComposerModel(model.model || model.id || '');
    if (!value) {
      continue;
    }
    options.push({
      value,
      label: model.displayName || value,
    });
  }

  return options;
}

function getModelDefinition(modelId) {
  const normalized = normalizeComposerModel(modelId);
  if (!normalized) {
    return state.availableModels.find((model) => model.isDefault) || null;
  }
  return state.availableModels.find((model) => normalizeComposerModel(model.model || model.id) === normalized) || null;
}

function buildEffortSelectOptions() {
  const activePrefs = getActiveComposerPrefs();
  const activeModel = getModelDefinition(activePrefs?.model || state.composerModelDefault);
  const supportedEfforts = Array.isArray(activeModel?.supportedReasoningEfforts) && activeModel.supportedReasoningEfforts.length
    ? activeModel.supportedReasoningEfforts.map((effort) => normalizeEffortOptionValue(effort)).filter(Boolean)
    : REASONING_EFFORT_OPTIONS;
  const finalEfforts = supportedEfforts.length ? supportedEfforts : REASONING_EFFORT_OPTIONS;
  const defaultLabel = state.composerEffortDefault
    ? `跟随当前配置（${formatReasoningEffortLabel(state.composerEffortDefault)}）`
    : '跟随当前配置';
  return [{
    value: '',
    label: defaultLabel,
  }].concat(finalEfforts.map((effort) => ({
    value: effort,
    label: formatReasoningEffortLabel(effort),
  })));
}

function fillSelectOptions(selectEl, options, selectedValue) {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return;
  }

  const previousValue = selectEl.value;
  selectEl.replaceChildren();
  for (const optionData of options) {
    const option = document.createElement('option');
    option.value = optionData.value;
    option.textContent = optionData.label;
    selectEl.appendChild(option);
  }

  const nextValue = options.some((option) => option.value === selectedValue)
    ? selectedValue
    : (options.some((option) => option.value === previousValue) ? previousValue : options[0]?.value || '');
  selectEl.value = nextValue;
  syncCustomSelect(selectEl);
}

function closeActiveCustomSelect() {
  if (!activeCustomSelect) {
    return;
  }
  activeCustomSelect.wrapper.classList.remove('open-upward');
  activeCustomSelect.wrapper.classList.remove('open');
  activeCustomSelect.trigger.setAttribute('aria-expanded', 'false');
  activeCustomSelect = null;
}

function positionCustomSelectMenu(controller) {
  const { wrapper, trigger, menu } = controller;
  wrapper.classList.remove('open-upward');
  menu.style.maxHeight = '';

  const triggerRect = trigger.getBoundingClientRect();
  const menuHeight = Math.max(menu.scrollHeight, 120);
  const viewportPadding = 16;
  const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
  const spaceAbove = triggerRect.top - viewportPadding;
  const openUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow;
  const availableSpace = Math.max(120, openUpward ? spaceAbove : spaceBelow);

  wrapper.classList.toggle('open-upward', openUpward);
  menu.style.maxHeight = `${Math.max(120, availableSpace)}px`;
}

function openCustomSelect(controller) {
  if (activeCustomSelect && activeCustomSelect !== controller) {
    closeActiveCustomSelect();
  }
  controller.wrapper.classList.add('open');
  controller.trigger.setAttribute('aria-expanded', 'true');
  positionCustomSelectMenu(controller);
  activeCustomSelect = controller;
}

function ensureCustomSelect(selectEl) {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return null;
  }

  const existing = customSelectControllers.get(selectEl);
  if (existing) {
    return existing;
  }

  selectEl.classList.add('select-native');
  const wrapper = document.createElement('div');
  wrapper.className = 'select-shell';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'select-trigger-label';
  trigger.appendChild(label);

  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.setAttribute('role', 'listbox');

  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);
  wrapper.appendChild(trigger);
  wrapper.appendChild(menu);

  const controller = { selectEl, wrapper, trigger, label, menu };
  customSelectControllers.set(selectEl, controller);

  trigger.addEventListener('click', () => {
    if (selectEl.disabled) {
      return;
    }
    if (activeCustomSelect === controller) {
      closeActiveCustomSelect();
      return;
    }
    openCustomSelect(controller);
  });

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeActiveCustomSelect();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeCustomSelect === controller) {
        closeActiveCustomSelect();
      } else if (!selectEl.disabled) {
        openCustomSelect(controller);
      }
    }
  });

  syncCustomSelect(selectEl);
  return controller;
}

function syncCustomSelect(selectEl) {
  const controller = ensureCustomSelect(selectEl);
  if (!controller) {
    return;
  }

  const { wrapper, trigger, label, menu } = controller;
  const selectedOption = selectEl.options[selectEl.selectedIndex] || selectEl.options[0] || null;
  label.textContent = selectedOption?.textContent || '';
  trigger.disabled = selectEl.disabled;
  trigger.title = selectEl.title || '';
  wrapper.classList.toggle('disabled', selectEl.disabled);

  menu.replaceChildren();
  Array.from(selectEl.options).forEach((option) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'select-option';
    optionButton.setAttribute('role', 'option');
    optionButton.dataset.value = option.value;
    optionButton.textContent = option.textContent || '';
    optionButton.classList.toggle('selected', option.selected);
    optionButton.setAttribute('aria-selected', option.selected ? 'true' : 'false');
    optionButton.addEventListener('click', () => {
      if (selectEl.disabled) {
        return;
      }
      const changed = selectEl.value !== option.value;
      selectEl.value = option.value;
      syncCustomSelect(selectEl);
      closeActiveCustomSelect();
      if (changed) {
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    menu.appendChild(optionButton);
  });
}

function formatReasoningEffortLabel(effort) {
  if (!effort) {
    return '默认';
  }
  if (effort === 'xhigh') {
    return '超高';
  }
  if (effort === 'none') {
    return '关闭';
  }
  if (effort === 'minimal') {
    return '极低';
  }
  if (effort === 'low') {
    return '低';
  }
  if (effort === 'medium') {
    return '中';
  }
  if (effort === 'high') {
    return '高';
  }
  return effort;
}

function getEffectiveComposerSelection(threadId = state.activeThreadId) {
  const prefs = threadId ? (state.composerPrefsByThread.get(threadId) || state.composerGlobalPrefs) : state.composerGlobalPrefs;
  const model = normalizeComposerModel(prefs?.model) || state.composerModelDefault || '';
  const effort = normalizeComposerEffort(prefs?.effort) || state.composerEffortDefault || '';
  return { model, effort };
}

async function loadComposerOptions(options = {}) {
  if (state.composerOptionsLoading) {
    return;
  }

  state.composerOptionsLoading = true;
  if (options.render !== false) {
    renderComposer();
  }

  try {
    const url = new URL('/api/codex/options', window.location.origin);
    const activeTab = state.tabs.find((entry) => entry.threadId === state.activeThreadId);
    if (activeTab?.cwd) {
      url.searchParams.set('cwd', activeTab.cwd);
    }
    const result = await apiFetchJson(url);
    state.availableModels = Array.isArray(result.models) ? result.models : [];
    state.composerModelDefault = normalizeComposerModel(result.defaults?.model)
      || normalizeComposerModel(state.availableModels.find((model) => model.isDefault)?.model);
    state.composerEffortDefault = normalizeComposerEffort(result.defaults?.reasoningEffort)
      || normalizeComposerEffort(
        state.availableModels.find((model) => normalizeComposerModel(model.model) === state.composerModelDefault)?.defaultReasoningEffort
      );
    state.composerOptionsLoaded = true;
  } catch (error) {
    console.error('failed loading codex options', error);
  } finally {
    state.composerOptionsLoading = false;
    renderComposer();
  }
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

function getLatestPendingUserMessage(threadId) {
  let latest = null;
  for (const pending of state.pendingUserMessages.values()) {
    if (pending.threadId !== threadId) {
      continue;
    }
    latest = pending;
  }
  return latest;
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

function cloneItemForTurn(item, turnId) {
  if (!item || typeof item !== 'object') {
    return item;
  }

  return {
    ...item,
    _turnId: turnId || item._turnId || null,
  };
}

function normalizeTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return normalizeTimestampMs(Number(trimmed));
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getTurnStartedAtFromTurn(turn) {
  return normalizeTimestampMs(turn?.startedAt)
    || normalizeTimestampMs(turn?.createdAt)
    || normalizeTimestampMs(turn?.updatedAt)
    || null;
}

function rememberTurnStartedAt(threadId, timestamp) {
  if (!threadId) {
    return;
  }

  const normalized = normalizeTimestampMs(timestamp) || Date.now();
  const existing = state.turnStartedAtByThread.get(threadId);
  if (!existing || normalized < existing) {
    state.turnStartedAtByThread.set(threadId, normalized);
  }
}

function clearTurnStartedAt(threadId) {
  state.turnStartedAtByThread.delete(threadId);
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}小时${minutes}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function formatShortElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

function getTurnElapsedLabel(threadId) {
  const startedAt = state.turnStartedAtByThread.get(threadId);
  if (!startedAt) {
    return '';
  }
  return `已执行 ${formatElapsed(Date.now() - startedAt)}`;
}

function getTurnWorkingLabel(threadId) {
  const startedAt = state.turnStartedAtByThread.get(threadId);
  if (!startedAt) {
    return '';
  }
  return `Working ${formatShortElapsed(Date.now() - startedAt)}`;
}

function findItemIndexById(threadId, itemId) {
  if (!itemId) {
    return -1;
  }
  return ensureItems(threadId).findIndex((item) => item.id === itemId);
}

function upsertLiveItem(threadId, turnId, itemId, type, mutate) {
  if (!threadId || !itemId) {
    return null;
  }

  const items = ensureItems(threadId);
  let index = findItemIndexById(threadId, itemId);
  if (index < 0) {
    items.push({
      id: itemId,
      type,
      status: 'running',
      _turnId: turnId || state.currentTurnIdByThread.get(threadId) || null,
      _partial: true,
    });
    index = items.length - 1;
  }

  const item = items[index];
  item.type = type || item.type;
  if (turnId) {
    item._turnId = turnId;
  }
  if (!item.status) {
    item.status = 'running';
  }
  item._partial = true;
  mutate(item);
  return item;
}

function extractTextParts(value) {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextParts(entry));
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') {
      return extractTextParts(value.text);
    }
    if (typeof value.delta === 'string') {
      return extractTextParts(value.delta);
    }
    if (typeof value.content === 'string') {
      return extractTextParts(value.content);
    }
    if (Array.isArray(value.content)) {
      return extractTextParts(value.content);
    }
  }
  return [];
}

function appendReasoningSummaryPart(item, part) {
  const nextParts = extractTextParts(part);
  if (!nextParts.length) {
    return;
  }

  if (!Array.isArray(item.summary)) {
    item.summary = [];
  }
  nextParts.forEach((text) => {
    item.summary.push({ type: 'summary_text', text });
  });
}

function appendReasoningSummaryText(item, delta) {
  if (typeof delta !== 'string' || !delta) {
    return;
  }

  if (!Array.isArray(item.summary)) {
    item.summary = [];
  }

  const last = item.summary[item.summary.length - 1];
  if (last && typeof last.text === 'string') {
    last.text += delta;
    return;
  }

  item.summary.push({ type: 'summary_text', text: delta });
}

function appendReasoningContentText(item, delta) {
  if (typeof delta !== 'string' || !delta) {
    return;
  }

  if (!Array.isArray(item.content)) {
    item.content = [];
  }

  const last = item.content[item.content.length - 1];
  if (last && typeof last.text === 'string') {
    last.text += delta;
    return;
  }

  item.content.push({ type: 'text', text: delta });
}

function getReasoningText(item) {
  const parts = []
    .concat(extractTextParts(item?.summary))
    .concat(extractTextParts(item?.content));
  const unique = [];
  for (const part of parts) {
    const normalized = String(part || '').trim();
    if (!normalized || unique[unique.length - 1] === normalized) {
      continue;
    }
    unique.push(normalized);
  }
  return unique.join('\n').trim();
}

function getCommandOutput(item) {
  return String(item?.aggregatedOutput || item?.output || '').trim();
}

function getFileChangeOutput(item) {
  return String(item?.aggregatedOutput || item?.output || '').trim();
}

function getFileChangePatch(item) {
  return String(item?.patch || item?.aggregatedPatch || '').trim();
}

function getNormalizedFileChangeKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (!normalized) {
    return 'update';
  }
  if (['add', 'added', 'create', 'created', 'new'].includes(normalized)) {
    return 'add';
  }
  if (['delete', 'deleted', 'remove', 'removed'].includes(normalized)) {
    return 'delete';
  }
  if (['update', 'updated', 'modify', 'modified', 'rename', 'renamed', 'move', 'moved'].includes(normalized)) {
    return 'update';
  }
  return 'update';
}

function dedupeFileChanges(changes) {
  const seen = new Set();
  const result = [];
  for (const change of changes) {
    const path = String(change?.path || '').trim();
    if (!path) {
      continue;
    }
    const kind = getNormalizedFileChangeKind(change.kind);
    const key = `${kind}:${path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ path, kind });
  }
  return result;
}

function parseFileChangesFromPatch(patch) {
  const text = String(patch || '');
  if (!text.trim()) {
    return [];
  }

  const changes = [];
  const lines = text.split(/\r?\n/);
  let currentDiffPath = '';

  for (const line of lines) {
    let match = line.match(/^\*\*\* Add File: (.+)$/);
    if (match) {
      changes.push({ kind: 'add', path: match[1].trim() });
      continue;
    }

    match = line.match(/^\*\*\* Delete File: (.+)$/);
    if (match) {
      changes.push({ kind: 'delete', path: match[1].trim() });
      continue;
    }

    match = line.match(/^\*\*\* Update File: (.+)$/);
    if (match) {
      changes.push({ kind: 'update', path: match[1].trim() });
      continue;
    }

    match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      currentDiffPath = (match[2] || match[1] || '').trim();
      if (currentDiffPath) {
        changes.push({ kind: 'update', path: currentDiffPath });
      }
      continue;
    }

    match = line.match(/^rename to (.+)$/);
    if (match) {
      changes.push({ kind: 'update', path: match[1].trim() });
      continue;
    }

    if (line.startsWith('new file mode ') && currentDiffPath) {
      changes.push({ kind: 'add', path: currentDiffPath });
      continue;
    }

    if (line.startsWith('deleted file mode ') && currentDiffPath) {
      changes.push({ kind: 'delete', path: currentDiffPath });
    }
  }

  return dedupeFileChanges(changes);
}

function normalizeFileChanges(changes, patch = '') {
  const normalized = dedupeFileChanges(
    (Array.isArray(changes) ? changes : []).map((change) => ({
      path: change?.path || change?.filePath || change?.file || '',
      kind: change?.kind || change?.type || '',
    }))
  );
  if (normalized.length) {
    return normalized;
  }
  return parseFileChangesFromPatch(patch);
}

function summarizeFileChanges(changes) {
  const counts = { add: 0, update: 0, delete: 0 };
  for (const change of changes) {
    counts[getNormalizedFileChangeKind(change.kind)] += 1;
  }

  const parts = [];
  if (counts.add) {
    parts.push(`新增 ${counts.add}`);
  }
  if (counts.update) {
    parts.push(`修改 ${counts.update}`);
  }
  if (counts.delete) {
    parts.push(`删除 ${counts.delete}`);
  }
  return parts.join(' · ');
}

function isItemInActiveTurn(threadId, item) {
  if (!state.turnActiveByThread.get(threadId)) {
    return false;
  }
  const activeTurnId = state.currentTurnIdByThread.get(threadId);
  return !activeTurnId || !item?._turnId || item._turnId === activeTurnId;
}

function assignPendingUserMessageToTurn(threadId, turnId) {
  if (!threadId || !turnId) {
    return;
  }

  const pending = getLatestPendingUserMessage(threadId);
  if (!pending?.itemId) {
    return;
  }

  const items = ensureItems(threadId);
  const item = items.find((entry) => entry.id === pending.itemId);
  if (!item) {
    return;
  }

  item._turnId = turnId;
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

  state.tabs.sort(compareTabs);
}

function compareTabs(a, b) {
  const aClosed = normalizeTabStatus(a?.status) === 'closed';
  const bClosed = normalizeTabStatus(b?.status) === 'closed';
  if (aClosed !== bClosed) {
    return aClosed ? 1 : -1;
  }
  return (b?.updatedAt || 0) - (a?.updatedAt || 0);
}

function removeTab(threadId) {
  state.tabs = state.tabs.filter((tab) => tab.threadId !== threadId);
  state.itemsByThread.delete(threadId);
  state.partialByThread.delete(threadId);
  state.turnActiveByThread.delete(threadId);
  state.currentTurnIdByThread.delete(threadId);
  state.composerPrefsByThread.delete(threadId);
  state.serverRequests = state.serverRequests.filter((entry) => entry.threadId !== threadId);
  removePendingUserMessagesForThread(threadId);
  state.unreadThreadIds.delete(threadId);
  messageDomByThread.delete(threadId);

  if (state.activeThreadId === threadId) {
    state.activeThreadId = null;
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
  state.currentTurnIdByThread.delete(threadId);
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
      name: DEFAULT_SESSION_NAME,
      cwd: '',
      status: 'idle',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      windowPid: null,
    });
  }

  state.activeThreadId = threadId;
  state.unreadThreadIds.delete(threadId);
  void loadComposerOptions({ render: false });
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

function getSessionName(tab) {
  const name = typeof tab?.name === 'string' ? tab.name.trim() : '';
  if (!name || name === 'New Tab') {
    return DEFAULT_SESSION_NAME;
  }
  return name;
}

function getWorkspacePath(tab) {
  return typeof tab?.cwd === 'string' ? tab.cwd.trim() : '';
}

function getWorkspaceFolder(cwd) {
  const normalized = String(cwd || '').replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }

  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function getDefaultWorkspacePath(shortcuts) {
  return shortcuts?.lastUsedPath || shortcuts?.projectRoot || shortcuts?.desktopPath || '';
}

function updateSessionWorkspacePath(path) {
  const normalized = typeof path === 'string' ? path.trim() : '';
  sessionWorkspaceInput.value = normalized;
}

function syncTurns(threadId, turns) {
  const syncedItems = [];
  for (const turn of turns || []) {
    for (const item of turn.items || []) {
      syncedItems.push(cloneItemForTurn(item, turn.id || null));
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
  if (!lastTurn) {
    state.partialByThread.delete(threadId);
    state.turnActiveByThread.set(threadId, false);
    state.currentTurnIdByThread.delete(threadId);
    clearTurnStartedAt(threadId);
    return;
  }
  const lastTurnStatus = normalizeTurnStatus(lastTurn?.status);
  if (['completed', 'failed', 'cancelled', 'aborted', 'idle'].includes(lastTurnStatus)) {
    state.partialByThread.delete(threadId);
    state.turnActiveByThread.set(threadId, false);
    state.currentTurnIdByThread.delete(threadId);
    clearTurnStartedAt(threadId);
  } else if (lastTurnStatus === 'inProgress') {
    state.turnActiveByThread.set(threadId, true);
    if (lastTurn?.id) {
      state.currentTurnIdByThread.set(threadId, lastTurn.id);
    }
    rememberTurnStartedAt(threadId, getTurnStartedAtFromTurn(lastTurn));
  }
}

function dedupeItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.type}:${item.id || ''}:${item._turnId || ''}:${item.text || ''}`;
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

function upsertStreamingItem(threadId, turnId, itemId, delta) {
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
    if (turnId) {
      existing._turnId = turnId;
    }
    return;
  }

  existing = {
    type: 'agentMessage',
    id: itemId,
    text: partials.get(itemId),
    _partial: true,
    _turnId: turnId || null,
  };
  items.push(existing);
}

function finalizeItem(threadId, turnId, item) {
  if (!item || !item.id) {
    return;
  }

  const items = ensureItems(threadId);
  const partials = ensurePartials(threadId);
  partials.delete(item.id);
  const nextItem = cloneItemForTurn(item, turnId);

  const index = items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    items[index] = { ...nextItem, _partial: false };
    return;
  }

  items.push({ ...nextItem, _partial: false });
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
    node.querySelector('.name').textContent = getSessionName(tab);
    const cwd = getWorkspacePath(tab);
    const workspace = node.querySelector('.workspace');
    workspace.textContent = cwd ? `工作区 · ${getWorkspaceFolder(cwd)}` : '工作区未提供';
    workspace.title = cwd || '工作区未提供';
    node.title = cwd ? `${getSessionName(tab)}\n${cwd}` : getSessionName(tab);
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
  activeTitle.textContent = tab ? getSessionName(tab) : 'Codex Remote Control';
  fillSelectOptions(themeSelect, THEME_OPTIONS, state.currentTheme);
  themeSelect.disabled = false;
  syncCustomSelect(themeSelect);
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

  const elapsedLabel = tab && state.turnActiveByThread.get(tab.threadId)
    ? getTurnElapsedLabel(tab.threadId)
    : '';

  if (tab && hasPendingServerRequest(tab.threadId)) {
    activeStatus.textContent = elapsedLabel ? `待批准 · ${elapsedLabel}` : '待批准';
    activeStatus.className = 'status-badge waiting';
    return;
  }

  const status = tab ? normalizeTabStatus(tab.status) : '';
  if (status === 'running' || status === 'active') {
    activeStatus.textContent = elapsedLabel ? `进行中 · ${elapsedLabel}` : '进行中';
  } else {
    activeStatus.textContent = status === 'closed' ? '已关闭' : status;
  }
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
  const disabled = state.authFailed || !state.activeThreadId;
  const prefs = getActiveComposerPrefs();
  promptInput.disabled = disabled;
  composerSubmitBtn.disabled = disabled;
  promptInput.placeholder = state.authFailed
    ? 'WebSocket 鉴权失败，请点击右上角“设置 Token”。'
    : (!state.activeThreadId ? '请先在左侧选择一个会话。' : DEFAULT_PROMPT_PLACEHOLDER);

  fillSelectOptions(modelSelect, buildModelSelectOptions(), normalizeComposerModel(prefs?.model));
  fillSelectOptions(reasoningEffortSelect, buildEffortSelectOptions(), normalizeComposerEffort(prefs?.effort));
  modelSelect.disabled = state.authFailed || state.composerOptionsLoading;
  reasoningEffortSelect.disabled = state.authFailed;
  modelSelect.title = state.composerOptionsLoading ? '正在加载模型列表...' : '';
  reasoningEffortSelect.title = '思考等级会应用到当前及后续轮次';
  syncCustomSelect(modelSelect);
  syncCustomSelect(reasoningEffortSelect);
}

function renderCreatingOverlay() {
  sessionCreatingOverlay.classList.toggle('visible', state.creatingTab);
  sessionCreatingOverlay.setAttribute('aria-hidden', state.creatingTab ? 'false' : 'true');
}

function setSessionModalHint(text, isError = false) {
  sessionModalHint.textContent = text;
  sessionModalHint.classList.toggle('error', isError);
}

function renderSessionModal() {
  const shortcuts = sessionModalState.shortcuts || {};
  workspaceShortcutList.replaceChildren();

  const shortcutItems = [
    { label: '项目目录', path: shortcuts.projectRoot },
    { label: '桌面', path: shortcuts.desktopPath },
    { label: '上次使用', path: shortcuts.lastUsedPath },
    ...(Array.isArray(shortcuts.roots) ? shortcuts.roots.map((rootPath) => ({
      label: `磁盘 ${rootPath.replace(/[\\/]+$/, '')}`,
      path: rootPath,
    })) : []),
  ];

  shortcutItems.forEach((shortcut) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary workspace-shortcut';
    button.disabled = !shortcut.path || sessionModalState.loadingShortcuts || sessionModalState.browserLoading || sessionModalState.creatingWorkspace;

    const label = document.createElement('span');
    label.className = 'workspace-shortcut-label';
    label.textContent = `${shortcut.label}: ${shortcut.path || '不可用'}`;
    button.appendChild(label);

    button.addEventListener('click', async () => {
      if (!shortcut.path) {
        return;
      }
      updateSessionWorkspacePath(shortcut.path);
      await browseWorkspacePath(shortcut.path);
    });
    workspaceShortcutList.appendChild(button);
  });

  const busy = sessionModalState.loadingShortcuts || sessionModalState.browserLoading || sessionModalState.creatingWorkspace;
  sessionNameInput.disabled = busy;
  sessionWorkspaceInput.disabled = busy;
  browseWorkspaceBtn.disabled = busy;
  workspaceUpBtn.disabled = busy || !sessionModalState.browserParentPath;
  workspaceRefreshBtn.disabled = busy || !sessionModalState.browserPath;
  createWorkspaceBtn.disabled = busy;
  useCurrentWorkspaceBtn.disabled = busy || !sessionModalState.browserPath;
  sessionModalCancelBtn.disabled = busy;
  sessionModalConfirmBtn.disabled = busy;
  browseWorkspaceBtn.textContent = sessionModalState.browserLoading ? '加载中...' : '进入路径';
  createWorkspaceBtn.textContent = sessionModalState.creatingWorkspace ? '正在创建...' : '新建文件夹';

  workspaceBrowserPath.textContent = sessionModalState.browserPath || '尚未加载目录';
  workspaceBrowserList.replaceChildren();

  if (sessionModalState.browserLoading) {
    const loading = document.createElement('div');
    loading.className = 'workspace-browser-item empty';
    loading.textContent = '正在加载目录...';
    workspaceBrowserList.appendChild(loading);
    return;
  }

  if (!sessionModalState.browserEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'workspace-browser-item empty';
    empty.textContent = sessionModalState.browserPath ? '当前目录下没有子文件夹。' : '请选择一个工作区目录。';
    workspaceBrowserList.appendChild(empty);
    return;
  }

  sessionModalState.browserEntries.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-browser-item';
    button.title = entry.path;

    const icon = document.createElement('span');
    icon.className = 'workspace-browser-item-icon';
    icon.textContent = '📁';
    button.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'workspace-browser-item-label';
    label.textContent = entry.name;
    button.appendChild(label);

    button.addEventListener('click', async () => {
      updateSessionWorkspacePath(entry.path);
      await browseWorkspacePath(entry.path);
    });
    workspaceBrowserList.appendChild(button);
  });
}

async function loadWorkspaceShortcuts() {
  sessionModalState.loadingShortcuts = true;
  renderSessionModal();
  setSessionModalHint('正在读取常用工作区...');

  try {
    const shortcuts = await apiFetchJson('/api/workspace/shortcuts');
    sessionModalState.shortcuts = shortcuts;
    if (!sessionWorkspaceInput.value.trim()) {
      updateSessionWorkspacePath(getDefaultWorkspacePath(shortcuts));
    }
    setSessionModalHint('支持直接输入主机路径，也可以用下面的快捷路径。');
  } catch (error) {
    setSessionModalHint(`读取工作区失败：${error.message}`, true);
  } finally {
    sessionModalState.loadingShortcuts = false;
    renderSessionModal();
  }
}

function openSessionModal() {
  if (sessionModalState.resolve) {
    closeSessionModal(null);
  }

  sessionModalState.previousFocus = document.activeElement;
  sessionModalState.shortcuts = null;
  sessionModalState.loadingShortcuts = false;
  sessionModalState.creatingWorkspace = false;
  sessionModalState.browserLoading = false;
  sessionModalState.browserPath = '';
  sessionModalState.browserParentPath = '';
  sessionModalState.browserEntries = [];
  sessionNameInput.value = '';
  updateSessionWorkspacePath('');
  setSessionModalHint('支持直接输入主机路径，也可以用下面的快捷路径。');
  renderSessionModal();
  sessionModal.classList.add('open');
  sessionModal.setAttribute('aria-hidden', 'false');

  const promise = new Promise((resolve) => {
    sessionModalState.resolve = resolve;
  });

  void (async () => {
    await loadWorkspaceShortcuts();
    const defaultPath = sessionWorkspaceInput.value.trim() || getDefaultWorkspacePath(sessionModalState.shortcuts);
    if (defaultPath) {
      await browseWorkspacePath(defaultPath);
    }
  })();
  window.setTimeout(() => {
    sessionNameInput.focus();
  }, 0);
  return promise;
}

function closeSessionModal(value) {
  if (!sessionModalState.resolve) {
    return;
  }

  const resolve = sessionModalState.resolve;
  sessionModalState.resolve = null;
  sessionModal.classList.remove('open');
  sessionModal.setAttribute('aria-hidden', 'true');
  resolve(value);

  if (sessionModalState.previousFocus && typeof sessionModalState.previousFocus.focus === 'function') {
    sessionModalState.previousFocus.focus();
  }
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

  if (shouldStickToBottom || entries.some((entry) => hasLiveEntryActivity(entry))) {
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
    if (state.tabs.length) {
      return [{
        key: 'unselected',
        kind: 'empty',
        text: '请选择左侧一个会话开始查看和对话。',
        signature: 'unselected',
      }];
    }
    return [{
      key: 'empty',
      kind: 'empty',
      text: '还没有会话，点左侧 "+ 新建会话" 开始。',
      signature: 'empty',
    }];
  }

  const entries = buildSemanticTimelineEntries(threadId);
  if (!entries.length) {
    entries.push({
      key: 'thread-empty',
      kind: 'empty',
      text: '还没有消息，发送第一条指令开始。',
      signature: 'thread-empty',
    });
  }

  return connectionEntries.concat(entries);
}

function buildSemanticTimelineEntries(threadId) {
  const items = ensureItems(threadId);
  const partials = state.partialByThread.get(threadId) || new Map();
  const requests = getServerRequestsForThread(threadId);
  const groups = [];
  const groupsByKey = new Map();
  const groupsByTurnId = new Map();
  const itemToGroupKey = new Map();
  const looseEntries = [];

  function registerGroup(group) {
    groups.push(group);
    groupsByKey.set(group.key, group);
    if (group.turnId) {
      groupsByTurnId.set(group.turnId, group);
    }
    return group;
  }

  function ensureGroupForTurn(turnId) {
    if (!turnId) {
      return null;
    }
    const existing = groupsByTurnId.get(turnId);
    if (existing) {
      return existing;
    }
    return registerGroup({
      key: `turn:${turnId}`,
      turnId,
      userEntry: null,
      timelineEntries: [],
      finalEntry: null,
      isActive: false,
      isPendingLocal: false,
    });
  }

  function createPendingGroup(item) {
    const key = `pending:${item.id || createLocalId('pending')}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      return existing;
    }
    return registerGroup({
      key,
      turnId: null,
      userEntry: null,
      timelineEntries: [],
      finalEntry: null,
      isActive: false,
      isPendingLocal: true,
    });
  }

  function getMostRecentGroup() {
    return groups[groups.length - 1] || null;
  }

  function attachItemToGroup(group, item, entry) {
    if (!group) {
      looseEntries.push(entry);
      return;
    }

    if (item?.type === 'userMessage' && !group.userEntry) {
      group.userEntry = entry;
    } else if (item && isFinalAgentItem(item)) {
      group.finalEntry = entry;
    } else {
      group.timelineEntries.push(entry);
    }

    if (item?.id) {
      itemToGroupKey.set(item.id, group.key);
    }
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const entry = buildEntryFromItem(threadId, item, partials, index);
    if (!entry) {
      continue;
    }
    let group = null;

    if (item.type === 'userMessage') {
      group = item._turnId ? ensureGroupForTurn(item._turnId) : createPendingGroup(item);
      attachItemToGroup(group, item, entry);
      continue;
    }

    if (item._turnId) {
      group = ensureGroupForTurn(item._turnId);
    } else if (item.type !== '_error' && item.type !== '_warning') {
      group = getMostRecentGroup();
    } else if (getMostRecentGroup()) {
      group = getMostRecentGroup();
    }

    attachItemToGroup(group, item, entry);
  }

  for (const request of requests) {
    const entry = buildEntryFromServerRequest(request);
    let group = null;

    if (request.turnId) {
      group = ensureGroupForTurn(request.turnId);
    } else if (request.itemId && itemToGroupKey.has(request.itemId)) {
      group = groupsByKey.get(itemToGroupKey.get(request.itemId)) || null;
    } else {
      group = getMostRecentGroup();
    }

    if (group) {
      group.timelineEntries.push(entry);
      continue;
    }

    looseEntries.push(entry);
  }

  if (state.turnActiveByThread.get(threadId)) {
    const activeTurnId = state.currentTurnIdByThread.get(threadId) || null;
    let activeGroup = activeTurnId ? ensureGroupForTurn(activeTurnId) : getMostRecentGroup();
    if (!activeGroup) {
      activeGroup = registerGroup({
        key: activeTurnId ? `turn:${activeTurnId}` : `active:${threadId}`,
        turnId: activeTurnId,
        userEntry: null,
        timelineEntries: [],
        finalEntry: null,
        isActive: true,
        isPendingLocal: false,
      });
    }
    activeGroup.isActive = true;
  }

  const groupEntries = groups.map((group, index) => ({
    key: `timeline:${group.key}`,
    kind: 'turn',
    threadId,
    index: index + 1,
    userEntry: group.userEntry,
    timelineEntries: group.timelineEntries,
    finalEntry: group.finalEntry,
    isActive: group.isActive,
    isPendingLocal: group.isPendingLocal,
    signature: JSON.stringify([
      'turn',
      group.key,
      group.userEntry?.signature || '',
      group.timelineEntries.map((entry) => entry.signature),
      group.finalEntry?.signature || '',
      group.isActive,
      group.isPendingLocal,
    ]),
  }));

  return looseEntries.concat(groupEntries);
}

function hasLiveEntryActivity(entry) {
  if (!entry) {
    return false;
  }

  if (entry.kind === 'thinking') {
    return true;
  }

  if (entry.partial) {
    return true;
  }

  if (entry.kind === 'turn') {
    return entry.isActive
      || Boolean(entry.finalEntry?.partial)
      || entry.timelineEntries.some((timelineEntry) => hasLiveEntryActivity(timelineEntry));
  }

  return false;
}

function createThinkingEntry(key = '__thinking__', threadId = '') {
  return {
    key,
    kind: 'thinking',
    threadId,
    signature: JSON.stringify(['thinking', key, threadId]),
  };
}

function isFinalAgentItem(item) {
  return item?.type === 'agentMessage' && (!item.phase || item.phase === 'final_answer');
}

function buildEntryFromItem(threadId, item, partials, index) {
  const key = `${item.type}:${item.id || index}:${item._turnId || ''}`;

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
    const summary = getReasoningText(item);
    if (!summary) {
      return null;
    }
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
    const output = getCommandOutput(item);
    const activeThreadId = isItemInActiveTurn(threadId, item) && (status === 'running' || status === 'in_progress' || status === 'pendingApproval')
      ? threadId
      : '';
    return {
      key,
      kind: 'command',
      command: typeof command === 'string' ? command : JSON.stringify(command),
      status,
      output,
      threadId: activeThreadId,
      signature: JSON.stringify(['command', key, command, status, output, activeThreadId]),
    };
  }

  if (item.type === 'fileChange') {
    const pendingRequest = findPendingRequestForItem(threadId, item.id);
    const status = pendingRequest ? 'pendingApproval' : (item.status || '');
    const output = getFileChangeOutput(item);
    const patch = getFileChangePatch(item);
    const changes = normalizeFileChanges(item.changes, patch);
    const activeThreadId = isItemInActiveTurn(threadId, item) && (status === 'running' || status === 'in_progress' || status === 'pendingApproval')
      ? threadId
      : '';
    return {
      key,
      kind: 'fileChange',
      status,
      changes,
      output,
      patch,
      threadId: activeThreadId,
      signature: JSON.stringify(['fileChange', key, status, JSON.stringify(changes), output, patch, activeThreadId]),
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
    return `搜索 "${action.query || item.query || ''}"`;
  }
  if (action.type === 'openPage') {
    return `打开 ${action.url || ''}`;
  }
  return item.query || JSON.stringify(action);
}

function compactText(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function basenamePath(filePath) {
  const normalized = String(filePath || '').replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function formatAgentPhaseLabel(phase) {
  if (phase === 'commentary') {
    return '处理中';
  }
  if (phase === 'final_answer') {
    return '最终答复';
  }
  return phase || '';
}

function createTranscriptRow(role) {
  const row = document.createElement('div');
  row.className = `transcript-row transcript-row-${role}`;

  const body = document.createElement('div');
  body.className = 'transcript-row-body';
  row.appendChild(body);

  return { row, body };
}

function createTimelineMeta(text) {
  const meta = document.createElement('div');
  meta.className = 'timeline-inline-meta';
  meta.textContent = text;
  return meta;
}

function createLiveWorkingMeta(threadId) {
  const meta = document.createElement('div');
  meta.className = 'timeline-inline-meta timeline-inline-meta-working';
  meta.dataset.liveWorkingThreadId = threadId || '';
  meta.textContent = threadId ? getTurnWorkingLabel(threadId) : '';
  return meta;
}

function createTimelineTitle(text) {
  const title = document.createElement('div');
  title.className = 'timeline-inline-title';
  title.textContent = text;
  return title;
}

function createTimelinePlaceholder(text) {
  const placeholder = document.createElement('div');
  placeholder.className = 'timeline-inline-placeholder';
  placeholder.textContent = text;
  return placeholder;
}

function createTimelinePre(text, extraClass = '') {
  const pre = document.createElement('pre');
  pre.className = extraClass ? `timeline-inline-pre ${extraClass}` : 'timeline-inline-pre';
  pre.textContent = text;
  return pre;
}

function createDetailContent() {
  const body = document.createElement('div');
  body.className = 'timeline-inline-detail-body';
  return body;
}

function populateCommandEntry(node, entry) {
  node.className = 'timeline-card timeline-card-command';

  const details = document.createElement('details');
  details.className = 'timeline-inline-detail-row';
  details.open = entry.status === 'running' || entry.status === 'pendingApproval' || entry.status === 'failed';

  const summary = document.createElement('summary');
  summary.appendChild(createTimelineTitle(`${commandStatusIcon(entry.status)} ${compactText(entry.command, 110) || '命令执行'}`));
  summary.appendChild(createTimelineMeta(`命令执行 · ${formatExecutionStatusText(entry.status)}`));
  if (entry.threadId) {
    summary.appendChild(createLiveWorkingMeta(entry.threadId));
  }
  details.appendChild(summary);

  const body = createDetailContent();
  body.appendChild(createTimelinePre(entry.command || '', 'timeline-inline-pre-shell'));
  if (entry.output) {
    body.appendChild(createTimelinePre(entry.output, 'timeline-inline-pre-output'));
  } else if (entry.status === 'running' || entry.status === 'pendingApproval') {
    body.appendChild(createTimelinePlaceholder(entry.status === 'pendingApproval' ? '等待批准后继续执行…' : '命令正在执行…'));
  }
  details.appendChild(body);

  node.appendChild(details);
}

function populateFileChangeEntry(node, entry) {
  node.className = 'timeline-card timeline-card-file-change';

  const details = document.createElement('details');
  details.className = 'timeline-inline-detail-row';
  details.open = entry.status === 'pendingApproval' || entry.status === 'running';

  const summaryText = summarizeFileChanges(entry.changes) || '文件修改';
  const preview = entry.changes.slice(0, 3).map((change) => basenamePath(change.path) || change.path).filter(Boolean);
  const extraCount = entry.changes.length > 3 ? ` · ${preview.length} / ${entry.changes.length}` : '';

  const summary = document.createElement('summary');
  summary.appendChild(createTimelineTitle(`${commandStatusIcon(entry.status)} ${compactText(summaryText, 110)}${extraCount}`));
  summary.appendChild(createTimelineMeta(`文件修改 · ${formatExecutionStatusText(entry.status)}`));
  if (entry.threadId) {
    summary.appendChild(createLiveWorkingMeta(entry.threadId));
  }
  details.appendChild(summary);

  const body = createDetailContent();
  if (preview.length) {
    body.appendChild(createTimelineMeta(preview.join(' · ')));
  }
  const changes = document.createElement('div');
  changes.className = 'file-change-list';
  for (const change of entry.changes) {
    const line = document.createElement('div');
    line.className = `file-change-entry kind-${getNormalizedFileChangeKind(change.kind)}`;
    line.textContent = `${formatFileChangePrefix(change.kind)} ${change.path}`;
    changes.appendChild(line);
  }
  body.appendChild(changes);
  if (!entry.changes.length) {
    body.appendChild(createTimelinePlaceholder('等待文件变更详情…'));
  }
  if (entry.patch) {
    body.appendChild(createTimelinePre(entry.patch, 'timeline-inline-pre-output'));
  } else if (entry.output) {
    body.appendChild(createTimelinePre(entry.output, 'timeline-inline-pre-output'));
  }
  details.appendChild(body);

  node.appendChild(details);
}

function populateToolEntry(node, entry) {
  node.className = 'timeline-card timeline-card-tool';
  node.appendChild(createTimelineTitle(entry.label || '网页操作'));
  node.appendChild(createTimelineMeta('网页操作'));
}

function populateReasoningEntry(node, entry) {
  node.className = 'timeline-card timeline-card-reasoning';
  node.appendChild(createTimelineMeta('思考'));
  node.appendChild(createMessageBody(renderMarkdown(entry.text)));
}

function populateThinkingEntry(node, entry) {
  node.className = 'timeline-card timeline-card-thinking';
  const title = createTimelineTitle('思考中…');
  node.appendChild(title);
  if (entry?.threadId) {
    node.appendChild(createLiveWorkingMeta(entry.threadId));
  }
  const dots = document.createElement('div');
  dots.className = 'thinking-inline';
  dots.appendChild(createDot());
  dots.appendChild(createDot());
  dots.appendChild(createDot());
  node.appendChild(dots);
}

function populateNoticeEntry(node, entry) {
  node.className = `timeline-system timeline-system-${entry.kind === '_error' ? 'error' : 'warning'}`;
  node.textContent = entry.text;
}

function populateMessageNode(node, entry) {
  node.replaceChildren();

  if (entry.kind === 'empty') {
    node.className = 'message';
    node.classList.add('empty-state');
    node.textContent = entry.text;
    return;
  }

  if (entry.kind === 'turn') {
    node.className = 'turn-thread';

    const meta = document.createElement('div');
    meta.className = 'turn-thread-meta';

    const title = document.createElement('span');
    title.className = 'turn-thread-index';
    title.textContent = `第 ${entry.index} 轮`;
    meta.appendChild(title);

    if (entry.isPendingLocal) {
      meta.appendChild(createTurnBadge('待启动'));
    }
    if (entry.isActive) {
      meta.appendChild(createTurnBadge('进行中', 'active'));
    } else if (entry.finalEntry || entry.timelineEntries.length) {
      meta.appendChild(createTurnBadge('已完成', 'done'));
    }
    node.appendChild(meta);

    if (entry.userEntry) {
      const userRow = createTranscriptRow('user');
      userRow.body.appendChild(createEntryElement(entry.userEntry));
      node.appendChild(userRow.row);
    }

    const shouldRenderAssistantRow = entry.timelineEntries.length > 0 || entry.isActive || entry.finalEntry;
    if (shouldRenderAssistantRow) {
      const assistantRow = createTranscriptRow('assistant');
      const stack = document.createElement('div');
      stack.className = 'assistant-main-stack';
      for (const timelineEntry of entry.timelineEntries) {
        stack.appendChild(createTimelineEvent(timelineEntry));
      }
      if (entry.isActive && !entry.finalEntry) {
        stack.appendChild(createTimelineEvent(createThinkingEntry(`${entry.key}:thinking`, entry.threadId || '')));
      }
      if (stack.childNodes.length) {
        assistantRow.body.appendChild(stack);
      }
      if (entry.finalEntry) {
        assistantRow.body.appendChild(createEntryElement(entry.finalEntry));
      }
      node.appendChild(assistantRow.row);
    }

    return;
  }

  if (entry.kind === 'thinking') {
    populateThinkingEntry(node, entry);
    return;
  }

  if (entry.kind === 'user') {
    node.className = 'message user msg-bubble msg-bubble-user';
    node.textContent = entry.text;
    return;
  }

  if (entry.kind === 'agent') {
    const isCommentary = entry.phase && entry.phase !== 'final_answer';
    node.className = `message agent msg-bubble ${isCommentary ? 'msg-bubble-commentary' : 'msg-bubble-assistant'}`;
    if (isCommentary) {
      const phase = document.createElement('div');
      phase.className = 'item-phase';
      phase.textContent = formatAgentPhaseLabel(entry.phase);
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
    populateReasoningEntry(node, entry);
    return;
  }

  if (entry.kind === 'tool') {
    populateToolEntry(node, entry);
    return;
  }

  if (entry.kind === 'command') {
    populateCommandEntry(node, entry);
    return;
  }

  if (entry.kind === 'fileChange') {
    populateFileChangeEntry(node, entry);
    return;
  }

  if (entry.kind === 'serverRequest') {
    node.className = 'approval-banner approval-card';
    populateServerRequestNode(node, entry.request);
    return;
  }

  if (entry.kind === '_error' || entry.kind === '_warning') {
    populateNoticeEntry(node, entry);
    return;
  }

  node.className = 'timeline-card timeline-card-generic';
  const label = document.createElement('div');
  label.className = 'timeline-inline-title';
  label.textContent = `⚙ ${entry.label}`;
  node.appendChild(label);

  const preview = document.createElement('pre');
  preview.className = 'timeline-inline-pre';
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

function formatFileChangePrefix(kind) {
  const normalized = getNormalizedFileChangeKind(kind);
  if (normalized === 'add') {
    return '+ 新增';
  }
  if (normalized === 'delete') {
    return '- 删除';
  }
  return '~ 修改';
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

function createEntryElement(entry) {
  const node = document.createElement('div');
  populateMessageNode(node, entry);
  return node;
}

function createTimelineEvent(entry) {
  const row = document.createElement('div');
  row.className = 'timeline-event';
  if (entry?.kind) {
    row.classList.add(`kind-${entry.kind}`);
  }

  const marker = document.createElement('div');
  marker.className = 'timeline-marker';
  row.appendChild(marker);

  const content = document.createElement('div');
  content.className = 'timeline-content';
  content.appendChild(createEntryElement(entry));
  row.appendChild(content);

  return row;
}

function createTurnBadge(text, variant = '') {
  const badge = document.createElement('span');
  badge.className = variant ? `turn-badge ${variant}` : 'turn-badge';
  badge.textContent = text;
  return badge;
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

function formatExecutionStatusText(status) {
  if (status === 'completed') {
    return '已完成';
  }
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'declined') {
    return '已拒绝';
  }
  if (status === 'pendingApproval') {
    return '待批准';
  }
  if (status === 'in_progress' || status === 'running') {
    return '进行中';
  }
  return '执行中';
}

function render() {
  renderTabs();
  renderHeader();
  renderNewTabButton();
  renderComposer();
  renderMessages();
  renderCreatingOverlay();
}

function refreshLiveWorkingLabels() {
  const nodes = messagesEl.querySelectorAll('[data-live-working-thread-id]');
  nodes.forEach((node) => {
    const threadId = node.dataset.liveWorkingThreadId || '';
    node.textContent = threadId ? getTurnWorkingLabel(threadId) : '';
  });
}

function renderNewTabButton() {
  newTabBtn.disabled = state.creatingTab || state.authFailed;
  newTabBtn.classList.toggle('is-loading', state.creatingTab);
  newTabBtn.textContent = state.creatingTab ? '正在创建会话...' : '+ 新建会话';
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

async function browseWorkspacePath(targetPath = '') {
  sessionModalState.browserLoading = true;
  renderSessionModal();
  setSessionModalHint('正在加载目录...');

  try {
    const url = new URL('/api/workspace/list', window.location.origin);
    if (targetPath) {
      url.searchParams.set('path', targetPath);
    }
    const result = await apiFetchJson(url);
    sessionModalState.browserPath = result.path || '';
    sessionModalState.browserParentPath = result.parentPath || '';
    sessionModalState.browserEntries = Array.isArray(result.entries) ? result.entries : [];
    updateSessionWorkspacePath(sessionModalState.browserPath);
    setSessionModalHint('已同步目录列表，可继续进入子目录或直接使用当前目录。');
  } catch (error) {
    setSessionModalHint(`读取目录失败：${error.message}`, true);
  } finally {
    sessionModalState.browserLoading = false;
    renderSessionModal();
  }
}

async function createWorkspaceOnHost() {
  if (sessionModalState.creatingWorkspace) {
    return;
  }

  const parentPath = sessionModalState.browserPath || sessionWorkspaceInput.value.trim() || getDefaultWorkspacePath(sessionModalState.shortcuts);
  if (!parentPath) {
    setSessionModalHint('请先输入或选择父目录，再新建文件夹。', true);
    sessionWorkspaceInput.focus();
    return;
  }

  const folderName = await openTextModal({
    title: '新建文件夹',
    label: '文件夹名称',
    placeholder: '请输入新文件夹名称',
    confirmText: '创建',
    inputType: 'text',
  });

  if (folderName === null) {
    return;
  }

  sessionModalState.creatingWorkspace = true;
  renderSessionModal();
  setSessionModalHint('正在主机上创建新文件夹...');

  try {
    const result = await apiFetchJson('/api/workspace/create-directory', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        parentPath,
        folderName,
      }),
    });

    if (result.path) {
      updateSessionWorkspacePath(result.path);
      if (sessionModalState.shortcuts) {
        sessionModalState.shortcuts.lastUsedPath = result.path;
      }
      setSessionModalHint('新工作区文件夹已创建。');
      await browseWorkspacePath(result.path);
    }
  } catch (error) {
    setSessionModalHint(`创建文件夹失败：${error.message}`, true);
  } finally {
    sessionModalState.creatingWorkspace = false;
    renderSessionModal();
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

  const draft = await openSessionModal();
  if (draft === null) {
    return;
  }

  state.creatingTab = true;
  render();
  const createPrefs = getActiveComposerPrefs();
  if (!send({
    type: 'tab_create',
    name: draft.name,
    cwd: draft.cwd,
    model: normalizeComposerModel(createPrefs?.model) || state.composerModelDefault || '',
  })) {
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

browseWorkspaceBtn.addEventListener('click', () => {
  void browseWorkspacePath(sessionWorkspaceInput.value.trim() || getDefaultWorkspacePath(sessionModalState.shortcuts));
});

workspaceUpBtn.addEventListener('click', () => {
  if (!sessionModalState.browserParentPath) {
    return;
  }
  void browseWorkspacePath(sessionModalState.browserParentPath);
});

workspaceRefreshBtn.addEventListener('click', () => {
  if (!sessionModalState.browserPath) {
    return;
  }
  void browseWorkspacePath(sessionModalState.browserPath);
});

createWorkspaceBtn.addEventListener('click', () => {
  void createWorkspaceOnHost();
});

useCurrentWorkspaceBtn.addEventListener('click', () => {
  if (!sessionModalState.browserPath) {
    return;
  }
  updateSessionWorkspacePath(sessionModalState.browserPath);
  setSessionModalHint('已选中当前目录。');
});

sessionModalCancelBtn.addEventListener('click', () => {
  closeSessionModal(null);
});

sessionModalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const cwd = sessionWorkspaceInput.value.trim() || sessionModalState.browserPath || getDefaultWorkspacePath(sessionModalState.shortcuts);
  if (!cwd) {
    setSessionModalHint('请先选择一个工作区目录。', true);
    sessionWorkspaceInput.focus();
    return;
  }

  closeSessionModal({
    name: sessionNameInput.value.trim(),
    cwd,
  });
});

textModal.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.modalClose === 'true') {
    closeTextModal(null);
  }
});

sessionModal.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.sessionModalClose === 'true') {
    closeSessionModal(null);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalState.resolve) {
    closeTextModal(null);
    return;
  }
  if (event.key === 'Escape' && sessionModalState.resolve) {
    closeSessionModal(null);
  }
});

sessionWorkspaceInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  void browseWorkspacePath(sessionWorkspaceInput.value.trim() || getDefaultWorkspacePath(sessionModalState.shortcuts));
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  composer.requestSubmit();
});

modelSelect.addEventListener('change', () => {
  setComposerPrefsForThread(state.activeThreadId, {
    model: modelSelect.value,
    effort: reasoningEffortSelect.value,
  });
  renderComposer();
});

reasoningEffortSelect.addEventListener('change', () => {
  setComposerPrefsForThread(state.activeThreadId, {
    model: modelSelect.value,
    effort: reasoningEffortSelect.value,
  });
  renderComposer();
});

themeSelect.addEventListener('change', () => {
  saveThemePreference(themeSelect.value);
  renderHeader();
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

  const composerSelection = getEffectiveComposerSelection(threadId);
  state.turnActiveByThread.set(threadId, true);
  if (!send({
    type: 'turn_send',
    threadId,
    text,
    clientMessageId,
    model: composerSelection.model || '',
    effort: composerSelection.effort || '',
  })) {
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
    if (state.activeThreadId && !state.tabs.some((tab) => tab.threadId === state.activeThreadId)) {
      state.activeThreadId = null;
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
    rememberTurnStartedAt(msg.threadId, msg.startedAt);
    if (msg.turnId) {
      state.currentTurnIdByThread.set(msg.threadId, msg.turnId);
      assignPendingUserMessageToTurn(msg.threadId, msg.turnId);
    }
    if (msg.threadId === state.activeThreadId) {
      renderHeader();
      renderMessages();
    }
    return;
  }

  if (msg.type === 'turn_completed') {
    state.turnActiveByThread.set(msg.threadId, false);
    clearTurnStartedAt(msg.threadId);
    if (!msg.turnId || state.currentTurnIdByThread.get(msg.threadId) === msg.turnId) {
      state.currentTurnIdByThread.delete(msg.threadId);
    }
    if (msg.threadId === state.activeThreadId) {
      renderHeader();
      renderMessages();
    }
    return;
  }

  if (msg.type === 'agent_delta') {
    state.turnActiveByThread.set(msg.threadId, true);
    rememberTurnStartedAt(msg.threadId, msg.startedAt);
    if (msg.turnId) {
      state.currentTurnIdByThread.set(msg.threadId, msg.turnId);
    }
    upsertStreamingItem(msg.threadId, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null, msg.itemId, msg.delta || '');
    if (msg.threadId === state.activeThreadId) {
      renderHeader();
      renderMessages();
    }
    return;
  }

  if (msg.type === 'item_started') {
    state.turnActiveByThread.set(msg.threadId, true);
    rememberTurnStartedAt(msg.threadId, msg.startedAt);
    if (msg.turnId) {
      state.currentTurnIdByThread.set(msg.threadId, msg.turnId);
    }
    const items = ensureItems(msg.threadId);
    const item = cloneItemForTurn(msg.item, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null);
    reconcilePendingUserMessage(msg.threadId, item);
    if (item && item.id && !items.find((entry) => entry.id === item.id)) {
      items.push({ ...item, _partial: true });
    }
    if (msg.threadId === state.activeThreadId) {
      renderHeader();
      renderMessages();
    }
    return;
  }

  if (msg.type === 'item_completed') {
    if (msg.turnId) {
      state.currentTurnIdByThread.set(msg.threadId, msg.turnId);
    }
    const item = cloneItemForTurn(msg.item, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null);
    reconcilePendingUserMessage(msg.threadId, item);
    finalizeItem(msg.threadId, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null, item);
    if (msg.threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  if (msg.type === 'item_delta') {
    state.turnActiveByThread.set(msg.threadId, true);
    rememberTurnStartedAt(msg.threadId, msg.startedAt);
    if (msg.turnId) {
      state.currentTurnIdByThread.set(msg.threadId, msg.turnId);
    }

    if (msg.method === 'item/commandExecution/outputDelta') {
      upsertLiveItem(msg.threadId, msg.turnId, msg.itemId, 'commandExecution', (item) => {
        const delta = typeof msg.delta === 'string' ? msg.delta : '';
        item.aggregatedOutput = `${item.aggregatedOutput || item.output || ''}${delta}`;
      });
    } else if (msg.method === 'item/fileChange/outputDelta') {
      upsertLiveItem(msg.threadId, msg.turnId, msg.itemId, 'fileChange', (item) => {
        const delta = typeof msg.delta === 'string' ? msg.delta : '';
        item.aggregatedOutput = `${item.aggregatedOutput || item.output || ''}${delta}`;
      });
    } else if (msg.method === 'item/fileChange/patchUpdated') {
      upsertLiveItem(msg.threadId, msg.turnId, msg.itemId, 'fileChange', (item) => {
        if (typeof msg.patch === 'string') {
          item.patch = msg.patch;
        }
        if (Array.isArray(msg.changes)) {
          item.changes = msg.changes;
        }
      });
    } else if (msg.method === 'item/reasoning/summaryTextDelta') {
      upsertLiveItem(msg.threadId, msg.turnId, msg.itemId, 'reasoning', (item) => {
        appendReasoningSummaryText(item, typeof msg.delta === 'string' ? msg.delta : '');
      });
    } else if (msg.method === 'item/reasoning/summaryPartAdded') {
      upsertLiveItem(msg.threadId, msg.turnId, msg.itemId, 'reasoning', (item) => {
        appendReasoningSummaryPart(item, msg.part);
      });
    } else if (msg.method === 'item/reasoning/textDelta') {
      upsertLiveItem(msg.threadId, msg.turnId, msg.itemId, 'reasoning', (item) => {
        appendReasoningContentText(item, typeof msg.delta === 'string' ? msg.delta : '');
      });
    }

    if (msg.threadId === state.activeThreadId) {
      renderHeader();
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
      _turnId: state.currentTurnIdByThread.get(threadId) || null,
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
      _turnId: state.currentTurnIdByThread.get(state.activeThreadId) || null,
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
        text: msg.message || '该会话在 Codex 中不存在，已标记为关闭。',
        _turnId: state.currentTurnIdByThread.get(threadId) || null,
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
      _turnId: state.currentTurnIdByThread.get(threadId) || null,
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
      _turnId: state.currentTurnIdByThread.get(threadId) || null,
    });
    if (threadId === state.activeThreadId) {
      renderMessages();
    }
    return;
  }

  console.log('Unhandled message:', msg.type, msg);
}

window.setInterval(() => {
  if (state.creatingTab || Array.from(state.turnActiveByThread.values()).some(Boolean)) {
    renderHeader();
    refreshLiveWorkingLabels();
  }
}, 1000);
