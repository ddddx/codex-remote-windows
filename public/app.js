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
import {
  buildComposerMessageContent,
  createBuildUploadPreviewUrl,
  createUserMessageFingerprint,
  getAttachmentFileName,
  normalizeUserMessageContent,
  renderMarkdown,
} from './messageContent.js';
import { createApiFetchJson } from './apiClient.js';
import { createSocketController } from './socket.js';
import { createSessionModalController } from './sessionModal.js';
import { createMessageHandler } from './messageHandlers.js';
import { createMessageEntryBuilder } from './messageEntries.js';
import { createMessageRenderer } from './messageRenderer.js';
import { createSlashController } from './slashController.js';
import { createTextModalController } from './textModal.js';
import { createThreadStore } from './threadStore.js';
import { createUploadController } from './uploadController.js';
import { createComposerSettingsController } from './composerSettings.js';

const EMPTY_THREAD_KEY = '__empty__';
const DEFAULT_PROMPT_PLACEHOLDER = '给当前会话发送指令...';
const COMPOSER_PREFS_STORAGE_KEY = 'codex-remote-composer-prefs';
const THEME_STORAGE_KEY = 'codex-remote-theme';

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
let scheduledRenderFrame = 0;
let scheduledRenderHeader = false;
let scheduledRenderMessages = false;

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) {
    composerSettings.closeActiveCustomSelect();
    closeContextUsagePopover(contextUsage);
    return;
  }
  if (contextUsage && !contextUsage.contains(target)) {
    closeContextUsagePopover(contextUsage);
  }
  composerSettings.handleDocumentClick?.(target);
  slashController.handleDocumentClick(target);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    composerSettings.closeActiveCustomSelect();
  }
});

