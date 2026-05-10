export function createThreadStore(deps) {
  const {
    state,
    compareTabs,
    normalizeComposerModel,
    normalizeComposerEffort,
    normalizeComposerApprovalPolicy,
    normalizeComposerSandboxMode,
    normalizeUserMessageContent,
    createUserMessageFingerprint,
    createLocalId,
    rememberTurnStartedAt,
    clearTurnStartedAt,
    getTurnStartedAtFromTurn,
    loadComposerOptions,
    send,
    forgetThread,
    render,
  } = deps;

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

  function stringifyFileChangeKind(kind) {
    if (typeof kind === 'string') {
      return kind;
    }
    if (kind && typeof kind === 'object' && typeof kind.type === 'string') {
      return kind.type;
    }
    return '';
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
    const merged = new Map();
    for (const change of changes) {
      const path = String(change?.path || '').trim();
      if (!path) {
        continue;
      }
      const kind = getNormalizedFileChangeKind(change.kind);
      const addedLines = Math.max(0, Number.parseInt(change?.addedLines, 10) || 0);
      const deletedLines = Math.max(0, Number.parseInt(change?.deletedLines, 10) || 0);
      const key = `${kind}:${path}`;
      const existing = merged.get(key);
      if (existing) {
        existing.addedLines += addedLines;
        existing.deletedLines += deletedLines;
        continue;
      }
      merged.set(key, { path, kind, addedLines, deletedLines });
    }
    return Array.from(merged.values());
  }

  function parseFileChangesFromPatch(patch) {
    const text = String(patch || '');
    if (!text.trim()) {
      return [];
    }

    const changes = [];
    const lines = text.split(/\r?\n/);
    let currentDiffPath = '';
    let currentChange = null;

    function ensureCurrentChange(kind, path) {
      const normalizedPath = String(path || '').trim();
      if (!normalizedPath) {
        currentChange = null;
        return null;
      }
      currentDiffPath = normalizedPath;
      currentChange = {
        path: normalizedPath,
        kind: getNormalizedFileChangeKind(kind),
        addedLines: 0,
        deletedLines: 0,
      };
      changes.push(currentChange);
      return currentChange;
    }

    for (const line of lines) {
      let match = line.match(/^\*\*\* Add File: (.+)$/);
      if (match) {
        ensureCurrentChange('add', match[1].trim());
        continue;
      }

      match = line.match(/^\*\*\* Delete File: (.+)$/);
      if (match) {
        ensureCurrentChange('delete', match[1].trim());
        continue;
      }

      match = line.match(/^\*\*\* Update File: (.+)$/);
      if (match) {
        ensureCurrentChange('update', match[1].trim());
        continue;
      }

      match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        currentDiffPath = (match[2] || match[1] || '').trim();
        if (currentDiffPath) {
          ensureCurrentChange('update', currentDiffPath);
        }
        continue;
      }

      match = line.match(/^rename to (.+)$/);
      if (match) {
        ensureCurrentChange('update', match[1].trim());
        continue;
      }

      if (line.startsWith('new file mode ') && currentDiffPath) {
        ensureCurrentChange('add', currentDiffPath);
        continue;
      }

      if (line.startsWith('deleted file mode ') && currentDiffPath) {
        ensureCurrentChange('delete', currentDiffPath);
        continue;
      }

      if (line.startsWith('*** Move to: ')) {
        const movedPath = line.replace(/^\*\*\* Move to:\s*/, '').trim();
        if (movedPath) {
          currentDiffPath = movedPath;
          if (currentChange) {
            currentChange.path = movedPath;
          }
        }
        continue;
      }

      if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('@@') || line.startsWith('index ') || line.startsWith('Binary files ') || line.startsWith('rename from ')) {
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++ ')) {
        if (!currentChange && currentDiffPath) {
          currentChange = ensureCurrentChange('update', currentDiffPath);
        }
        if (currentChange) {
          currentChange.addedLines += 1;
        }
        continue;
      }

      if (line.startsWith('-') && !line.startsWith('--- ')) {
        if (!currentChange && currentDiffPath) {
          currentChange = ensureCurrentChange('update', currentDiffPath);
        }
        if (currentChange) {
          currentChange.deletedLines += 1;
        }
      }
    }

    return dedupeFileChanges(changes);
  }

  function normalizeFileChanges(changes, patch = '') {
    const patchChanges = parseFileChangesFromPatch(patch);
    const patchStatsByPath = new Map();
    for (const change of patchChanges) {
      const path = String(change?.path || '').trim();
      if (!path) {
        continue;
      }
      patchStatsByPath.set(path, {
        kind: getNormalizedFileChangeKind(change.kind),
        addedLines: Math.max(0, Number.parseInt(change?.addedLines, 10) || 0),
        deletedLines: Math.max(0, Number.parseInt(change?.deletedLines, 10) || 0),
      });
    }

    const normalized = dedupeFileChanges(
      (Array.isArray(changes) ? changes : []).map((change) => ({
        path: change?.path || change?.filePath || change?.file || '',
        kind: stringifyFileChangeKind(change?.kind || change?.type || ''),
        addedLines: change?.addedLines ?? patchStatsByPath.get(String(change?.path || change?.filePath || change?.file || '').trim())?.addedLines ?? 0,
        deletedLines: change?.deletedLines ?? patchStatsByPath.get(String(change?.path || change?.filePath || change?.file || '').trim())?.deletedLines ?? 0,
      }))
    );
    if (normalized.length) {
      return normalized;
    }
    return patchChanges;
  }

  function summarizeFileChanges(changes) {
    const counts = { add: 0, update: 0, delete: 0 };
    let addedLines = 0;
    let deletedLines = 0;
    for (const change of changes) {
      counts[getNormalizedFileChangeKind(change.kind)] += 1;
      addedLines += Math.max(0, Number.parseInt(change?.addedLines, 10) || 0);
      deletedLines += Math.max(0, Number.parseInt(change?.deletedLines, 10) || 0);
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
    if (addedLines || deletedLines) {
      parts.push(`+${addedLines} / -${deletedLines}`);
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

  return {
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
    normalizeFileChanges,
    upsertLiveItem,
    upsertServerRequest,
    upsertStreamingItem,
    upsertTab,
    removeTab,
  };
}
