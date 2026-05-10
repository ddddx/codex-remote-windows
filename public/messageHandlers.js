export function createMessageHandler(deps) {
  const {
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
    syncSupplementalItems,
    syncTurns,
    rememberTurnStartedAt,
    clearTurnStartedAt,
    assignPendingUserMessageToTurn,
    upsertStreamingItem,
    cloneItemForTurn,
    reconcilePendingUserMessage,
    finalizeItem,
    setThreadTurnPlan,
    setThreadTurnDiff,
    upsertLiveItem,
    appendReasoningSummaryText,
    appendReasoningSummaryPart,
    appendReasoningContentText,
    appendMcpToolProgress,
    upsertGuardianReviewEvent,
    upsertHookEvent,
    rollbackPendingUserMessage,
    setComposerAttachments,
    currentTurnIdByThread,
    getComposerUploadCount,
    createLocalId,
    markTabClosedLocally,
    getComposerAttachments,
  } = deps;

  return function handleMessage(msg) {
    function setTurnActive(threadId, turnId = null, startedAt = null, options = {}) {
      const { assignPendingUserMessage = false } = options;
      state.turnActiveByThread.set(threadId, true);
      if (startedAt != null) {
        rememberTurnStartedAt(threadId, startedAt);
      }
      if (turnId) {
        state.currentTurnIdByThread.set(threadId, turnId);
        if (assignPendingUserMessage) {
          assignPendingUserMessageToTurn(threadId, turnId);
        }
      }
    }

    function rerenderActiveThread(threadId, options = {}) {
      if (threadId !== state.activeThreadId) {
        return;
      }
      scheduleRender({
        header: !!options.header,
        messages: options.messages !== false,
      });
    }

    function upsertGlobalNotice(kind, payload) {
      const noticeId = payload?.noticeId || createLocalId(kind === '_error' ? 'global-err' : 'global-warn');
      const nextNotice = {
        type: kind,
        id: noticeId,
        text: payload?.message || '',
        createdAt: payload?.createdAt || Date.now(),
        noticeKind: payload?.noticeKind || '',
      };
      const index = state.globalNotices.findIndex((item) => item?.id === noticeId);
      if (index >= 0) {
        state.globalNotices[index] = {
          ...state.globalNotices[index],
          ...nextNotice,
        };
      } else {
        state.globalNotices.push(nextNotice);
      }
    }

    function upsertThreadNotice(threadId, kind, payload) {
      const items = ensureItems(threadId);
      const noticeId = payload?.noticeId || createLocalId(kind === '_error' ? 'err' : 'warn');
      const nextItem = {
        type: kind,
        id: noticeId,
        text: payload?.message || '',
        createdAt: payload?.createdAt || Date.now(),
        noticeKind: payload?.noticeKind || '',
        _turnId: payload?.turnId || null,
        _supplemental: true,
      };
      const index = items.findIndex((item) => item?.id === noticeId);
      if (index >= 0) {
        items[index] = {
          ...items[index],
          ...nextItem,
        };
      } else {
        items.push(nextItem);
      }
    }

    if (msg.type === 'state') {
      state.tabs = [];
      for (const tab of msg.tabs || []) {
        upsertTab(tab);
      }
      state.serverRequests = [];
      state.globalNotices = Array.isArray(msg.globalSupplementalItems)
        ? msg.globalSupplementalItems.map((item) => ({ ...item }))
        : [];
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
      void loadComposerOptions({ render: false });
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

    if (msg.type === 'server_request_reset') {
      state.serverRequests = [];
      render();
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
      setThreadTokenUsage(msg.threadId, msg.tokenUsage || null);
      syncThreadTurnMeta(msg.threadId, msg.turnPlans || [], msg.turnDiffs || []);
      syncTurns(msg.threadId, msg.turns || []);
      syncSupplementalItems(msg.threadId, msg.supplementalItems || []);
      if (Array.isArray(msg.globalSupplementalItems)) {
        state.globalNotices = msg.globalSupplementalItems.map((item) => ({ ...item }));
      }
      render();
      return;
    }

    if (msg.type === 'turn_started') {
      setTurnActive(msg.threadId, msg.turnId, msg.startedAt, { assignPendingUserMessage: true });
      rerenderActiveThread(msg.threadId, { header: true, messages: true });
      return;
    }

    if (msg.type === 'turn_completed') {
      state.turnActiveByThread.set(msg.threadId, false);
      clearTurnStartedAt(msg.threadId);
      if (!msg.turnId || state.currentTurnIdByThread.get(msg.threadId) === msg.turnId) {
        state.currentTurnIdByThread.delete(msg.threadId);
      }
      if (msg.threadId === state.activeThreadId) {
        scheduleRender({ header: true, messages: true });
      }
      return;
    }

    if (msg.type === 'turn_plan_updated') {
      setThreadTurnPlan(msg.threadId, msg.turnId, {
        explanation: msg.explanation,
        plan: msg.plan,
      });
      rerenderActiveThread(msg.threadId, { messages: true });
      return;
    }

    if (msg.type === 'turn_diff_updated') {
      setThreadTurnDiff(msg.threadId, msg.turnId, msg.diff);
      rerenderActiveThread(msg.threadId, { messages: true });
      return;
    }

    if (msg.type === 'hook_started') {
      setTurnActive(msg.threadId, msg.turnId);
      upsertHookEvent(msg.threadId, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null, msg.run, 'started');
      rerenderActiveThread(msg.threadId, { messages: true });
      return;
    }

    if (msg.type === 'hook_completed') {
      upsertHookEvent(msg.threadId, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null, msg.run, 'completed');
      rerenderActiveThread(msg.threadId, { messages: true });
      return;
    }

    if (msg.type === 'guardian_review_started') {
      setTurnActive(msg.threadId, msg.turnId);
      upsertGuardianReviewEvent(msg.threadId, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null, msg, 'started');
      rerenderActiveThread(msg.threadId, { messages: true });
      return;
    }

    if (msg.type === 'guardian_review_completed') {
      upsertGuardianReviewEvent(msg.threadId, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null, msg, 'completed');
      rerenderActiveThread(msg.threadId, { messages: true });
      return;
    }

    if (msg.type === 'plan_delta') {
      setTurnActive(msg.threadId, msg.turnId, msg.startedAt);
      upsertLiveItem(msg.threadId, msg.turnId, msg.itemId, 'plan', (item) => {
        const delta = typeof msg.delta === 'string' ? msg.delta : '';
        item.text = `${item.text || ''}${delta}`;
      });
      rerenderActiveThread(msg.threadId, { header: true, messages: true });
      return;
    }

    if (msg.type === 'agent_delta') {
      setTurnActive(msg.threadId, msg.turnId, msg.startedAt);
      upsertStreamingItem(msg.threadId, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null, msg.itemId, msg.delta || '');
      rerenderActiveThread(msg.threadId, { header: true, messages: true });
      return;
    }

    if (msg.type === 'mcp_tool_progress') {
      setTurnActive(msg.threadId, msg.turnId, msg.startedAt);
      appendMcpToolProgress(
        msg.threadId,
        msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null,
        msg.itemId,
        msg.message || ''
      );
      rerenderActiveThread(msg.threadId, { header: true, messages: true });
      return;
    }

    if (msg.type === 'item_started') {
      setTurnActive(msg.threadId, msg.turnId, msg.startedAt);
      const items = ensureItems(msg.threadId);
      const item = cloneItemForTurn(msg.item, msg.turnId || state.currentTurnIdByThread.get(msg.threadId) || null);
      reconcilePendingUserMessage(msg.threadId, item);
      if (item && item.id && !items.find((entry) => entry.id === item.id)) {
        items.push({ ...item, _partial: true, _renderVersion: 1 });
      }
      rerenderActiveThread(msg.threadId, { header: true, messages: true });
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
        scheduleRender({ messages: true });
      }
      return;
    }

    if (msg.type === 'item_delta') {
      setTurnActive(msg.threadId, msg.turnId, msg.startedAt);

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

      rerenderActiveThread(msg.threadId, { header: true, messages: true });
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
        scheduleRender({ messages: true });
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
        const pending = rollbackPendingUserMessage(msg.clientMessageId);
        state.turnActiveByThread.set(threadId, false);
        if (threadId === state.activeThreadId && pending?.content?.length) {
          const restoredText = pending.content
            .filter((entry) => entry.type === 'text')
            .map((entry) => entry.text)
            .join('\n');
          const restoredAttachments = pending.content
            .filter((entry) => entry.type === 'localImage')
            .map((entry) => ({ ...entry }));
          promptInput.value = restoredText;
          setComposerAttachments(threadId, restoredAttachments);
          autoResizePromptInput();
        }
      }

      if (msg.code === 'THREAD_NOT_FOUND' && msg.op === 'turn_start') {
        const marked = markTabClosedLocally(threadId);
        if (!marked) {
          if (threadId === state.activeThreadId) {
            render();
          } else {
            renderTabs();
          }
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
        render();
      }
      return;
    }

    if (msg.type === 'token_usage') {
      const changed = setThreadTokenUsage(msg.threadId, msg.usage);
      if (changed && msg.threadId === state.activeThreadId) {
        renderHeader();
      }
      return;
    }

    if (msg.type === 'warning') {
      const threadId = msg.threadId || state.activeThreadId;
      if (!threadId) {
        upsertGlobalNotice('_warning', msg);
        renderMessages();
        return;
      }
      upsertThreadNotice(threadId, '_warning', msg);
      if (threadId === state.activeThreadId) {
        renderMessages();
      }
      return;
    }

    if (msg.type === 'error_notice') {
      const threadId = msg.threadId || state.activeThreadId;
      if (!threadId) {
        upsertGlobalNotice('_error', msg);
        renderMessages();
        return;
      }
      upsertThreadNotice(threadId, '_error', msg);
      if (threadId === state.activeThreadId) {
        renderMessages();
      }
      return;
    }

    console.log('Unhandled message:', msg.type, msg);
  };
}
