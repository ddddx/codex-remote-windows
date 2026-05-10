export function createAppState() {
  return {
    tabs: [],
    activeThreadId: null,
    itemsByThread: new Map(),
    partialByThread: new Map(),
    turnActiveByThread: new Map(),
    currentTurnIdByThread: new Map(),
    turnStartedAtByThread: new Map(),
    tokenUsageByThread: new Map(),
    turnPlansByThread: new Map(),
    turnDiffsByThread: new Map(),
    composerAttachmentsByThread: new Map(),
    composerDraftByThread: new Map(),
    composerUploadsInFlightByThread: new Map(),
    unreadThreadIds: new Set(),
    pendingUserMessages: new Map(),
    serverRequests: [],
    globalNotices: [],
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
}

export function createSessionModalState() {
  return {
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
}

export function createComposerStateHelpers(state, deps = {}) {
  const {
    readPromptValue = () => '',
    writePromptValue = () => {},
    autoResizePromptInput = () => {},
  } = deps;

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

  function getComposerDraft(threadId = state.activeThreadId) {
    if (!threadId) {
      return '';
    }
    return state.composerDraftByThread.get(threadId) || '';
  }

  function setComposerDraft(threadId, text) {
    if (!threadId) {
      return;
    }
    const normalized = typeof text === 'string' ? text : '';
    if (normalized) {
      state.composerDraftByThread.set(threadId, normalized);
    } else {
      state.composerDraftByThread.delete(threadId);
    }
  }

  function persistActiveComposerDraft() {
    if (!state.activeThreadId) {
      return;
    }
    setComposerDraft(state.activeThreadId, readPromptValue());
  }

  function restoreComposerDraft(threadId) {
    writePromptValue(getComposerDraft(threadId));
    autoResizePromptInput();
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

  return {
    clearComposerAttachments,
    getComposerAttachments,
    getComposerDraft,
    getComposerUploadCount,
    persistActiveComposerDraft,
    restoreComposerDraft,
    setComposerAttachments,
    setComposerDraft,
    setComposerUploadCount,
  };
}