window.addEventListener('resize', () => {
  composerSettings.positionCustomSelectMenu();
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

function submitTurnMessage(threadId, text, attachments, options = {}) {
  if (!threadId || (!text && !attachments.length) || getComposerUploadCount() > 0) {
    return false;
  }

  clearTransientConnectionNotices(threadId);
  const clientMessageId = createLocalId('turn');
  const localMessageId = createLocalId('local');
  const content = buildComposerMessageContent(text, attachments, { buildUploadPreviewUrl });
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

function getEffectiveComposerSelection(threadId = state.activeThreadId) {
  const prefs = threadId ? (state.composerPrefsByThread.get(threadId) || state.composerGlobalPrefs) : state.composerGlobalPrefs;
  const model = normalizeComposerModel(prefs?.model) || state.composerModelDefault || '';
  const effort = normalizeComposerEffort(prefs?.effort) || state.composerEffortDefault || '';
  const approvalPolicy = normalizeComposerApprovalPolicy(prefs?.approvalPolicy);
  const sandboxMode = normalizeComposerSandboxMode(prefs?.sandboxMode);
  return { model, effort, approvalPolicy, sandboxMode };
}

let composerOptionsRequestSerial = 0;

async function loadComposerOptions(options = {}) {
  const activeTab = state.tabs.find((entry) => entry.threadId === state.activeThreadId);
  const activeCwd = activeTab?.cwd || '';
  const requestId = ++composerOptionsRequestSerial;
  state.composerOptionsLoading = true;
  if (options.render !== false) {
    renderComposer();
  }

  try {
    const url = new URL('/api/codex/options', window.location.origin);
    if (activeTab?.cwd) {
      url.searchParams.set('cwd', activeTab.cwd);
    }
    const result = await apiFetchJson(url);
    if (requestId !== composerOptionsRequestSerial) {
      return;
    }
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
    if (requestId !== composerOptionsRequestSerial) {
      return;
    }
    console.error('failed loading codex options', error);
  } finally {
    if (requestId === composerOptionsRequestSerial) {
      state.composerOptionsLoading = false;
      renderComposer();
    }
  }
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
function getDefaultWorkspacePath(shortcuts) {
  return shortcuts?.lastUsedPath || shortcuts?.projectRoot || shortcuts?.desktopPath || '';
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

function render() {
  renderTabs();
  renderHeader();
  renderNewTabButton();
  renderComposer();
  renderMessages();
  renderCreatingOverlay();
}

const textModalController = createTextModalController({
  textModal,
  modalTitle,
  modalLabel,
  modalInput,
  modalConfirmBtn,
});

const {
  closeTextModal,
  handleBackdropClick: handleTextModalBackdropClick,
  handleEscapeKey: handleTextModalEscapeKey,
  handleFormSubmit: handleTextModalFormSubmit,
  isOpen: isTextModalOpen,
  openTextModal,
} = textModalController;

const composerSettings = createComposerSettingsController({
  state,
  composer,
  composerControlsToggle,
  modelSelect,
  reasoningEffortSelect,
  permissionPresetSelect,
  approvalPolicySelect,
  sandboxModeSelect,
  themeSelect,
  composerPrefsStorageKey: COMPOSER_PREFS_STORAGE_KEY,
  themeStorageKey: THEME_STORAGE_KEY,
});

composerSettings.initialize();

const {
  applyPermissionPreset,
  buildApprovalPolicySelectOptions,
  buildEffortSelectOptions,
  buildModelSelectOptions,
  buildPermissionPresetSelectOptions,
  buildSandboxModeSelectOptions,
  fillSelectOptions,
  formatApprovalPolicyLabel,
  formatMobileComposerSummary,
  formatPermissionPresetLabel,
  formatReasoningEffortLabel,
  formatSandboxModeLabel,
  getActiveComposerPrefs,
  inferPermissionPresetValue,
  normalizeComposerApprovalPolicy,
  normalizeComposerEffort,
  normalizeComposerModel,
  normalizeComposerSandboxMode,
  openCustomSelectFor,
  saveThemePreference,
  setComposerPrefsFromInputs,
  syncCustomSelect,
  themeOptions: THEME_OPTIONS,
} = composerSettings;

const normalizeMessageContent = (item) => normalizeUserMessageContent(item, { buildUploadPreviewUrl });

const threadStore = createThreadStore({
  state,
  compareTabs,
  normalizeComposerModel,
  normalizeComposerEffort,
  normalizeComposerApprovalPolicy,
  normalizeComposerSandboxMode,
  normalizeUserMessageContent: normalizeMessageContent,
  createUserMessageFingerprint,
  createLocalId,
  rememberTurnStartedAt,
  clearTurnStartedAt,
  getTurnStartedAtFromTurn,
  loadComposerOptions,
  send: (payload) => send(payload),
  forgetThread,
  render,
});

const {
  appendReasoningContentText,
  appendReasoningSummaryPart,
  appendReasoningSummaryText,
  assignPendingUserMessageToTurn,
  bumpItemRenderVersion,
  clearTransientConnectionNotices,
  cloneItemForTurn,
  ensureItemRenderVersion,
  ensureItems,
  finalizeItem,
  findPendingRequestForItem,
  getCommandOutput,
  getFileChangeOutput,
  getFileChangePatch,
  getNormalizedFileChangeKind,
  getReasoningText,
  getServerRequestsForThread,
  hasPendingServerRequest,
  hasUnreadInInactiveTabs,
  isItemInActiveTurn,
  markTabClosedLocally,
  markThreadUnread,
  normalizeFileChanges,
  normalizeServerRequestStatus,
  pruneUnreadThreads,
  reconcilePendingUserMessage,
  registerPendingUserMessage,
  removeServerRequest,
  rollbackPendingUserMessage,
  setActiveTab,
  setThreadTokenUsage,
  summarizeFileChanges,
  syncTurns,
  upsertLiveItem,
  upsertServerRequest,
  upsertStreamingItem,
  upsertTab,
  removeTab,
} = threadStore;

function renderNewTabButton() {
  newTabBtn.disabled = state.creatingTab || state.authFailed;
  newTabBtn.classList.toggle('is-loading', state.creatingTab);
  newTabBtn.textContent = state.creatingTab ? '正在创建会话...' : '+ 新建会话';
}

const socketController = createSocketController({
  state,
  render,
  renderMessages,
  clearTransientConnectionNotices,
  loadComposerOptions,
  openTextModal,
  isTextModalOpen,
  handleMessage: (msg) => handleMessage(msg),
});

const {
  getWebSocketToken,
  isSocketConnected,
  promptForWebSocketToken,
  reconnectNow,
  send,
  withAuthTokenQuery,
  markAuthFailed,
} = socketController;

const apiFetchJson = createApiFetchJson(getWebSocketToken);
const buildUploadPreviewUrl = createBuildUploadPreviewUrl(withAuthTokenQuery);

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
  normalizeUserMessageContent: normalizeMessageContent,
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

let slashController = null;
const applyPermissionPresetChoice = (...args) => slashController?.applyPermissionPresetChoice(...args);
const openAdvancedPermissionSettings = (...args) => slashController?.openAdvancedPermissionSettings(...args);

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

slashController = createSlashController({
  state,
  sidebar,
  mainArea,
  composer,
  composerControlsToggle,
  promptInput,
  slashMenu: document.getElementById('slashMenu'),
  modelSelect,
  reasoningEffortSelect,
  approvalPolicySelect,
  sandboxModeSelect,
  themeSelect,
  render,
  renderComposer,
  renderMessages,
  autoResizePromptInput,
  send,
  reconnectNow,
  promptForWebSocketToken,
  startNewSessionFlow,
  openCustomSelectFor,
  getComposerAttachments,
  getComposerUploadCount,
  getSessionName,
  getWorkspacePath,
  getEffectiveComposerSelection,
  inferPermissionPresetValue,
  formatPermissionPresetLabel,
  formatReasoningEffortLabel,
  formatApprovalPolicyLabel,
  formatSandboxModeLabel,
  getServerRequestsForThread,
  normalizeServerRequestStatus,
  focusServerRequestCard,
  submitServerRequestResponse,
  submitTurnMessage,
  applyPermissionPreset,
  ensureItems,
  createLocalId,
  isSocketConnected,
});

const {
  addThreadNotice,
  closeSlashMenu,
  showPermissionPresetPrompt,
} = slashController;

const { uploadComposerImageFiles } = createUploadController({
  state,
  apiFetchJson,
  render,
  renderComposer,
  addThreadNotice,
  withAuthTokenQuery,
  getAttachmentFileName,
  buildUploadPreviewUrl,
  getComposerAttachments,
  setComposerAttachments,
  getComposerUploadCount,
  setComposerUploadCount,
});

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
  handleTextModalFormSubmit(event);
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
  handleTextModalBackdropClick(event);
});

sessionModal.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.sessionModalClose === 'true') {
    closeSessionModal(null);
  }
});

window.addEventListener('keydown', (event) => {
  if (handleTextModalEscapeKey(event)) {
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
  slashController.handlePromptKeydown(event);
});

promptInput.addEventListener('input', () => {
  slashController.handlePromptInput();
});

promptInput.addEventListener('focus', () => {
  slashController.handlePromptFocus();
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
  slashController.handleComposerSubmit();
});
window.setInterval(() => {
  if (state.creatingTab || Array.from(state.turnActiveByThread.values()).some(Boolean)) {
    renderHeader();
    refreshLiveWorkingLabels();
  }
}, 1000);
