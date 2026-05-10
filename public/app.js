import {
  compareTabs,
  getSessionName,
  getWorkspacePath,
  getWorkspaceFolder,
} from './tabs.js';
import {
  buildComposerMessageContent,
  createBuildUploadPreviewUrl,
  createUserMessageFingerprint,
  getAttachmentFileName,
  normalizeUserMessageContent,
  renderMarkdown,
} from './messageContent.js';
import { createApiFetchJson, isUnauthorizedApiError } from './apiClient.js';
import { createSocketController } from './socket.js';
import { getAppDom } from './appDom.js';
import { createAppShell } from './appShell.js';
import { createAppState, createComposerStateHelpers, createSessionModalState } from './appState.js';
import {
  autoResizeTextarea,
  createLocalId,
  createRenderScheduler,
  createTimestampNode,
  createTurnTimingHelpers,
  extractItemTimestampMs,
  getDefaultWorkspacePath,
  getTurnStartedAtFromTurn,
  normalizeTimestampMs,
} from './appRuntime.js';
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

const {
  sidebar,
  sidebarClose,
  menuBtn,
  tabList,
  newTabBtn,
  messagesEl,
  jumpToBottomBtn,
  sessionCreatingOverlay,
  composer,
  composerControlsToggle,
  composerControlsSummary,
  modelSelect,
  reasoningEffortSelect,
  permissionPresetSelect,
  approvalPolicySelect,
  sandboxModeSelect,
  promptInput,
  attachImageBtn,
  imageInput,
  composerAttachmentList,
  slashMenu,
  composerSubmitBtn,
  activeTitle,
  themeSelect,
  contextUsage,
  tokenBtn,
  activeStatus,
  mainArea,
  tabTpl,
  textModal,
  textModalForm,
  modalTitle,
  modalLabel,
  modalInput,
  modalCancelBtn,
  modalConfirmBtn,
  sessionModal,
  sessionModalForm,
  sessionNameInput,
  sessionWorkspaceInput,
  browseWorkspaceBtn,
  workspaceUpBtn,
  workspaceRefreshBtn,
  createWorkspaceBtn,
  useCurrentWorkspaceBtn,
  workspaceShortcutSelect,
  workspaceBrowserPath,
  workspaceBrowserList,
  sessionModalHint,
  sessionModalTopCloseBtn,
  sessionModalCancelBtn,
  sessionModalConfirmBtn,
} = getAppDom(document);

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

const state = createAppState();
const sessionModalState = createSessionModalState();

let renderMessages = () => {};
let forgetThread = () => {};
let handleMessage = () => {};
let focusServerRequestCard = () => false;
let refreshLiveWorkingLabels = () => {};
let submitServerRequestResponse = () => {};
const autoResizePromptInput = () => autoResizeTextarea(promptInput);
const {
  clearComposerAttachments,
  getComposerAttachments,
  persistActiveComposerDraft,
  restoreComposerDraft,
  setComposerAttachments,
  setComposerDraft,
  getComposerUploadCount,
  setComposerUploadCount,
} = createComposerStateHelpers(state, {
  readPromptValue: () => promptInput.value,
  writePromptValue: (value) => {
    promptInput.value = value;
  },
  autoResizePromptInput,
});
const {
  clearTurnStartedAt,
  getTurnWorkingLabel,
  rememberTurnStartedAt,
} = createTurnTimingHelpers(state);

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
  setComposerDraft(threadId, '');
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
    if (!isUnauthorizedApiError(error)) {
      console.error('failed loading codex options', error);
    }
  } finally {
    if (requestId === composerOptionsRequestSerial) {
      state.composerOptionsLoading = false;
      renderComposer();
    }
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

const scheduleRender = createRenderScheduler(
  () => renderHeader(),
  () => renderMessages()
);

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

let renderTabs = () => {};
let renderHeader = () => {};
let renderComposer = () => {};
let renderComposerAttachmentList = () => {};
let render = () => {};

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
  persistActiveComposerDraft,
  restoreComposerDraft,
  send: (payload) => send(payload),
  forgetThread: (...args) => forgetThread(...args),
  render: () => render(),
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
  syncThreadTurnMeta,
  getThreadTurnPlan,
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
  setThreadTurnDiff,
  setThreadTurnPlan,
  setThreadTokenUsage,
  summarizeFileChanges,
  syncTurns,
  upsertLiveItem,
  upsertServerRequest,
  upsertStreamingItem,
  upsertTab,
  removeTab,
} = threadStore;

const socketController = createSocketController({
  state,
  render: () => render(),
  renderMessages: () => renderMessages(),
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

const appShell = createAppShell({
  state,
  elements: {
    activeStatus,
    activeTitle,
    approvalPolicySelect,
    attachImageBtn,
    composer,
    composerAttachmentList,
    composerControlsSummary,
    composerControlsToggle,
    composerSubmitBtn,
    contextUsage,
    jumpToBottomBtn,
    menuBtn,
    modelSelect,
    newTabBtn,
    permissionPresetSelect,
    promptInput,
    reasoningEffortSelect,
    sandboxModeSelect,
    sessionCreatingOverlay,
    tabList,
    tabTpl,
    themeSelect,
    tokenBtn,
  },
  emptyThreadTitle: 'Codex Remote Control',
  defaultPromptPlaceholder: DEFAULT_PROMPT_PLACEHOLDER,
  themeOptions: THEME_OPTIONS,
  fillSelectOptions,
  syncCustomSelect,
  hasUnreadInInactiveTabs,
  hasPendingServerRequest,
  normalizeTabStatus,
  setActiveTab: (...args) => setActiveTab(...args),
  send: (payload) => send(payload),
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
  buildUploadPreviewUrl,
  getAttachmentFileName,
  setComposerAttachments,
});

renderTabs = () => appShell.renderTabs();
renderHeader = () => appShell.renderHeader();
renderComposer = () => appShell.renderComposer();
renderComposerAttachmentList = (attachments = getComposerAttachments()) => appShell.renderComposerAttachmentList(attachments);
render = () => appShell.render(renderMessages);

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
    workspaceShortcutSelect,
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
  getThreadTurnPlan,
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

({
  focusServerRequestCard,
  forgetThread,
  refreshLiveWorkingLabels,
  renderMessages,
  submitServerRequestResponse,
} = messageRenderer);

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

handleMessage = createMessageHandler({
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
  loadComposerOptions,
  ensureItems,
  upsertTab,
  removeTab,
  upsertServerRequest,
  removeServerRequest,
  markThreadUnread,
  pruneUnreadThreads,
  setActiveTab,
  setThreadTokenUsage,
  syncThreadTurnMeta,
  syncTurns,
  rememberTurnStartedAt,
  clearTurnStartedAt,
  assignPendingUserMessageToTurn,
  upsertStreamingItem,
  cloneItemForTurn,
  reconcilePendingUserMessage,
  finalizeItem,
  setThreadTurnDiff,
  setThreadTurnPlan,
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

workspaceShortcutSelect.addEventListener('change', () => {
  const nextPath = workspaceShortcutSelect.value.trim();
  if (!nextPath) {
    return;
  }
  updateSessionWorkspacePath(nextPath);
  void browseWorkspacePath(nextPath);
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
  persistActiveComposerDraft();
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
