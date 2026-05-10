import {
  closeContextUsagePopover,
  renderContextUsage,
  renderHeaderStatus,
} from './header.js';
import {
  compareTabs,
  getSessionName,
  getWorkspacePath,
  getWorkspaceFolder,
  renderTabs as renderTabsView,
} from './tabs.js';
import {
  renderComposer as renderComposerView,
  renderComposerAttachmentList as renderComposerAttachmentListView,
} from './composer.js';
import { createSocketController } from './socket.js';
import { createSessionModalController } from './sessionModal.js';
import { createMessageHandler } from './messageHandlers.js';
import { createMessageEntryBuilder } from './messageEntries.js';
import { createMessageRenderer } from './messageRenderer.js';

const EMPTY_THREAD_KEY = '__empty__';
const DEFAULT_PROMPT_PLACEHOLDER = '给当前会话发送指令...';
const COMPOSER_PREFS_STORAGE_KEY = 'codex-remote-composer-prefs';
const THEME_STORAGE_KEY = 'codex-remote-theme';
const REASONING_EFFORT_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const APPROVAL_POLICY_OPTIONS = ['untrusted', 'on-request', 'never', 'on-failure'];
const SANDBOX_MODE_OPTIONS = ['read-only', 'workspace-write', 'danger-full-access'];
const THEME_OPTIONS = [
  { value: 'paper', label: '纸墨' },
  { value: 'bay', label: '海湾' },
  { value: 'night', label: '夜航' },
];

// DOM
const sidebar = document.getElementById('sidebar');
const sidebarClose = document.getElementById('sidebarClose');
const menuBtn = document.getElementById('menuBtn');
const tabList = document.getElementById('tabList');
const newTabBtn = document.getElementById('newTabBtn');
const messagesEl = document.getElementById('messages');
const jumpToBottomBtn = document.getElementById('jumpToBottomBtn');
const sessionCreatingOverlay = document.getElementById('sessionCreatingOverlay');
const composer = document.getElementById('composer');
const composerControlsToggle = document.getElementById('composerControlsToggle');
const composerControlsSummary = document.getElementById('composerControlsSummary');
const modelSelect = document.getElementById('modelSelect');
const reasoningEffortSelect = document.getElementById('reasoningEffortSelect');
const permissionPresetSelect = document.getElementById('permissionPresetSelect');
const approvalPolicySelect = document.getElementById('approvalPolicySelect');
const sandboxModeSelect = document.getElementById('sandboxModeSelect');
const promptInput = document.getElementById('promptInput');
const attachImageBtn = document.getElementById('attachImageBtn');
const imageInput = document.getElementById('imageInput');
const composerAttachmentList = document.getElementById('composerAttachmentList');
const slashMenu = document.getElementById('slashMenu');
const composerSubmitBtn = composer.querySelector('button[type="submit"]');
const activeTitle = document.getElementById('activeTitle');
const themeSelect = document.getElementById('themeSelect');
const contextUsage = document.getElementById('contextUsage');
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
const sessionModalTopCloseBtn = document.getElementById('sessionModalTopCloseBtn');
const sessionModalCancelBtn = document.getElementById('sessionModalCancelBtn');
const sessionModalConfirmBtn = document.getElementById('sessionModalConfirmBtn');
const customSelectControllers = new WeakMap();
let activeCustomSelect = null;
const SLASH_COMMANDS = [
  { name: '/new', aliases: ['/new-session'], title: '新建会话', description: '打开新建会话窗口', action: 'new_session' },
  { name: '/workspace', aliases: ['/cwd', '/dir'], title: '工作区', description: '打开新建会话窗口并优先选择工作区', action: 'open_workspace_picker' },
  { name: '/sessions', aliases: ['/tabs', '/sidebar'], title: '会话列表', description: '打开左侧会话列表', action: 'open_sessions' },
  { name: '/close', aliases: ['/close-session'], title: '关闭会话', description: '关闭当前会话', action: 'close_session' },
  { name: '/refresh', aliases: ['/sync'], title: '刷新会话', description: '重新同步当前会话消息', action: 'refresh_session' },
  { name: '/reconnect', aliases: ['/retry-connection'], title: '重新连接', description: '重连 WebSocket 并刷新会话状态', action: 'reconnect_socket' },
  { name: '/permissions', aliases: ['/approvals', '/approvels', '/approval', '/mode'], title: '权限设置', description: '打开 /approvals 权限设置', action: 'show_permission_settings' },
  { name: '/sandbox', aliases: ['/isolation'], title: '权限范围', description: '打开权限范围选择', action: 'open_sandbox' },
  { name: '/pending', aliases: ['/requests'], title: '待处理请求', description: '定位当前会话的待批准请求', action: 'show_approvals' },
  { name: '/approve', aliases: ['/allow'], title: '批准', description: '批准当前会话最新待处理请求', action: 'approve_latest' },
  { name: '/approve-session', aliases: ['/allow-session'], title: '本会话允许', description: '本会话内持续允许当前待处理请求', action: 'approve_latest_for_session' },
  { name: '/deny', aliases: ['/reject'], title: '拒绝', description: '拒绝当前会话最新待处理请求', action: 'deny_latest' },
  { name: '/model', aliases: ['/models'], title: '切换模型', description: '打开模型选择', action: 'open_model' },
  { name: '/effort', aliases: ['/reasoning'], title: '切换思考等级', description: '打开思考等级选择', action: 'open_effort' },
  { name: '/theme', aliases: ['/appearance'], title: '切换主题', description: '打开主题选择', action: 'open_theme' },
  { name: '/token', aliases: ['/auth'], title: '设置 Token', description: '打开 WebSocket Token 设置窗口', action: 'open_token' },
  { name: '/status', aliases: ['/info'], title: '当前状态', description: '显示当前连接、会话和工作区信息', action: 'show_status' },
  { name: '/clear', aliases: ['/reset-input'], title: '清空输入框', description: '清除当前输入内容', action: 'clear_input' },
  { name: '/help', aliases: ['/commands'], title: '查看命令', description: '显示可用的本地命令', action: 'show_help' },
];
const slashMenuState = {
  visible: false,
  query: '',
  items: [],
  activeIndex: 0,
};
let scheduledRenderFrame = 0;
let scheduledRenderHeader = false;
let scheduledRenderMessages = false;

const PERMISSION_PRESET_VALUES = new Set(['', 'read-only', 'auto', 'full-access', 'custom']);

ensureCustomSelect(themeSelect);
ensureCustomSelect(modelSelect);
ensureCustomSelect(reasoningEffortSelect);
ensureCustomSelect(permissionPresetSelect);
ensureCustomSelect(approvalPolicySelect);
ensureCustomSelect(sandboxModeSelect);

modelSelect.dataset.hideEmptyOption = 'true';
reasoningEffortSelect.dataset.hideEmptyOption = 'true';
permissionPresetSelect.dataset.hideEmptyOption = 'true';
approvalPolicySelect.dataset.hideEmptyOption = 'true';
sandboxModeSelect.dataset.hideEmptyOption = 'true';

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) {
    closeActiveCustomSelect();
    closeSlashMenu();
    closeContextUsagePopover(contextUsage);
    return;
  }
  if (activeCustomSelect && !activeCustomSelect.wrapper.contains(target)) {
    closeActiveCustomSelect();
  }
  if (!slashMenu.hidden && !slashMenu.contains(target) && target !== promptInput) {
    closeSlashMenu();
  }
  if (contextUsage && !contextUsage.contains(target)) {
    closeContextUsagePopover(contextUsage);
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
  if (window.innerWidth > 720) {
    composer.classList.remove('mobile-controls-open');
    composerControlsToggle.setAttribute('aria-expanded', 'false');
  }
});

messagesEl.addEventListener('scroll', () => {
  messageRenderer.handleMessagesScroll();
});

jumpToBottomBtn.addEventListener('click', () => {
  messageRenderer.jumpToBottom();
});

const state = {
  tabs: [],
  activeThreadId: null,
  itemsByThread: new Map(),
  partialByThread: new Map(),
  turnActiveByThread: new Map(),
  currentTurnIdByThread: new Map(),
  turnStartedAtByThread: new Map(),
  tokenUsageByThread: new Map(),
  composerAttachmentsByThread: new Map(),
  composerUploadsInFlightByThread: new Map(),
  unreadThreadIds: new Set(),
  pendingUserMessages: new Map(),
  serverRequests: [],
  availableModels: [],
  composerOptionsLoading: false,
  composerOptionsLoaded: false,
  composerModelDefault: '',
  composerEffortDefault: '',
  composerApprovalPolicyDefault: '',
  composerSandboxModeDefault: '',
  composerPrefsByThread: new Map(),
  composerGlobalPrefs: { model: '', effort: '', approvalPolicy: '', sandboxMode: '' },
  currentTheme: 'paper',
  creatingTab: false,
  authFailed: false,
  connectionError: '',
};

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

function getAttachmentFileName(value) {
  const normalized = String(value || '').replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function buildUploadPreviewUrl(fileName) {
  const normalized = getAttachmentFileName(fileName);
  if (!normalized) {
    return '';
  }
  return withAuthTokenQuery(`/api/uploads/${encodeURIComponent(normalized)}`);
}

function normalizeUserMessageContent(item) {
  const normalized = [];
  const seen = new Set();

  function pushText(text) {
    if (typeof text !== 'string') {
      return;
    }
    const value = text.trim();
    if (!value) {
      return;
    }
    const key = `text:${value}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push({ type: 'text', text: value });
  }

  function pushLocalImage(entry) {
    const rawPath = typeof entry === 'string'
      ? entry
      : (entry?.path || entry?.filePath || entry?.filepath || entry?.local_path || entry?.localPath || '');
    const path = String(rawPath || '').trim();
    if (!path) {
      return;
    }
    const name = String(
      (typeof entry === 'object' && entry)
        ? (entry.name || entry.fileName || getAttachmentFileName(path))
        : getAttachmentFileName(path)
    ).trim();
    const previewUrl = typeof entry === 'object' && entry
      ? (entry.previewUrl || entry.url || buildUploadPreviewUrl(path))
      : buildUploadPreviewUrl(path);
    const key = `localImage:${path}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push({
      type: 'localImage',
      path,
      name,
      previewUrl,
    });
  }

  function pushRemoteImage(entry) {
    const url = String(
      (typeof entry === 'string' ? entry : (entry?.url || entry?.uri || entry?.src || ''))
    ).trim();
    if (!url) {
      return;
    }
    const name = String(
      (typeof entry === 'object' && entry)
        ? (entry.name || entry.fileName || getAttachmentFileName(url))
        : getAttachmentFileName(url)
    ).trim();
    const key = `image:${url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push({
      type: 'image',
      url,
      name,
    });
  }

  for (const entry of Array.isArray(item?.content) ? item.content : []) {
    if (entry?.type === 'text') {
      pushText(entry.text);
      continue;
    }
    if (entry?.type === 'localImage' || entry?.type === 'local_image') {
      pushLocalImage(entry);
      continue;
    }
    if (entry?.type === 'image') {
      pushRemoteImage(entry);
    }
  }

  for (const entry of Array.isArray(item?.local_images) ? item.local_images : []) {
    pushLocalImage(entry);
  }
  for (const entry of Array.isArray(item?.localImages) ? item.localImages : []) {
    pushLocalImage(entry);
  }
  for (const entry of Array.isArray(item?.images) ? item.images : []) {
    pushRemoteImage(entry);
  }

  return normalized;
}

function createUserMessageFingerprint(content) {
  const normalized = Array.isArray(content) ? content : [];
  return JSON.stringify(normalized.map((entry) => {
    if (entry.type === 'text') {
      return { type: 'text', text: entry.text || '' };
    }
    if (entry.type === 'localImage') {
      return { type: 'localImage', path: entry.path || '' };
    }
    if (entry.type === 'image') {
      return { type: 'image', url: entry.url || '' };
    }
    return { type: entry.type || 'unknown' };
  }));
}

function getComposerAttachments(threadId = state.activeThreadId) {
  if (!threadId) {
    return [];
  }
  if (!state.composerAttachmentsByThread.has(threadId)) {
    state.composerAttachmentsByThread.set(threadId, []);
  }
  return state.composerAttachmentsByThread.get(threadId);
}

function setComposerAttachments(threadId, attachments) {
  if (!threadId) {
    return;
  }
  state.composerAttachmentsByThread.set(threadId, Array.isArray(attachments) ? attachments : []);
}

function clearComposerAttachments(threadId = state.activeThreadId) {
  if (!threadId) {
    return;
  }
  state.composerAttachmentsByThread.set(threadId, []);
}

function getComposerUploadCount(threadId = state.activeThreadId) {
  if (!threadId) {
    return 0;
  }
  return state.composerUploadsInFlightByThread.get(threadId) || 0;
}

function setComposerUploadCount(threadId, count) {
  if (!threadId) {
    return;
  }
  if (count > 0) {
    state.composerUploadsInFlightByThread.set(threadId, count);
  } else {
    state.composerUploadsInFlightByThread.delete(threadId);
  }
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

function normalizeComposerApprovalPolicy(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return APPROVAL_POLICY_OPTIONS.includes(normalized) ? normalized : '';
}

function normalizeComposerSandboxMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SANDBOX_MODE_OPTIONS.includes(normalized) ? normalized : '';
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
      approvalPolicy: normalizeComposerApprovalPolicy(parsed?.approvalPolicy),
      sandboxMode: normalizeComposerSandboxMode(parsed?.sandboxMode),
    };
  } catch (_error) {
    state.composerGlobalPrefs = { model: '', effort: '', approvalPolicy: '', sandboxMode: '' };
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

function buildComposerPrefs(threadId, overrides = {}) {
  const current = threadId ? (state.composerPrefsByThread.get(threadId) || state.composerGlobalPrefs) : state.composerGlobalPrefs;
  return {
    model: Object.prototype.hasOwnProperty.call(overrides, 'model')
      ? normalizeComposerModel(overrides.model)
      : normalizeComposerModel(current?.model),
    effort: Object.prototype.hasOwnProperty.call(overrides, 'effort')
      ? normalizeComposerEffort(overrides.effort)
      : normalizeComposerEffort(current?.effort),
    approvalPolicy: Object.prototype.hasOwnProperty.call(overrides, 'approvalPolicy')
      ? normalizeComposerApprovalPolicy(overrides.approvalPolicy)
      : normalizeComposerApprovalPolicy(current?.approvalPolicy),
    sandboxMode: Object.prototype.hasOwnProperty.call(overrides, 'sandboxMode')
      ? normalizeComposerSandboxMode(overrides.sandboxMode)
      : normalizeComposerSandboxMode(current?.sandboxMode),
  };
}

function setComposerPrefsForThread(threadId, prefs) {
  const normalized = {
    model: normalizeComposerModel(prefs?.model),
    effort: normalizeComposerEffort(prefs?.effort),
    approvalPolicy: normalizeComposerApprovalPolicy(prefs?.approvalPolicy),
    sandboxMode: normalizeComposerSandboxMode(prefs?.sandboxMode),
  };

  if (threadId) {
    state.composerPrefsByThread.set(threadId, normalized);
  }
  state.composerGlobalPrefs = normalized;
  saveComposerGlobalPrefs();
}

function setComposerPrefsFromInputs(threadId = state.activeThreadId, overrides = {}) {
  const currentPrefs = threadId
    ? (state.composerPrefsByThread.get(threadId) || state.composerGlobalPrefs)
    : state.composerGlobalPrefs;
  const normalized = buildComposerPrefs(threadId, {
    model: Object.prototype.hasOwnProperty.call(overrides, 'model') ? overrides.model : modelSelect.value,
    effort: Object.prototype.hasOwnProperty.call(overrides, 'effort') ? overrides.effort : reasoningEffortSelect.value,
    approvalPolicy: Object.prototype.hasOwnProperty.call(overrides, 'approvalPolicy') ? overrides.approvalPolicy : approvalPolicySelect.value,
    sandboxMode: Object.prototype.hasOwnProperty.call(overrides, 'sandboxMode') ? overrides.sandboxMode : sandboxModeSelect.value,
  });
  if (!confirmHighRiskPermissionChange(currentPrefs, normalized)) {
    return null;
  }
  setComposerPrefsForThread(threadId, normalized);
  return normalized;
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
      label: value,
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

function formatApprovalPolicyLabel(value) {
  if (!value) {
    return '跟随当前配置';
  }
  if (value === 'untrusted') {
    return '仅不受信命令需批准';
  }
  if (value === 'on-request') {
    return '按需批准（On Request）';
  }
  if (value === 'never') {
    return '从不询问（Never）';
  }
  if (value === 'on-failure') {
    return '失败后询问（已弃用）';
  }
  return value;
}

function getPermissionPresetDefinition(value) {
  if (value === 'read-only') {
    return {
      value,
      label: 'Read Only',
      description: '只读 + 按需批准',
      approvalPolicy: 'on-request',
      sandboxMode: 'read-only',
    };
  }
  if (value === 'auto') {
    return {
      value,
      label: 'Auto',
      description: '工作区可写 + 按需批准',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
    };
  }
  if (value === 'full-access') {
    return {
      value,
      label: 'Full Access',
      description: '完全权限 + 按需批准',
      approvalPolicy: 'on-request',
      sandboxMode: 'danger-full-access',
    };
  }
  return null;
}

function isApprovalPolicyHighRisk(value) {
  return normalizeComposerApprovalPolicy(value) === 'never';
}

function isSandboxModeHighRisk(value) {
  return normalizeComposerSandboxMode(value) === 'danger-full-access';
}

function buildHighRiskPermissionChangeMessage(nextPrefs) {
  const approvalPolicy = normalizeComposerApprovalPolicy(nextPrefs?.approvalPolicy);
  const sandboxMode = normalizeComposerSandboxMode(nextPrefs?.sandboxMode);

  if (isApprovalPolicyHighRisk(approvalPolicy) && isSandboxModeHighRisk(sandboxMode)) {
    return '即将切换到高风险组合：Full Access + Never。\n\n这会同时关闭沙箱限制，并停止后续批准确认。Codex 之后可以直接执行高权限操作。确定继续吗？';
  }
  if (isSandboxModeHighRisk(sandboxMode)) {
    return '即将切换到 Full Access（danger-full-access）。\n\n这会取消沙箱限制，允许 Codex 访问当前主机；但后续是否仍需确认，取决于“执行批准”设置。单独的 Full Access 仍不等于 Never。确定继续吗？';
  }
  if (isApprovalPolicyHighRisk(approvalPolicy)) {
    return '即将切换到 Never。\n\n后续命令执行将不再经过网页批准确认。这比仅切到 Full Access 更危险。确定继续吗？';
  }
  return '';
}

function shouldConfirmHighRiskPermissionChange(previousPrefs, nextPrefs) {
  const previousApprovalPolicy = normalizeComposerApprovalPolicy(previousPrefs?.approvalPolicy);
  const previousSandboxMode = normalizeComposerSandboxMode(previousPrefs?.sandboxMode);
  const nextApprovalPolicy = normalizeComposerApprovalPolicy(nextPrefs?.approvalPolicy);
  const nextSandboxMode = normalizeComposerSandboxMode(nextPrefs?.sandboxMode);

  const sandboxEscalated = !isSandboxModeHighRisk(previousSandboxMode) && isSandboxModeHighRisk(nextSandboxMode);
  const approvalEscalated = !isApprovalPolicyHighRisk(previousApprovalPolicy) && isApprovalPolicyHighRisk(nextApprovalPolicy);
  return sandboxEscalated || approvalEscalated;
}

function confirmHighRiskPermissionChange(previousPrefs, nextPrefs) {
  if (!shouldConfirmHighRiskPermissionChange(previousPrefs, nextPrefs)) {
    return true;
  }
  const message = buildHighRiskPermissionChangeMessage(nextPrefs);
  if (!message) {
    return true;
  }
  return window.confirm(message);
}

function inferPermissionPresetValue(approvalPolicy, sandboxMode) {
  const normalizedApprovalPolicy = normalizeComposerApprovalPolicy(approvalPolicy);
  const normalizedSandboxMode = normalizeComposerSandboxMode(sandboxMode);
  if (!normalizedApprovalPolicy && !normalizedSandboxMode) {
    return '';
  }

  for (const value of ['read-only', 'auto', 'full-access']) {
    const preset = getPermissionPresetDefinition(value);
    if (!preset) {
      continue;
    }
    if (preset.approvalPolicy === normalizedApprovalPolicy && preset.sandboxMode === normalizedSandboxMode) {
      return value;
    }
  }

  return 'custom';
}

function formatPermissionPresetLabel(value, options = {}) {
  const { includeDescription = false } = options;
  if (!value) {
    const defaultPreset = inferPermissionPresetValue(
      state.composerApprovalPolicyDefault,
      state.composerSandboxModeDefault
    );
    if (defaultPreset) {
      const preset = getPermissionPresetDefinition(defaultPreset);
      if (preset) {
        return includeDescription
          ? `跟随当前配置（${preset.label} · ${preset.description}）`
          : `跟随当前配置（${preset.label}）`;
      }
    }
    return '跟随当前配置';
  }

  if (value === 'custom') {
    return '自定义组合';
  }

  const preset = getPermissionPresetDefinition(value);
  if (!preset) {
    return value;
  }
  return includeDescription ? `${preset.label} · ${preset.description}` : preset.label;
}

function buildPermissionPresetSelectOptions() {
  return [{
    value: '',
    label: formatPermissionPresetLabel('', { includeDescription: true }),
  }, {
    value: 'read-only',
    label: formatPermissionPresetLabel('read-only', { includeDescription: true }),
  }, {
    value: 'auto',
    label: formatPermissionPresetLabel('auto', { includeDescription: true }),
  }, {
    value: 'full-access',
    label: formatPermissionPresetLabel('full-access', { includeDescription: true }),
  }, {
    value: 'custom',
    label: formatPermissionPresetLabel('custom'),
  }];
}

function applyPermissionPreset(threadId, presetValue) {
  if (!PERMISSION_PRESET_VALUES.has(presetValue)) {
    return null;
  }
  if (presetValue === 'custom') {
    return buildComposerPrefs(threadId);
  }

  if (!presetValue) {
    const prefs = buildComposerPrefs(threadId, {
      approvalPolicy: '',
      sandboxMode: '',
    });
    setComposerPrefsForThread(threadId, prefs);
    return prefs;
  }

  const preset = getPermissionPresetDefinition(presetValue);
  if (!preset) {
    return null;
  }

  const currentPrefs = threadId
    ? (state.composerPrefsByThread.get(threadId) || state.composerGlobalPrefs)
    : state.composerGlobalPrefs;
  const prefs = buildComposerPrefs(threadId, {
    approvalPolicy: preset.approvalPolicy,
    sandboxMode: preset.sandboxMode,
  });
  if (!confirmHighRiskPermissionChange(currentPrefs, prefs)) {
    return null;
  }
  setComposerPrefsForThread(threadId, prefs);
  return prefs;
}

function buildApprovalPolicySelectOptions() {
  const defaultLabel = state.composerApprovalPolicyDefault
    ? `跟随当前配置（${formatApprovalPolicyLabel(state.composerApprovalPolicyDefault)}）`
    : '跟随当前配置';
  return [{
    value: '',
    label: defaultLabel,
  }].concat(APPROVAL_POLICY_OPTIONS.map((value) => ({
    value,
    label: formatApprovalPolicyLabel(value),
  })));
}

function formatSandboxModeLabel(value) {
  if (!value) {
    return '跟随当前配置';
  }
  if (value === 'read-only') {
    return '只读';
  }
  if (value === 'workspace-write') {
    return '工作区可写';
  }
  if (value === 'danger-full-access') {
    return '完全权限（Full Access）';
  }
  return value;
}

function formatMobileComposerSummary(prefs) {
  const parts = [];
  if (prefs?.model) {
    parts.push(prefs.model);
  } else if (state.composerModelDefault) {
    parts.push(state.composerModelDefault);
  } else {
    parts.push('模型默认');
  }

  parts.push(formatReasoningEffortLabel(prefs?.effort || state.composerEffortDefault || ''));
  parts.push(formatPermissionPresetLabel(
    inferPermissionPresetValue(prefs?.approvalPolicy, prefs?.sandboxMode),
    { includeDescription: false }
  ));
  return parts.join(' · ');
}

function buildSandboxModeSelectOptions() {
  const defaultLabel = state.composerSandboxModeDefault
    ? `跟随当前配置（${formatSandboxModeLabel(state.composerSandboxModeDefault)}）`
    : '跟随当前配置';
  return [{
    value: '',
    label: defaultLabel,
  }].concat(SANDBOX_MODE_OPTIONS.map((value) => ({
    value,
    label: formatSandboxModeLabel(value),
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

function getCustomSelectDisplayLabel(selectEl, fallbackLabel = '') {
  const override = typeof selectEl?.dataset?.currentLabel === 'string'
    ? selectEl.dataset.currentLabel.trim()
    : '';
  return override || fallbackLabel;
}

function syncCustomSelect(selectEl) {
  const controller = ensureCustomSelect(selectEl);
  if (!controller) {
    return;
  }

  const { wrapper, trigger, label, menu } = controller;
  const selectedOption = selectEl.options[selectEl.selectedIndex] || selectEl.options[0] || null;
  label.textContent = getCustomSelectDisplayLabel(selectEl, selectedOption?.textContent || '');
  trigger.disabled = selectEl.disabled;
  trigger.title = selectEl.title || '';
  wrapper.classList.toggle('disabled', selectEl.disabled);

  menu.replaceChildren();
  Array.from(selectEl.options).forEach((option) => {
    if (option.value === '' && selectEl.dataset.hideEmptyOption === 'true') {
      return;
    }
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

function getSlashCommandQuery(text) {
  const normalized = typeof text === 'string' ? text : '';
  if (!normalized.startsWith('/')) {
    return null;
  }
  if (/\s/.test(normalized.trim())) {
    return null;
  }
  return normalized.trim().toLowerCase();
}

function normalizeSlashToken(token) {
  const normalized = typeof token === 'string' ? token.trim().toLowerCase() : '';
  if (!normalized) {
    return '';
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function getSlashCommandTokens(command) {
  const tokens = [command?.name, ...(Array.isArray(command?.aliases) ? command.aliases : [])]
    .map(normalizeSlashToken)
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

function getSlashCommandAliasText(command) {
  const aliases = getSlashCommandTokens(command).filter((token) => token !== command.name);
  return aliases.length ? `别名: ${aliases.join(' ')}` : '';
}

function getSlashMatchScore(command, query) {
  const normalizedQuery = normalizeSlashToken(query);
  if (!normalizedQuery) {
    return Number.POSITIVE_INFINITY;
  }

  const tokens = getSlashCommandTokens(command);
  if (!tokens.length) {
    return Number.POSITIVE_INFINITY;
  }
  if (tokens.includes(normalizedQuery)) {
    return 0;
  }
  if (normalizeSlashToken(command.name).startsWith(normalizedQuery)) {
    return 1;
  }
  if (tokens.some((token) => token !== normalizeSlashToken(command.name) && token.startsWith(normalizedQuery))) {
    return 2;
  }
  if (tokens.some((token) => token.includes(normalizedQuery))) {
    return 3;
  }
  return Number.POSITIVE_INFINITY;
}

function getFilteredSlashCommands(query) {
  return SLASH_COMMANDS
    .map((command, index) => ({
      command,
      index,
      score: getSlashMatchScore(command, query),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command);
}

function addThreadNotice(threadId, text, type = '_warning') {
  if (!threadId || !text) {
    return;
  }
  ensureItems(threadId).push({
    type,
    id: createLocalId(type === '_error' ? 'slash-error' : 'slash-warning'),
    text,
  });
}

function clearPermissionPresetPrompts(threadId) {
  if (!threadId) {
    return;
  }
  const items = ensureItems(threadId);
  state.itemsByThread.set(threadId, items.filter((item) => item?.type !== '_permission_prompt'));
}

function ensureComposerControlsVisible() {
  if (window.innerWidth <= 680) {
    composer.classList.add('mobile-controls-open');
    composerControlsToggle.setAttribute('aria-expanded', 'true');
  }
}

function showPermissionPresetPrompt(threadId = state.activeThreadId) {
  if (!threadId) {
    return false;
  }
  clearPermissionPresetPrompts(threadId);
  ensureItems(threadId).push({
    type: '_permission_prompt',
    id: createLocalId('permission-prompt'),
    text: '请选择要应用到当前会话的 /approvals 模式。',
  });
  if (threadId === state.activeThreadId) {
    renderMessages();
  }
  return true;
}

function openAdvancedPermissionSettings(threadId = state.activeThreadId) {
  clearPermissionPresetPrompts(threadId);
  if (!threadId || threadId !== state.activeThreadId) {
    return;
  }
  ensureComposerControlsVisible();
  renderComposer();
  openCustomSelectFor(approvalPolicySelect);
  addThreadNotice(threadId, '已打开高级权限设置，可继续微调执行批准和权限范围。');
  renderMessages();
}

function applyPermissionPresetChoice(threadId, presetValue) {
  const applied = applyPermissionPreset(threadId, presetValue);
  if (!applied) {
    return;
  }
  clearPermissionPresetPrompts(threadId);
  addThreadNotice(threadId, `权限预设已切换为 ${formatPermissionPresetLabel(presetValue, { includeDescription: true })}`);
  if (threadId === state.activeThreadId) {
    renderComposer();
    renderMessages();
  }
}

function closeSlashMenu() {
  slashMenuState.visible = false;
  slashMenuState.query = '';
  slashMenuState.items = [];
  slashMenuState.activeIndex = 0;
  slashMenu.hidden = true;
  slashMenu.replaceChildren();
}

function renderSlashMenu() {
  if (!slashMenuState.visible || !slashMenuState.items.length) {
    closeSlashMenu();
    return;
  }

  slashMenu.hidden = false;
  slashMenu.replaceChildren();
  slashMenuState.items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `slash-item${index === slashMenuState.activeIndex ? ' active' : ''}`;

    const main = document.createElement('div');
    main.className = 'slash-item-main';

    const title = document.createElement('div');
    title.className = 'slash-item-title';
    title.textContent = item.name;
    main.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'slash-item-desc';
    desc.textContent = getSlashCommandAliasText(item)
      ? `${item.description} · ${getSlashCommandAliasText(item)}`
      : item.description;
    main.appendChild(desc);

    const hint = document.createElement('div');
    hint.className = 'slash-item-hint';
    hint.textContent = item.title;

    button.append(main, hint);
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      applySlashCommand(item);
    });
    slashMenu.appendChild(button);
  });
}

function updateSlashMenu() {
  const query = getSlashCommandQuery(promptInput.value);
  if (query === null) {
    closeSlashMenu();
    return;
  }

  const items = getFilteredSlashCommands(query);
  if (!items.length) {
    closeSlashMenu();
    return;
  }

  slashMenuState.visible = true;
  slashMenuState.query = query;
  slashMenuState.items = items;
  if (slashMenuState.activeIndex >= items.length) {
    slashMenuState.activeIndex = 0;
  }
  renderSlashMenu();
}

function openCustomSelectFor(selectEl) {
  const controller = ensureCustomSelect(selectEl);
  if (!controller || selectEl.disabled) {
    return;
  }
  openCustomSelect(controller);
}

function showSlashHelp() {
  slashMenuState.visible = true;
  slashMenuState.query = '/';
  slashMenuState.items = SLASH_COMMANDS.slice();
  slashMenuState.activeIndex = 0;
  renderSlashMenu();
}

function isDecisionServerRequest(request) {
  if (!request?.kind) {
    return false;
  }
  return request.kind === 'permissions_approval'
    || request.kind === 'command_approval'
    || request.kind === 'command_approval_legacy'
    || request.kind === 'file_change_approval'
    || request.kind === 'file_change_approval_legacy';
}

function getPendingDecisionServerRequestsForActiveThread() {
  const threadId = state.activeThreadId;
  if (!threadId) {
    return [];
  }
  return getServerRequestsForThread(threadId)
    .filter((entry) => normalizeServerRequestStatus(entry.status) === 'pending' && isDecisionServerRequest(entry));
}

function getLatestPendingServerRequestForActiveThread() {
  const requests = getPendingDecisionServerRequestsForActiveThread();
  return requests[requests.length - 1] || null;
}

function openSidebarPanel() {
  sidebar.classList.remove('hidden');
  mainArea.classList.remove('full');
}

function showPendingApprovals() {
  const threadId = state.activeThreadId;
  if (!threadId) {
    return false;
  }
  const requests = getPendingDecisionServerRequestsForActiveThread();
  if (!requests.length) {
    addThreadNotice(threadId, '当前会话没有待处理的批准请求。');
    render();
    return false;
  }
  closeSlashMenu();
  renderMessages();
  const latest = requests[requests.length - 1];
  window.requestAnimationFrame(() => {
    focusServerRequestCard(latest.requestId);
  });
  return true;
}

function buildServerRequestDecision(request, mode) {
  if (!request) {
    return null;
  }

  if (request.kind === 'permissions_approval') {
    if (mode === 'deny') {
      return {
        permissions: {},
        scope: 'turn',
      };
    }
    return {
      permissions: request.permissions || {},
      scope: mode === 'session' ? 'session' : 'turn',
    };
  }

  const legacy = request.kind.startsWith('file_change_approval_legacy') || request.kind.startsWith('command_approval_legacy');
  if (mode === 'deny') {
    return {
      decision: legacy ? 'denied' : 'decline',
    };
  }
  if (mode === 'session') {
    return {
      decision: legacy ? 'approved_for_session' : 'acceptForSession',
    };
  }
  return {
    decision: legacy ? 'approved' : 'accept',
  };
}

function submitLatestPendingServerRequest(mode) {
  const request = getLatestPendingServerRequestForActiveThread();
  if (!request) {
    if (state.activeThreadId) {
      addThreadNotice(state.activeThreadId, '当前会话没有待处理的批准请求。');
      render();
    }
    return false;
  }

  const response = buildServerRequestDecision(request, mode);
  if (!response) {
    return false;
  }
  closeSlashMenu();
  submitServerRequestResponse(request, response);
  return true;
}

function executeSlashCommand(command) {
  if (!command) {
    return false;
  }

  if (command.action === 'new_session') {
    closeSlashMenu();
    void startNewSessionFlow();
    return true;
  }
  if (command.action === 'open_workspace_picker') {
    closeSlashMenu();
    void startNewSessionFlow({ focusField: 'workspace' });
    return true;
  }
  if (command.action === 'open_sessions') {
    closeSlashMenu();
    openSidebarPanel();
    return true;
  }
  if (command.action === 'close_session') {
    closeSlashMenu();
    if (!state.activeThreadId) {
      return false;
    }
    return send({ type: 'tab_close', threadId: state.activeThreadId });
  }
  if (command.action === 'refresh_session') {
    closeSlashMenu();
    if (!state.activeThreadId) {
      return false;
    }
    if (!send({ type: 'thread_sync', threadId: state.activeThreadId })) {
      reconnectNow();
      addThreadNotice(state.activeThreadId, '连接未就绪，已尝试重新连接并稍后自动同步。');
      render();
    }
    return true;
  }
  if (command.action === 'reconnect_socket') {
    closeSlashMenu();
    reconnectNow();
    return true;
  }
  if (command.action === 'show_permission_settings') {
    closeSlashMenu();
    return showPermissionPresetPrompt();
  }
  if (command.action === 'open_sandbox') {
    closeSlashMenu();
    openCustomSelectFor(sandboxModeSelect);
    return true;
  }
  if (command.action === 'show_approvals') {
    return showPendingApprovals();
  }
  if (command.action === 'show_status') {
    closeSlashMenu();
    if (!state.activeThreadId) {
      return false;
    }
    const tab = state.tabs.find((entry) => entry.threadId === state.activeThreadId) || null;
    const composerSelection = getEffectiveComposerSelection(state.activeThreadId);
    const connected = window._ws?.readyState === WebSocket.OPEN ? '已连接' : '未连接';
    const status = [
      `连接: ${connected}`,
      `会话: ${getSessionName(tab)}`,
      `工作区: ${getWorkspacePath(tab) || '未提供'}`,
      `模型: ${composerSelection.model || '默认'}`,
      `思考等级: ${formatReasoningEffortLabel(composerSelection.effort || '')}`,
      `权限预设: ${formatPermissionPresetLabel(inferPermissionPresetValue(composerSelection.approvalPolicy, composerSelection.sandboxMode))}`,
      `执行批准: ${formatApprovalPolicyLabel(composerSelection.approvalPolicy || '')}`,
      `权限范围: ${formatSandboxModeLabel(composerSelection.sandboxMode || '')}`,
    ].join(' · ');
    addThreadNotice(state.activeThreadId, status);
    render();
    return true;
  }
  if (command.action === 'open_model') {
    closeSlashMenu();
    openCustomSelectFor(modelSelect);
    return true;
  }
  if (command.action === 'open_effort') {
    closeSlashMenu();
    openCustomSelectFor(reasoningEffortSelect);
    return true;
  }
  if (command.action === 'open_theme') {
    closeSlashMenu();
    openCustomSelectFor(themeSelect);
    return true;
  }
  if (command.action === 'approve_latest') {
    return submitLatestPendingServerRequest('turn');
  }
  if (command.action === 'approve_latest_for_session') {
    return submitLatestPendingServerRequest('session');
  }
  if (command.action === 'deny_latest') {
    return submitLatestPendingServerRequest('deny');
  }
  if (command.action === 'open_token') {
    closeSlashMenu();
    void promptForWebSocketToken({
      title: '设置 WebSocket Token',
      label: '访问 Token',
      placeholder: '请输入服务端配置的 WS_TOKEN',
      confirmText: '保存并重连',
      inputType: 'password',
    });
    return true;
  }
  if (command.action === 'clear_input') {
    promptInput.value = '';
    closeSlashMenu();
    renderComposer();
    promptInput.focus();
    return true;
  }
  if (command.action === 'show_help') {
    showSlashHelp();
    promptInput.focus();
    return true;
  }
  return false;
}

function canExecuteSlashCommandAfterSend(command) {
  const action = command?.action || '';
  return action === 'open_workspace_picker'
    || action === 'open_sessions'
    || action === 'refresh_session'
    || action === 'reconnect_socket'
    || action === 'show_permission_settings'
    || action === 'open_sandbox'
    || action === 'show_approvals'
    || action === 'show_status'
    || action === 'open_model'
    || action === 'open_effort'
    || action === 'open_theme'
    || action === 'open_token'
    || action === 'show_help';
}

function buildComposerMessageContent(text, attachments) {
  const content = [];
  if (text) {
    content.push({ type: 'text', text });
  }
  for (const attachment of attachments) {
    content.push({
      type: 'localImage',
      path: attachment.path,
      name: attachment.name || getAttachmentFileName(attachment.path),
      previewUrl: attachment.previewUrl || buildUploadPreviewUrl(attachment.path),
    });
  }
  return content;
}

function submitTurnMessage(threadId, text, attachments, options = {}) {
  if (!threadId || (!text && !attachments.length) || getComposerUploadCount() > 0) {
    return false;
  }

  clearTransientConnectionNotices(threadId);
  const clientMessageId = createLocalId('turn');
  const localMessageId = createLocalId('local');
  const content = buildComposerMessageContent(text, attachments);
  const items = ensureItems(threadId);
  items.push({
    type: 'userMessage',
    id: localMessageId,
    content,
    createdAt: Date.now(),
  });
  registerPendingUserMessage(clientMessageId, threadId, localMessageId, content);

  const composerSelection = getEffectiveComposerSelection(threadId);
  state.turnActiveByThread.set(threadId, true);
  if (!send({
    type: 'turn_send',
    threadId,
    text,
    attachments: attachments.map((attachment) => ({
      path: attachment.path,
      name: attachment.name || getAttachmentFileName(attachment.path),
    })),
    clientMessageId,
    model: composerSelection.model || '',
    effort: composerSelection.effort || '',
    approvalPolicy: composerSelection.approvalPolicy || '',
    sandboxMode: composerSelection.sandboxMode || '',
  })) {
    rollbackPendingUserMessage(clientMessageId);
    state.turnActiveByThread.set(threadId, false);
    promptInput.value = text;
    setComposerAttachments(threadId, attachments);
    ensureItems(threadId).push({
      type: '_error',
      id: createLocalId('send'),
      text: '消息发送失败：WebSocket 未连接，请稍后重试。',
      _localNoticeCode: 'send_disconnected',
    });
    autoResizePromptInput();
    render();
    return false;
  }

  promptInput.value = '';
  clearComposerAttachments(threadId);
  autoResizePromptInput();
  closeSlashMenu();
  render();

  if (typeof options.afterSend === 'function') {
    window.setTimeout(() => {
      options.afterSend();
    }, 0);
  }

  return true;
}

function getExactSlashCommand(text) {
  const normalized = normalizeSlashToken(text);
  return SLASH_COMMANDS.find((command) => getSlashCommandTokens(command).includes(normalized)) || null;
}

function applySlashCommand(command) {
  if (!command) {
    return;
  }
  promptInput.value = command.name;
  closeSlashMenu();
  promptInput.focus();
  executeSlashCommand(command);
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
  const approvalPolicy = normalizeComposerApprovalPolicy(prefs?.approvalPolicy);
  const sandboxMode = normalizeComposerSandboxMode(prefs?.sandboxMode);
  return { model, effort, approvalPolicy, sandboxMode };
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
    state.composerApprovalPolicyDefault = normalizeComposerApprovalPolicy(result.defaults?.approvalPolicy);
    state.composerSandboxModeDefault = normalizeComposerSandboxMode(result.defaults?.sandboxMode);
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

function isTransientConnectionNotice(item) {
  return !!item
    && (item.type === '_error' || item.type === '_warning')
    && (item._localNoticeCode === 'send_disconnected' || item._localNoticeCode === 'ws_reconnecting');
}

function clearTransientConnectionNotices(threadId = null) {
  let changed = false;
  const targets = threadId
    ? [[threadId, state.itemsByThread.get(threadId) || []]]
    : Array.from(state.itemsByThread.entries());

  for (const [targetThreadId, items] of targets) {
    if (!Array.isArray(items) || !items.length) {
      continue;
    }
    const filtered = items.filter((item) => !isTransientConnectionNotice(item));
    if (filtered.length !== items.length) {
      state.itemsByThread.set(targetThreadId, filtered);
      changed = true;
    }
  }

  return changed;
}

function ensurePartials(threadId) {
  if (!state.partialByThread.has(threadId)) {
    state.partialByThread.set(threadId, new Map());
  }
  return state.partialByThread.get(threadId);
}

function registerPendingUserMessage(clientMessageId, threadId, itemId, content) {
  if (!clientMessageId) {
    return;
  }
  state.pendingUserMessages.set(clientMessageId, {
    threadId,
    itemId,
    fingerprint: createUserMessageFingerprint(Array.isArray(content) ? content : []),
    content: Array.isArray(content) ? content.map((entry) => ({ ...entry })) : [],
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
    return null;
  }
  state.pendingUserMessages.delete(clientMessageId);
  removeItemById(pending.threadId, pending.itemId);
  return pending;
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

  return normalizeUserMessageContent(item)
    .filter((entry) => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
    .trim();
}

function reconcilePendingUserMessage(threadId, item) {
  const fingerprint = createUserMessageFingerprint(normalizeUserMessageContent(item));
  if (!fingerprint || fingerprint === '[]') {
    return false;
  }

  for (const [clientMessageId, pending] of state.pendingUserMessages.entries()) {
    if (pending.threadId !== threadId || pending.fingerprint !== fingerprint) {
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

function mergeCompletedItem(existingItem, nextItem) {
  if (!existingItem || !nextItem || typeof existingItem !== 'object' || typeof nextItem !== 'object') {
    return nextItem;
  }

  const merged = { ...existingItem, ...nextItem };

  if (nextItem.type === 'fileChange') {
    const nextPatch = String(nextItem.patch || '').trim();
    if (!nextPatch) {
      const existingPatch = String(existingItem.patch || existingItem.aggregatedPatch || '').trim();
      if (existingPatch) {
        merged.patch = existingPatch;
      }
    }

    if (!Array.isArray(nextItem.changes) || !nextItem.changes.length) {
      if (Array.isArray(existingItem.changes) && existingItem.changes.length) {
        merged.changes = existingItem.changes;
      }
    }

    const nextOutput = String(nextItem.output || nextItem.aggregatedOutput || '').trim();
    if (!nextOutput) {
      const existingOutput = String(existingItem.output || existingItem.aggregatedOutput || '').trim();
      if (existingOutput) {
        merged.output = existingOutput;
      }
    }
  }

  return merged;
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

function extractItemTimestampMs(item) {
  return normalizeTimestampMs(item?.createdAt)
    || normalizeTimestampMs(item?.startedAt)
    || normalizeTimestampMs(item?.completedAt)
    || normalizeTimestampMs(item?.updatedAt)
    || normalizeTimestampMs(item?._localCreatedAt)
    || null;
}

function formatEntryTimestamp(timestampMs) {
  const normalized = normalizeTimestampMs(timestampMs);
  if (!normalized) {
    return '';
  }
  const date = new Date(normalized);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function createTimestampNode(timestampMs, extraClass = '') {
  const label = formatEntryTimestamp(timestampMs);
  if (!label) {
    return null;
  }
  const node = document.createElement('div');
  node.className = extraClass ? `entry-timestamp ${extraClass}` : 'entry-timestamp';
  node.textContent = label;
  node.title = new Date(normalizeTimestampMs(timestampMs)).toLocaleString();
  return node;
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

function setThreadTokenUsage(threadId, usage) {
  if (!threadId) {
    return false;
  }
  if (!usage || typeof usage !== 'object') {
    const hadValue = state.tokenUsageByThread.delete(threadId);
    return hadValue;
  }
  state.tokenUsageByThread.set(threadId, usage);
  return true;
}

function ensureItemRenderVersion(item) {
  if (!item || typeof item !== 'object') {
    return 0;
  }
  if (!Number.isFinite(item._renderVersion) || item._renderVersion <= 0) {
    item._renderVersion = 1;
  }
  return item._renderVersion;
}

function bumpItemRenderVersion(item) {
  if (!item || typeof item !== 'object') {
    return 0;
  }
  item._renderVersion = ensureItemRenderVersion(item) + 1;
  return item._renderVersion;
}

function scheduleRender(options = {}) {
  if (options.header) {
    scheduledRenderHeader = true;
  }
  if (options.messages) {
    scheduledRenderMessages = true;
  }
  if (scheduledRenderFrame) {
    return;
  }
  scheduledRenderFrame = window.requestAnimationFrame(() => {
    scheduledRenderFrame = 0;
    const shouldRenderHeader = scheduledRenderHeader;
    const shouldRenderMessages = scheduledRenderMessages;
    scheduledRenderHeader = false;
    scheduledRenderMessages = false;
    if (shouldRenderHeader) {
      renderHeader();
    }
    if (shouldRenderMessages) {
      renderMessages();
    }
  });
}

function autoResizePromptInput() {
  promptInput.style.height = '0px';
  const nextHeight = Math.min(promptInput.scrollHeight, 162);
  promptInput.style.height = `${Math.max(45, nextHeight)}px`;
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
      _renderVersion: 1,
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
  bumpItemRenderVersion(item);
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

function stringifyFileChangeKind(kind) {
  if (typeof kind === 'string') {
    return kind;
  }
  if (kind && typeof kind === 'object' && typeof kind.type === 'string') {
    return kind.type;
  }
  return '';
}

function getFileChangePatch(item) {
  const directPatch = String(item?.patch || item?.aggregatedPatch || '').trim();
  if (directPatch) {
    return directPatch;
  }

  const diffs = Array.isArray(item?.changes)
    ? item.changes
      .map((change) => {
        const path = String(change?.path || '').trim();
        const diff = String(change?.diff || '').trim();
        if (!path || !diff) {
          return '';
        }
        const kind = getNormalizedFileChangeKind(stringifyFileChangeKind(change.kind));
        if (kind === 'add') {
          return `*** Add File: ${path}\n${diff}`;
        }
        if (kind === 'delete') {
          return `*** Delete File: ${path}\n${diff}`;
        }
        return `*** Update File: ${path}\n${diff}`;
      })
      .filter(Boolean)
    : [];

  return diffs.join('\n').trim();
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
      kind: stringifyFileChangeKind(change?.kind || change?.type || ''),
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

function hasUnreadInInactiveTabs() {
  for (const threadId of state.unreadThreadIds) {
    if (threadId && threadId !== state.activeThreadId) {
      return true;
    }
  }
  return false;
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

function syncComposerPrefsFromTab(tab) {
  if (!tab?.threadId) {
    return;
  }
  const current = state.composerPrefsByThread.get(tab.threadId) || state.composerGlobalPrefs;
  const hasApprovalPolicy = Object.prototype.hasOwnProperty.call(tab, 'approvalPolicy');
  const hasSandboxMode = Object.prototype.hasOwnProperty.call(tab, 'sandboxMode');
  state.composerPrefsByThread.set(tab.threadId, {
    model: normalizeComposerModel(current?.model),
    effort: normalizeComposerEffort(current?.effort),
    approvalPolicy: hasApprovalPolicy
      ? normalizeComposerApprovalPolicy(tab.approvalPolicy)
      : normalizeComposerApprovalPolicy(current?.approvalPolicy),
    sandboxMode: hasSandboxMode
      ? normalizeComposerSandboxMode(tab.sandboxMode)
      : normalizeComposerSandboxMode(current?.sandboxMode),
  });
}

function upsertTab(tab) {
  syncComposerPrefsFromTab(tab);
  const index = state.tabs.findIndex((entry) => entry.threadId === tab.threadId);
  if (index >= 0) {
    state.tabs[index] = tab;
  } else {
    state.tabs.push(tab);
  }

  state.tabs.sort(compareTabs);
}

function clearActiveTabIfMatches(threadId) {
  if (state.activeThreadId !== threadId) {
    return false;
  }
  state.activeThreadId = null;
  return true;
}

function removeTab(threadId) {
  state.tabs = state.tabs.filter((tab) => tab.threadId !== threadId);
  state.itemsByThread.delete(threadId);
  state.partialByThread.delete(threadId);
  state.turnActiveByThread.delete(threadId);
  state.currentTurnIdByThread.delete(threadId);
  state.tokenUsageByThread.delete(threadId);
  state.composerAttachmentsByThread.delete(threadId);
  state.composerUploadsInFlightByThread.delete(threadId);
  state.composerPrefsByThread.delete(threadId);
  state.serverRequests = state.serverRequests.filter((entry) => entry.threadId !== threadId);
  removePendingUserMessagesForThread(threadId);
  state.unreadThreadIds.delete(threadId);
  forgetThread(threadId);

  clearActiveTabIfMatches(threadId);

  render();
}

function markTabClosedLocally(threadId) {
  removeTab(threadId);
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
      name: '未命名会话',
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
      _localNoticeCode: 'ws_reconnecting',
    });
  }
  render();
}

function getDefaultWorkspacePath(shortcuts) {
  return shortcuts?.lastUsedPath || shortcuts?.projectRoot || shortcuts?.desktopPath || '';
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
    const key = item?.type === 'userMessage'
      ? `${item.type}:${item.id || ''}:${item._turnId || ''}:${createUserMessageFingerprint(normalizeUserMessageContent(item))}`
      : `${item.type}:${item.id || ''}:${item._turnId || ''}:${item.text || ''}`;
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
    bumpItemRenderVersion(existing);
    return;
  }

  existing = {
    type: 'agentMessage',
    id: itemId,
    text: partials.get(itemId),
    startedAt: Date.now(),
    _partial: true,
    _turnId: turnId || null,
    _renderVersion: 1,
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
    const previousVersion = ensureItemRenderVersion(items[index]);
    items[index] = {
      ...mergeCompletedItem(items[index], nextItem),
      _partial: false,
      _renderVersion: previousVersion + 1,
    };
    return;
  }

  items.push({ ...nextItem, _partial: false, _renderVersion: 1 });
}

function renderTabs() {
  renderTabsView(tabList, menuBtn, tabTpl, state, {
    hasUnreadInInactiveTabs,
    hasPendingServerRequest,
    normalizeTabStatus,
    setActiveTab,
    send,
  });
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
  renderContextUsage(contextUsage, state);
  tokenBtn.textContent = state.authFailed ? '设置 Token' : 'Token';
  tokenBtn.classList.toggle('btn-alert', state.authFailed);
  renderHeaderStatus(activeStatus, tab, state, {
    hasPendingServerRequest,
    normalizeTabStatus,
  });
}

function renderComposer() {
  renderComposerView(state, {
    composer,
    composerControlsToggle,
    composerControlsSummary,
    promptInput,
    attachImageBtn,
    composerSubmitBtn,
    modelSelect,
    reasoningEffortSelect,
    permissionPresetSelect,
    approvalPolicySelect,
    sandboxModeSelect,
    fillSelectOptions,
    syncCustomSelect,
    autoResizePromptInput,
    getComposerAttachments,
    getComposerUploadCount,
    getActiveComposerPrefs,
    normalizeComposerModel,
    normalizeComposerEffort,
    normalizeComposerApprovalPolicy,
    normalizeComposerSandboxMode,
    formatMobileComposerSummary,
    buildModelSelectOptions,
    buildEffortSelectOptions,
    buildPermissionPresetSelectOptions,
    buildApprovalPolicySelectOptions,
    buildSandboxModeSelectOptions,
    inferPermissionPresetValue,
    formatPermissionPresetLabel,
    formatApprovalPolicyLabel,
    formatSandboxModeLabel,
    formatReasoningEffortLabel,
    renderComposerAttachmentList,
    defaultPromptPlaceholder: DEFAULT_PROMPT_PLACEHOLDER,
  });
}

function renderComposerAttachmentList(attachments = getComposerAttachments()) {
  renderComposerAttachmentListView(attachments, {
    composerAttachmentList,
    state,
    buildUploadPreviewUrl,
    getAttachmentFileName,
    setComposerAttachments,
    getComposerAttachments,
    renderComposer,
  });
}

function renderCreatingOverlay() {
  sessionCreatingOverlay.classList.toggle('visible', state.creatingTab);
  sessionCreatingOverlay.setAttribute('aria-hidden', state.creatingTab ? 'false' : 'true');
}

async function uploadComposerImageFiles(fileList) {
  const threadId = state.activeThreadId;
  if (!threadId) {
    return;
  }

  const files = Array.from(fileList || []).filter((file) => file && String(file.type || '').startsWith('image/'));
  if (!files.length) {
    return;
  }

  setComposerUploadCount(threadId, getComposerUploadCount(threadId) + files.length);
  renderComposer();

  const uploaded = [];
  try {
    for (const file of files) {
      const result = await apiFetchJson('/api/uploads/image', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-upload-filename': encodeURIComponent(file.name || 'image'),
        },
        body: await file.arrayBuffer(),
      });
      uploaded.push({
        type: 'localImage',
        path: result.filePath,
        name: result.name || file.name || getAttachmentFileName(result.filePath),
        previewUrl: result.url ? withAuthTokenQuery(result.url) : buildUploadPreviewUrl(result.filePath),
      });
      setComposerUploadCount(threadId, Math.max(0, getComposerUploadCount(threadId) - 1));
      renderComposer();
    }
  } catch (error) {
    if (uploaded.length) {
      setComposerAttachments(threadId, getComposerAttachments(threadId).concat(uploaded));
    }
    setComposerUploadCount(threadId, 0);
    addThreadNotice(threadId, `图片上传失败：${error.message || '请稍后重试。'}`, '_error');
    render();
    return;
  }

  if (uploaded.length) {
    setComposerAttachments(threadId, getComposerAttachments(threadId).concat(uploaded));
  }
  renderComposer();
}

function render() {
  renderTabs();
  renderHeader();
  renderNewTabButton();
  renderComposer();
  renderMessages();
  renderCreatingOverlay();
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

const socketController = createSocketController({
  state,
  modalState,
  render,
  renderMessages,
  clearTransientConnectionNotices,
  loadComposerOptions,
  openTextModal,
  handleMessage: (msg) => handleMessage(msg),
});

const {
  browseWorkspacePath,
  closeSessionModal,
  createWorkspaceOnHost,
  renderSessionModal,
  setSessionModalHint,
  startNewSessionFlow,
  updateSessionWorkspacePath,
} = createSessionModalController({
  state,
  sessionModalState,
  elements: {
    sidebar,
    mainArea,
    sessionModal,
    sessionNameInput,
    sessionWorkspaceInput,
    browseWorkspaceBtn,
    workspaceUpBtn,
    workspaceRefreshBtn,
    createWorkspaceBtn,
    useCurrentWorkspaceBtn,
    workspaceShortcutList,
    workspaceBrowserPath,
    workspaceBrowserList,
    sessionModalHint,
    sessionModalCancelBtn,
    sessionModalConfirmBtn,
  },
  apiFetchJson,
  render,
  send: (payload) => socketController.send(payload),
  openTextModal,
  getDefaultWorkspacePath,
  getActiveComposerPrefs,
  normalizeComposerModel,
  normalizeComposerApprovalPolicy,
  normalizeComposerSandboxMode,
});

const {
  getWebSocketToken,
  promptForWebSocketToken,
  reconnectNow,
  send,
  withAuthTokenQuery,
  markAuthFailed,
} = socketController;

const {
  basenamePath,
  buildMessageEntries,
  compactText,
  createThinkingEntry,
  formatAgentPhaseLabel,
  hasLiveEntryActivity,
} = createMessageEntryBuilder({
  state,
  ensureItems,
  getServerRequestsForThread,
  createLocalId,
  normalizeUserMessageContent,
  extractItemTimestampMs,
  createUserMessageFingerprint,
  ensureItemRenderVersion,
  getReasoningText,
  findPendingRequestForItem,
  getCommandOutput,
  isItemInActiveTurn,
  getFileChangeOutput,
  getFileChangePatch,
  normalizeFileChanges,
  getEffectiveComposerSelection,
  inferPermissionPresetValue,
  normalizeTimestampMs,
});

const messageRenderer = createMessageRenderer({
  state,
  messagesEl,
  jumpToBottomBtn,
  emptyThreadKey: EMPTY_THREAD_KEY,
  buildMessageEntries,
  createThinkingEntry,
  hasLiveEntryActivity,
  compactText,
  basenamePath,
  formatAgentPhaseLabel,
  renderMarkdown,
  createTimestampNode,
  getTurnWorkingLabel,
  getNormalizedFileChangeKind,
  normalizeFileChanges,
  summarizeFileChanges,
  formatPermissionPresetLabel,
  applyPermissionPresetChoice,
  openAdvancedPermissionSettings,
  send,
  upsertServerRequest,
  ensureItems,
  createLocalId,
  buildUploadPreviewUrl,
  getAttachmentFileName,
  render,
});

const {
  focusServerRequestCard,
  forgetThread,
  refreshLiveWorkingLabels,
  renderMessages,
  submitServerRequestResponse,
} = messageRenderer;

const handleMessage = createMessageHandler({
  state,
  promptInput,
  render,
  renderTabs,
  renderHeader,
  renderMessages,
  autoResizePromptInput,
  send,
  markAuthFailed,
  scheduleRender,
  ensureItems,
  upsertTab,
  removeTab,
  upsertServerRequest,
  removeServerRequest,
  markThreadUnread,
  pruneUnreadThreads,
  setActiveTab,
  setThreadTokenUsage,
  syncTurns,
  rememberTurnStartedAt,
  clearTurnStartedAt,
  assignPendingUserMessageToTurn,
  upsertStreamingItem,
  cloneItemForTurn,
  reconcilePendingUserMessage,
  finalizeItem,
  upsertLiveItem,
  appendReasoningSummaryText,
  appendReasoningSummaryPart,
  appendReasoningContentText,
  rollbackPendingUserMessage,
  setComposerAttachments,
  currentTurnIdByThread: state.currentTurnIdByThread,
  getComposerUploadCount,
  createLocalId,
  markTabClosedLocally,
  getComposerAttachments,
});

socketController.connect();
void loadComposerOptions({ render: false });

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

newTabBtn.addEventListener('click', () => {
  void startNewSessionFlow();
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

sessionModalTopCloseBtn.addEventListener('click', () => {
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

composerControlsToggle.addEventListener('click', () => {
  const nextOpen = !composer.classList.contains('mobile-controls-open');
  composer.classList.toggle('mobile-controls-open', nextOpen);
  composerControlsToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
});

promptInput.addEventListener('keydown', (event) => {
  if (slashMenuState.visible && slashMenuState.items.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      slashMenuState.activeIndex = (slashMenuState.activeIndex + 1) % slashMenuState.items.length;
      renderSlashMenu();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      slashMenuState.activeIndex = (slashMenuState.activeIndex - 1 + slashMenuState.items.length) % slashMenuState.items.length;
      renderSlashMenu();
      return;
    }
    if ((event.key === 'Enter' && !event.shiftKey && !event.isComposing) || event.key === 'Tab') {
      event.preventDefault();
      applySlashCommand(slashMenuState.items[slashMenuState.activeIndex]);
      return;
    }
    if (event.key === 'Escape') {
      closeSlashMenu();
      return;
    }
  }

  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  composer.requestSubmit();
});

promptInput.addEventListener('input', () => {
  autoResizePromptInput();
  updateSlashMenu();
  renderComposer();
});

promptInput.addEventListener('focus', () => {
  autoResizePromptInput();
  updateSlashMenu();
});

attachImageBtn.addEventListener('click', () => {
  if (attachImageBtn.disabled) {
    return;
  }
  imageInput.click();
});

imageInput.addEventListener('change', () => {
  const selected = imageInput.files;
  imageInput.value = '';
  if (!selected?.length) {
    return;
  }
  void uploadComposerImageFiles(selected);
});

promptInput.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
  if (!files.length) {
    return;
  }
  void uploadComposerImageFiles(files);
});

modelSelect.addEventListener('change', () => {
  setComposerPrefsFromInputs();
  renderComposer();
});

reasoningEffortSelect.addEventListener('change', () => {
  setComposerPrefsFromInputs();
  renderComposer();
});

permissionPresetSelect.addEventListener('change', () => {
  applyPermissionPreset(state.activeThreadId, permissionPresetSelect.value);
  renderComposer();
});

approvalPolicySelect.addEventListener('change', () => {
  setComposerPrefsFromInputs();
  renderComposer();
});

sandboxModeSelect.addEventListener('change', () => {
  setComposerPrefsFromInputs();
  renderComposer();
});

themeSelect.addEventListener('change', () => {
  saveThemePreference(themeSelect.value);
  renderHeader();
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  const attachments = getComposerAttachments();
  if (!text && !attachments.length) {
    return;
  }

  const slashCommand = attachments.length ? null : getExactSlashCommand(text);
  if (slashCommand) {
    if (canExecuteSlashCommandAfterSend(slashCommand) && state.activeThreadId && getComposerUploadCount() === 0) {
      submitTurnMessage(state.activeThreadId, text, attachments, {
        afterSend: () => {
          executeSlashCommand(slashCommand);
        },
      });
      return;
    }
    executeSlashCommand(slashCommand);
    return;
  }

  if (!state.activeThreadId || getComposerUploadCount() > 0) {
    return;
  }

  submitTurnMessage(state.activeThreadId, text, attachments);
});
window.setInterval(() => {
  if (state.creatingTab || Array.from(state.turnActiveByThread.values()).some(Boolean)) {
    renderHeader();
    refreshLiveWorkingLabels();
  }
}, 1000);
