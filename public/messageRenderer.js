export function createMessageRenderer(deps) {
  const {
    state,
    messagesEl,
    jumpToBottomBtn,
    emptyThreadKey,
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
  } = deps;

  const messageDomByThread = new Map();
  const detailOpenStateByKey = new Map();
  let lastRenderedMessagesThreadKey = emptyThreadKey;
  let unreadMessagesBelowFold = false;

  function isMessagesNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 24;
  }

  function renderJumpToBottomButton() {
    const shouldShow = unreadMessagesBelowFold && !isMessagesNearBottom();
    jumpToBottomBtn.hidden = !shouldShow;
  }

  function handleMessagesScroll() {
    if (isMessagesNearBottom()) {
      unreadMessagesBelowFold = false;
    }
    renderJumpToBottomButton();
  }

  function jumpToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    unreadMessagesBelowFold = false;
    renderJumpToBottomButton();
  }

  function forgetThread(threadId) {
    if (!threadId) {
      return;
    }
    messageDomByThread.delete(threadId);
    if (lastRenderedMessagesThreadKey === threadId) {
      lastRenderedMessagesThreadKey = emptyThreadKey;
      unreadMessagesBelowFold = false;
    }
  }

  function ensureMessageDomMap(threadKey) {
    if (!messageDomByThread.has(threadKey)) {
      messageDomByThread.set(threadKey, new Map());
    }
    return messageDomByThread.get(threadKey);
  }

  function captureDetailOpenStates(container) {
    if (!(container instanceof HTMLElement)) {
      return;
    }
    const detailsList = container.querySelectorAll('details.timeline-inline-detail-row[data-detail-state-key]');
    detailsList.forEach((details) => {
      if (!(details instanceof HTMLDetailsElement)) {
        return;
      }
      const key = details.dataset.detailStateKey || '';
      if (!key) {
        return;
      }
      detailOpenStateByKey.set(key, { open: details.open });
    });
  }

  function renderMessages() {
    const threadKey = state.activeThreadId || emptyThreadKey;
    const entries = buildMessageEntries(state.activeThreadId);
    const domMap = ensureMessageDomMap(threadKey);
    const nextKeys = new Set(entries.map((entry) => entry.key));
    const didThreadChange = lastRenderedMessagesThreadKey !== threadKey;
    const shouldStickToBottom = isMessagesNearBottom();

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
        captureDetailOpenStates(record.node);
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

    if (didThreadChange || shouldStickToBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      unreadMessagesBelowFold = false;
    } else if (entries.some((entry) => hasLiveEntryActivity(entry))) {
      unreadMessagesBelowFold = true;
    }

    lastRenderedMessagesThreadKey = threadKey;
    renderJumpToBottomButton();
  }

  function focusServerRequestCard(requestId) {
    if (!requestId) {
      return false;
    }
    const target = Array.from(messagesEl.querySelectorAll('[data-server-request-id]'))
      .find((node) => node instanceof HTMLElement && node.dataset.serverRequestId === requestId);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashSlashFocus(target);
    return true;
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

  function classifyDiffLine(line) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      return 'file';
    }
    if (line.startsWith('*** Add File:') || line.startsWith('*** Delete File:') || line.startsWith('*** Update File:')) {
      return 'file';
    }
    if (line.startsWith('diff --git ')) {
      return 'file';
    }
    if (line.startsWith('@@')) {
      return 'hunk';
    }
    if (line.startsWith('+')) {
      return 'add';
    }
    if (line.startsWith('-')) {
      return 'delete';
    }
    return 'context';
  }

  function createDiffBlock(text) {
    const root = document.createElement('div');
    root.className = 'timeline-inline-diff';

    const normalized = String(text || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    for (const line of lines) {
      const row = document.createElement('div');
      row.className = `timeline-diff-line kind-${classifyDiffLine(line)}`;
      row.textContent = line || ' ';
      root.appendChild(row);
    }

    return root;
  }

  function createDetailContent() {
    const body = document.createElement('div');
    body.className = 'timeline-inline-detail-body';
    return body;
  }

  function getDetailStateKey(entry, suffix = '') {
    if (!entry?.key) {
      return '';
    }
    return suffix ? `${entry.key}:${suffix}` : entry.key;
  }

  function preserveDetailOpenState(container) {
    if (!(container instanceof HTMLElement)) {
      return null;
    }
    const existing = container.querySelector('details.timeline-inline-detail-row');
    if (!(existing instanceof HTMLDetailsElement)) {
      return null;
    }
    const key = existing.dataset.detailStateKey || '';
    if (key) {
      detailOpenStateByKey.set(key, { open: existing.open });
    }
    return { open: existing.open };
  }

  function applyDetailOpenState(details, preservedState, fallbackOpen, detailStateKey = '') {
    if (!(details instanceof HTMLDetailsElement)) {
      return;
    }
    if (detailStateKey) {
      details.dataset.detailStateKey = detailStateKey;
    }
    const rememberedState = detailStateKey ? detailOpenStateByKey.get(detailStateKey) : null;
    details.open = preservedState ? preservedState.open : (rememberedState ? rememberedState.open : !!fallbackOpen);
    if (detailStateKey) {
      detailOpenStateByKey.set(detailStateKey, { open: details.open });
      details.addEventListener('toggle', () => {
        detailOpenStateByKey.set(detailStateKey, { open: details.open });
      });
    }
  }

  function populateCommandEntry(node, entry) {
    node.className = 'timeline-card timeline-card-command';
    const detailStateKey = getDetailStateKey(entry, 'command');
    const preservedState = preserveDetailOpenState(node);

    const details = document.createElement('details');
    details.className = 'timeline-inline-detail-row';
    applyDetailOpenState(details, preservedState, isExecutionStatusActive(entry.status) || entry.status === 'pendingApproval' || entry.status === 'failed', detailStateKey);

    const summary = document.createElement('summary');
    summary.appendChild(createTimelineTitle(`${commandStatusIcon(entry.status)} ${compactText(entry.command, 110) || '命令执行'}`));
    summary.appendChild(createTimelineMeta(`命令执行 · ${formatExecutionStatusText(entry.status)}`));
    if (entry.timestampMs) {
      summary.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
    if (entry.threadId) {
      summary.appendChild(createLiveWorkingMeta(entry.threadId));
    }
    details.appendChild(summary);

    const body = createDetailContent();
    body.appendChild(createTimelinePre(entry.command || '', 'timeline-inline-pre-shell'));
    if (entry.output) {
      body.appendChild(createTimelinePre(entry.output, 'timeline-inline-pre-output'));
    } else if (isExecutionStatusActive(entry.status) || entry.status === 'pendingApproval') {
      body.appendChild(createTimelinePlaceholder(entry.status === 'pendingApproval' ? '等待批准后继续执行…' : '命令正在执行…'));
    }
    details.appendChild(body);

    node.appendChild(details);
  }

  function populateFileChangeEntry(node, entry) {
    node.className = 'timeline-card timeline-card-file-change';
    const detailStateKey = getDetailStateKey(entry, 'fileChange');
    const preservedState = preserveDetailOpenState(node);

    const details = document.createElement('details');
    details.className = 'timeline-inline-detail-row';
    applyDetailOpenState(details, preservedState, entry.status === 'pendingApproval' || isExecutionStatusActive(entry.status), detailStateKey);

    const summaryText = summarizeFileChanges(entry.changes) || '文件修改';
    const preview = entry.changes.slice(0, 3).map((change) => basenamePath(change.path) || change.path).filter(Boolean);
    const extraCount = entry.changes.length > 3 ? ` · ${preview.length} / ${entry.changes.length}` : '';

    const summary = document.createElement('summary');
    summary.appendChild(createTimelineTitle(`${commandStatusIcon(entry.status)} ${compactText(summaryText, 110)}${extraCount}`));
    summary.appendChild(createTimelineMeta(`文件修改 · ${formatExecutionStatusText(entry.status)}`));
    if (entry.timestampMs) {
      summary.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
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
      line.appendChild(document.createTextNode(`${formatFileChangePrefix(change.kind)} ${change.path}`));
      const statsNode = createFileChangeLineStatsNode(change);
      if (statsNode) {
        line.appendChild(statsNode);
      }
      changes.appendChild(line);
    }
    body.appendChild(changes);
    if (!entry.changes.length) {
      body.appendChild(createTimelinePlaceholder('等待文件变更详情…'));
    }
    if (entry.patch) {
      body.appendChild(createDiffBlock(entry.patch));
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
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateReasoningEntry(node, entry) {
    node.className = 'timeline-card timeline-card-reasoning';
    node.appendChild(createTimelineMeta('思考'));
    node.appendChild(createMessageBody(renderMarkdown(entry.text)));
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populatePlanItemEntry(node, entry) {
    node.className = 'timeline-card timeline-card-plan';
    node.appendChild(createTimelineMeta('计划草案'));
    if (entry.text) {
      node.appendChild(createMessageBody(renderMarkdown(entry.text)));
    } else {
      node.appendChild(createTimelinePlaceholder('正在生成计划…'));
    }
    if (entry.partial) {
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      cursor.textContent = ' ▌';
      node.appendChild(cursor);
    }
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateTurnPlanEntry(node, entry) {
    node.className = 'timeline-card timeline-card-plan-summary';
    node.appendChild(createTimelineTitle('执行计划'));
    if (entry.explanation) {
      node.appendChild(createTimelineMeta(entry.explanation));
    }
    const list = document.createElement('div');
    list.className = 'plan-step-list';
    for (const step of entry.plan || []) {
      const row = document.createElement('div');
      row.className = `plan-step status-${normalizePlanStepStatus(step?.status)}`;
      const badge = document.createElement('span');
      badge.className = 'plan-step-badge';
      badge.textContent = formatPlanStepStatus(step?.status);
      row.appendChild(badge);
      const text = document.createElement('span');
      text.className = 'plan-step-text';
      text.textContent = step?.step || '';
      row.appendChild(text);
      list.appendChild(row);
    }
    node.appendChild(list);
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateTurnDiffEntry(node, entry) {
    node.className = 'timeline-card timeline-card-file-change turn-diff-card';
    const detailStateKey = getDetailStateKey(entry, 'turnDiff');
    const preservedState = preserveDetailOpenState(node);
    const details = document.createElement('details');
    details.className = 'timeline-inline-detail-row';
    applyDetailOpenState(details, preservedState, false, detailStateKey);

    const summary = document.createElement('summary');
    summary.appendChild(createTimelineTitle(`🧩 ${compactText(summarizeFileChanges(entry.changes) || '本轮聚合变更', 120)}`));
    summary.appendChild(createTimelineMeta('Turn Diff'));
    if (entry.timestampMs) {
      summary.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
    details.appendChild(summary);

    const body = createDetailContent();
    if (entry.changes?.length) {
      const changes = document.createElement('div');
      changes.className = 'file-change-list';
      for (const change of entry.changes) {
        const line = document.createElement('div');
        line.className = `file-change-entry kind-${getNormalizedFileChangeKind(change.kind)}`;
        line.appendChild(document.createTextNode(`${formatFileChangePrefix(change.kind)} ${change.path}`));
        const statsNode = createFileChangeLineStatsNode(change);
        if (statsNode) {
          line.appendChild(statsNode);
        }
        changes.appendChild(line);
      }
      body.appendChild(changes);
    }
    body.appendChild(createDiffBlock(entry.diff));
    details.appendChild(body);
    node.appendChild(details);
  }

  function populateMcpToolCallEntry(node, entry) {
    node.className = 'timeline-card timeline-card-tool';
    node.appendChild(createTimelineTitle(`MCP · ${entry.server}.${entry.tool}`));
    node.appendChild(createTimelineMeta(`MCP 工具调用 · ${formatExecutionStatusText(entry.status)}`));
    if (entry.arguments) {
      node.appendChild(createTimelinePre(JSON.stringify(entry.arguments, null, 2), 'timeline-inline-pre-output'));
    }
    if (entry.result) {
      node.appendChild(createTimelinePre(JSON.stringify(entry.result, null, 2), 'timeline-inline-pre-output'));
    }
    if (entry.error) {
      node.appendChild(createTimelinePre(JSON.stringify(entry.error, null, 2), 'timeline-inline-pre-output'));
    }
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateDynamicToolCallEntry(node, entry) {
    node.className = 'timeline-card timeline-card-tool timeline-card-dynamic-tool';
    const title = entry.namespace ? `${entry.namespace}.${entry.tool}` : entry.tool;
    node.appendChild(createTimelineTitle(`Dynamic Tool · ${title}`));
    node.appendChild(createTimelineMeta(`${formatExecutionStatusText(entry.status)}${entry.success == null ? '' : (entry.success ? ' · success' : ' · failed')}`));
    if (entry.arguments) {
      node.appendChild(createTimelinePre(JSON.stringify(entry.arguments, null, 2), 'timeline-inline-pre-output'));
    }
    if (Array.isArray(entry.contentItems) && entry.contentItems.length) {
      node.appendChild(createTimelinePre(JSON.stringify(entry.contentItems, null, 2), 'timeline-inline-pre-output'));
    }
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateCollabToolCallEntry(node, entry) {
    node.className = 'timeline-card timeline-card-collab';
    node.appendChild(createTimelineTitle(`协作代理 · ${entry.tool || 'tool'}`));
    const metaParts = [formatExecutionStatusText(entry.status)];
    if (entry.agentStatus) {
      metaParts.push(`agent=${entry.agentStatus}`);
    }
    node.appendChild(createTimelineMeta(metaParts.join(' · ')));
    const facts = [];
    if (entry.senderThreadId) {
      facts.push(`sender: ${entry.senderThreadId}`);
    }
    if (entry.receiverThreadId) {
      facts.push(`receiver: ${entry.receiverThreadId}`);
    }
    if (entry.newThreadId) {
      facts.push(`new: ${entry.newThreadId}`);
    }
    if (facts.length) {
      node.appendChild(createTimelineMeta(facts.join(' · ')));
    }
    if (entry.prompt) {
      node.appendChild(createTimelinePre(entry.prompt, 'timeline-inline-pre-output'));
    }
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateReviewModeEntry(node, entry) {
    node.className = `timeline-card timeline-card-review ${entry.phase === 'entered' ? 'is-entered' : 'is-exited'}`;
    node.appendChild(createTimelineTitle(entry.phase === 'entered' ? '进入 Review 模式' : '退出 Review 模式'));
    if (entry.phase === 'entered') {
      node.appendChild(createTimelineMeta(entry.review || '正在审查当前变更'));
    } else {
      node.appendChild(createMessageBody(renderMarkdown(entry.review || '')));
    }
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateContextCompactionEntry(node, entry) {
    node.className = 'timeline-card timeline-card-context';
    node.appendChild(createTimelineTitle('上下文已压缩'));
    node.appendChild(createTimelineMeta('Codex 自动压缩了当前会话上下文'));
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
  }

  function populateImageViewEntry(node, entry) {
    node.className = 'timeline-card timeline-card-tool';
    node.appendChild(createTimelineTitle('查看图片'));
    node.appendChild(createTimelineMeta(entry.path || ''));
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'timeline-entry-timestamp'));
    }
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

  function populatePermissionPromptEntry(node, entry) {
    node.className = 'approval-banner approval-card permission-prompt-card';

    const title = document.createElement('div');
    title.className = 'item-label';
    title.textContent = '权限设置';
    node.appendChild(title);

    const reason = document.createElement('div');
    reason.className = 'approval-reason';
    reason.textContent = entry.text || '选择 /approvals 模式';
    node.appendChild(reason);

    const current = document.createElement('div');
    current.className = 'approval-meta';
    current.textContent = `当前预设: ${formatPermissionPresetLabel(entry.presetValue, { includeDescription: true })}`;
    node.appendChild(current);
    if (entry.timestampMs) {
      node.appendChild(createTimestampNode(entry.timestampMs, 'approval-timestamp'));
    }

    const actions = document.createElement('div');
    actions.className = 'approval-actions permission-prompt-actions';
    actions.appendChild(createActionButton('Read Only', false, () => {
      applyPermissionPresetChoice(entry.threadId, 'read-only');
    }, entry.presetValue === 'read-only' ? '' : 'btn-secondary'));
    actions.appendChild(createActionButton('Auto', false, () => {
      applyPermissionPresetChoice(entry.threadId, 'auto');
    }, entry.presetValue === 'auto' ? '' : 'btn-secondary'));
    actions.appendChild(createActionButton('Full Access', false, () => {
      applyPermissionPresetChoice(entry.threadId, 'full-access');
    }, entry.presetValue === 'full-access' ? '' : 'btn-secondary'));
    actions.appendChild(createActionButton('高级设置', false, () => {
      openAdvancedPermissionSettings(entry.threadId);
    }, 'btn-secondary'));
    node.appendChild(actions);
  }

  function appendUserMessageContent(node, content) {
    const entries = Array.isArray(content) ? content : [];
    const textEntries = entries.filter((entry) => entry.type === 'text');
    const imageEntries = entries.filter((entry) => entry.type === 'localImage' || entry.type === 'image');

    if (textEntries.length) {
      const text = textEntries.map((entry) => entry.text).join('\n');
      const textBody = document.createElement('div');
      textBody.className = 'user-message-text';
      textBody.textContent = text;
      node.appendChild(textBody);
    }

    if (!imageEntries.length) {
      return;
    }

    const gallery = document.createElement('div');
    gallery.className = 'message-image-grid';

    for (const imageEntry of imageEntries) {
      const figure = document.createElement('div');
      figure.className = 'message-image-card';

      const url = imageEntry.previewUrl || imageEntry.url || buildUploadPreviewUrl(imageEntry.path);
      if (url) {
        const image = document.createElement('img');
        image.className = 'message-image-thumb';
        image.src = url;
        image.alt = imageEntry.name || getAttachmentFileName(imageEntry.path || imageEntry.url) || '图片';
        image.loading = 'lazy';
        figure.appendChild(image);
      }

      const caption = document.createElement('div');
      caption.className = 'message-image-name';
      caption.textContent = imageEntry.name || getAttachmentFileName(imageEntry.path || imageEntry.url) || '图片';
      figure.appendChild(caption);

      gallery.appendChild(figure);
    }

    node.appendChild(gallery);
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
      } else if ((entry.turnMetaEntries?.length || 0) + entry.assistantEntries.length > 0) {
        meta.appendChild(createTurnBadge('已完成', 'done'));
      }
      node.appendChild(meta);

      if (entry.userEntry) {
        const userRow = createTranscriptRow('user');
        userRow.body.appendChild(createEntryElement(entry.userEntry));
        node.appendChild(userRow.row);
      }

      const shouldRenderAssistantRow = (entry.turnMetaEntries?.length || 0) + entry.assistantEntries.length > 0 || entry.isActive;
      if (shouldRenderAssistantRow) {
        const assistantRow = createTranscriptRow('assistant');
        const stack = document.createElement('div');
        stack.className = 'assistant-main-stack';
        for (const metaEntry of entry.turnMetaEntries || []) {
          stack.appendChild(createTimelineEvent(metaEntry));
        }
        for (const assistantEntry of entry.assistantEntries) {
          stack.appendChild(createTimelineEvent(assistantEntry));
        }
        if (entry.isActive) {
          stack.appendChild(createTimelineEvent(createThinkingEntry(`${entry.key}:thinking`, entry.threadId || '')));
        }
        if (stack.childNodes.length) {
          assistantRow.body.appendChild(stack);
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
      appendUserMessageContent(node, entry.content);
      const timestamp = createTimestampNode(entry.timestampMs);
      if (timestamp) {
        node.appendChild(timestamp);
      }
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
      const timestamp = createTimestampNode(entry.timestampMs);
      if (timestamp) {
        node.appendChild(timestamp);
      }
      return;
    }

    if (entry.kind === 'reasoning') {
      populateReasoningEntry(node, entry);
      return;
    }

    if (entry.kind === 'planItem') {
      populatePlanItemEntry(node, entry);
      return;
    }

    if (entry.kind === 'turnPlan') {
      populateTurnPlanEntry(node, entry);
      return;
    }

    if (entry.kind === 'turnDiff') {
      populateTurnDiffEntry(node, entry);
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

    if (entry.kind === 'mcpToolCall') {
      populateMcpToolCallEntry(node, entry);
      return;
    }

    if (entry.kind === 'dynamicToolCall') {
      populateDynamicToolCallEntry(node, entry);
      return;
    }

    if (entry.kind === 'collabToolCall') {
      populateCollabToolCallEntry(node, entry);
      return;
    }

    if (entry.kind === 'reviewMode') {
      populateReviewModeEntry(node, entry);
      return;
    }

    if (entry.kind === 'contextCompaction') {
      populateContextCompactionEntry(node, entry);
      return;
    }

    if (entry.kind === 'imageView') {
      populateImageViewEntry(node, entry);
      return;
    }

    if (entry.kind === 'serverRequest') {
      node.className = 'approval-banner approval-card';
      node.dataset.serverRequestId = entry.request?.requestId || '';
      populateServerRequestNode(node, entry.request);
      return;
    }

    if (entry.kind === 'permissionPrompt') {
      populatePermissionPromptEntry(node, entry);
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

  function formatFileChangeLineStats(change) {
    const addedLines = Math.max(0, Number.parseInt(change?.addedLines, 10) || 0);
    const deletedLines = Math.max(0, Number.parseInt(change?.deletedLines, 10) || 0);
    if (!addedLines && !deletedLines) {
      return '';
    }
    return ` (+${addedLines} / -${deletedLines})`;
  }

  function createFileChangeLineStatsNode(change) {
    const addedLines = Math.max(0, Number.parseInt(change?.addedLines, 10) || 0);
    const deletedLines = Math.max(0, Number.parseInt(change?.deletedLines, 10) || 0);
    if (!addedLines && !deletedLines) {
      return null;
    }

    const stats = document.createElement('span');
    stats.className = 'file-change-line-stats';
    stats.appendChild(document.createTextNode(' ('));

    const add = document.createElement('span');
    add.className = 'file-change-line-stats-add';
    add.textContent = `+${addedLines}`;
    stats.appendChild(add);

    stats.appendChild(document.createTextNode(' / '));

    const remove = document.createElement('span');
    remove.className = 'file-change-line-stats-delete';
    remove.textContent = `-${deletedLines}`;
    stats.appendChild(remove);

    stats.appendChild(document.createTextNode(')'));
    return stats;
  }

  function populateServerRequestNode(node, request) {
    const title = document.createElement('div');
    title.className = 'item-label';
    title.textContent = describeServerRequestTitle(request);
    node.appendChild(title);
    const timestamp = createTimestampNode(request.createdAt, 'approval-timestamp');
    if (timestamp) {
      node.appendChild(timestamp);
    }

    if (request.reason) {
      const reason = document.createElement('div');
      reason.className = 'approval-reason';
      reason.textContent = request.reason;
      node.appendChild(reason);
    }

    if (request.message && request.kind !== 'mcp_server_elicitation') {
      const message = document.createElement('div');
      message.className = 'approval-reason';
      message.textContent = request.message;
      node.appendChild(message);
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

    if (request.kind === 'file_change_approval' || request.kind === 'file_change_approval_legacy') {
      const patch = String(request.patch || '').trim();
      const normalizedChanges = normalizeFileChanges(
        request.changes,
        patch
      );

      if (normalizedChanges.length) {
        const changes = document.createElement('div');
        changes.className = 'file-change-list';
        normalizedChanges.forEach((change) => {
          const line = document.createElement('div');
          line.className = `file-change-entry kind-${getNormalizedFileChangeKind(change.kind)}`;
          line.appendChild(document.createTextNode(`${formatFileChangePrefix(change.kind)} ${change.path}`));
          const statsNode = createFileChangeLineStatsNode(change);
          if (statsNode) {
            line.appendChild(statsNode);
          }
          changes.appendChild(line);
        });
        node.appendChild(changes);
      }

      if (patch) {
        node.appendChild(createDiffBlock(patch));
      } else if (!normalizedChanges.length) {
        node.appendChild(createTimelinePlaceholder('等待文件变更详情…'));
      }
    }

    if (request.kind === 'user_input') {
      renderUserInputRequest(node, request);
      return;
    }

    if (request.kind === 'mcp_server_elicitation') {
      renderMcpElicitationRequest(node, request);
      return;
    }

    if (request.kind === 'dynamic_tool_call') {
      renderDynamicToolCallRequest(node, request);
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
      appendApprovalDecisionActions(actions, request, submitting);
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

  function renderDynamicToolCallRequest(node, request) {
    const toolTitle = request.namespace ? `${request.namespace}.${request.tool}` : request.tool;
    if (toolTitle) {
      const meta = document.createElement('div');
      meta.className = 'approval-meta';
      meta.textContent = `工具: ${toolTitle}`;
      node.appendChild(meta);
    }
    if (request.arguments && Object.keys(request.arguments).length) {
      node.appendChild(createTimelinePre(JSON.stringify(request.arguments, null, 2), 'timeline-inline-pre-output'));
    }

    const form = document.createElement('form');
    form.className = 'approval-form';
    const resultInput = document.createElement('textarea');
    resultInput.className = 'approval-text-input';
    resultInput.name = 'dynamic-tool-result';
    resultInput.rows = 6;
    resultInput.placeholder = '填写返回给 dynamic tool 的 JSON 数组，例如 [{\"type\":\"inputText\",\"text\":\"...\"}]';
    resultInput.disabled = request.status === 'submitting';
    form.appendChild(resultInput);

    const successLabel = document.createElement('label');
    successLabel.className = 'approval-option';
    const successInput = document.createElement('input');
    successInput.type = 'checkbox';
    successInput.name = 'dynamic-tool-success';
    successInput.checked = true;
    successInput.disabled = request.status === 'submitting';
    successLabel.appendChild(successInput);
    const successText = document.createElement('span');
    successText.textContent = '标记为成功';
    successLabel.appendChild(successText);
    form.appendChild(successLabel);

    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn';
    submitBtn.textContent = request.status === 'submitting' ? '提交中...' : '提交结果';
    submitBtn.disabled = request.status === 'submitting';
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      let contentItems = [];
      const raw = resultInput.value.trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            contentItems = parsed;
          } else {
            throw new Error('内容必须是数组');
          }
        } catch (error) {
          ensureItems(request.threadId || state.activeThreadId).push({
            type: '_error',
            id: createLocalId('dynamic-tool-parse'),
            text: `Dynamic tool 返回内容不是合法 JSON 数组：${error.message}`,
          });
          render();
          return;
        }
      }
      submitServerRequestResponse(request, {
        contentItems,
        success: !!successInput.checked,
      });
    });

    node.appendChild(form);
  }

  function renderMcpElicitationRequest(node, request) {
    if (request.serverName) {
      const serverMeta = document.createElement('div');
      serverMeta.className = 'approval-meta';
      serverMeta.textContent = `MCP 服务: ${request.serverName}`;
      node.appendChild(serverMeta);
    }
    if (request.message) {
      const desc = document.createElement('div');
      desc.className = 'approval-reason';
      desc.textContent = request.message;
      node.appendChild(desc);
    }

    if (request.mode === 'url') {
      if (request.url) {
        const link = document.createElement('a');
        link.href = request.url;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.className = 'approval-link';
        link.textContent = request.url;
        node.appendChild(link);
      }
      const actions = document.createElement('div');
      actions.className = 'approval-actions';
      const submitting = request.status === 'submitting';
      actions.appendChild(createActionButton('已完成，接受', submitting, () => {
        submitServerRequestResponse(request, {
          action: 'accept',
          content: null,
          _meta: request.meta,
        });
      }));
      actions.appendChild(createActionButton('拒绝', submitting, () => {
        submitServerRequestResponse(request, { action: 'decline', content: null });
      }, 'btn-secondary'));
      actions.appendChild(createActionButton('取消', submitting, () => {
        submitServerRequestResponse(request, { action: 'cancel', content: null });
      }, 'btn-secondary'));
      node.appendChild(actions);
      return;
    }

    const form = document.createElement('form');
    form.className = 'approval-form';
    const fields = buildMcpSchemaFields(request.requestedSchema);
    for (const field of fields) {
      form.appendChild(field.node);
    }
    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const submitting = request.status === 'submitting';
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn';
    submitBtn.textContent = submitting ? '提交中...' : '提交';
    submitBtn.disabled = submitting;
    actions.appendChild(submitBtn);
    actions.appendChild(createActionButton('拒绝', submitting, () => {
      submitServerRequestResponse(request, { action: 'decline', content: null });
    }, 'btn-secondary'));
    actions.appendChild(createActionButton('取消', submitting, () => {
      submitServerRequestResponse(request, { action: 'cancel', content: null });
    }, 'btn-secondary'));
    form.appendChild(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const content = {};
      for (const field of fields) {
        content[field.key] = field.read();
      }
      submitServerRequestResponse(request, {
        action: 'accept',
        content,
        _meta: request.meta,
      });
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
    if (request.kind === 'mcp_server_elicitation') {
      return request.mode === 'url' ? '⏳ MCP 链接确认' : '⏳ MCP 表单输入';
    }
    if (request.kind === 'dynamic_tool_call') {
      return '⏳ Dynamic Tool 调用';
    }
    return '⏳ 命令执行待批准';
  }

  function appendApprovalDecisionActions(actions, request, submitting) {
    const legacy = request.kind.startsWith('file_change_approval_legacy') || request.kind.startsWith('command_approval_legacy');
    const fallback = legacy
      ? ['approved', 'approved_for_session', 'denied']
      : ['accept', 'acceptForSession', 'decline'];
    const decisions = Array.isArray(request.availableDecisions) && request.availableDecisions.length
      ? request.availableDecisions
      : fallback;

    decisions.forEach((decision) => {
      const label = formatApprovalDecisionLabel(decision);
      if (!label) {
        return;
      }
      const isReject = decision === 'decline' || decision === 'denied' || decision === 'cancel';
      actions.appendChild(createActionButton(label, submitting, () => {
        submitServerRequestResponse(request, { decision });
      }, isReject ? 'btn-secondary' : ''));
    });
  }

  function formatApprovalDecisionLabel(decision) {
    if (decision === 'accept' || decision === 'approved') {
      return '批准';
    }
    if (decision === 'acceptForSession' || decision === 'approved_for_session') {
      return '本会话允许';
    }
    if (decision === 'decline' || decision === 'denied') {
      return '拒绝';
    }
    if (decision === 'cancel') {
      return '取消';
    }
    if (typeof decision === 'object' && decision) {
      if (decision.acceptWithExecpolicyAmendment) {
        return '按规则允许';
      }
      if (decision.applyNetworkPolicyAmendment) {
        return '应用网络规则';
      }
    }
    return '';
  }

  function normalizePlanStepStatus(status) {
    const raw = typeof status === 'string' ? status : '';
    const compact = raw.replace(/[\s_-]/g, '').toLowerCase();
    if (compact === 'inprogress') {
      return 'inProgress';
    }
    if (compact === 'completed') {
      return 'completed';
    }
    return 'pending';
  }

  function formatPlanStepStatus(status) {
    const normalized = normalizePlanStepStatus(status);
    if (normalized === 'completed') {
      return '已完成';
    }
    if (normalized === 'inProgress') {
      return '进行中';
    }
    return '待处理';
  }

  function buildMcpSchemaFields(schema) {
    const properties = schema && typeof schema === 'object' ? schema.properties : null;
    const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
    if (!properties || typeof properties !== 'object') {
      return [];
    }
    return Object.entries(properties).map(([key, spec]) => createMcpSchemaField(key, spec, required.has(key)));
  }

  function createMcpSchemaField(key, spec, isRequired) {
    const wrapper = document.createElement('div');
    wrapper.className = 'approval-question';
    const label = document.createElement('div');
    label.className = 'approval-question-header';
    label.textContent = spec?.title || key;
    wrapper.appendChild(label);
    if (spec?.description) {
      const desc = document.createElement('div');
      desc.className = 'approval-meta';
      desc.textContent = spec.description;
      wrapper.appendChild(desc);
    }

    if (Array.isArray(spec?.enum) && spec.enum.length) {
      const select = document.createElement('select');
      select.className = 'approval-text-input';
      const enumNames = Array.isArray(spec?.enumNames) ? spec.enumNames : [];
      spec.enum.forEach((value, index) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = enumNames[index] || value;
        if (value === spec.default) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      wrapper.appendChild(select);
      return { key, node: wrapper, read: () => select.value };
    }

    if (Array.isArray(spec?.oneOf) && spec.oneOf.length) {
      const select = document.createElement('select');
      select.className = 'approval-text-input';
      spec.oneOf.forEach((value) => {
        const option = document.createElement('option');
        option.value = value.const;
        option.textContent = value.title || value.const;
        if (value.const === spec.default) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      wrapper.appendChild(select);
      return { key, node: wrapper, read: () => select.value };
    }

    if (spec?.type === 'array' && Array.isArray(spec?.items?.enum) && spec.items.enum.length) {
      const optionList = document.createElement('div');
      optionList.className = 'approval-options approval-options-stacked';
      const selectedDefaults = new Set(Array.isArray(spec?.default) ? spec.default : []);
      const enumNames = Array.isArray(spec?.items?.enumNames) ? spec.items.enumNames : [];
      const checkboxes = spec.items.enum.map((value, index) => {
        const label = document.createElement('label');
        label.className = 'approval-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = value;
        checkbox.checked = selectedDefaults.has(value);
        label.appendChild(checkbox);
        const text = document.createElement('span');
        text.textContent = enumNames[index] || value;
        label.appendChild(text);
        optionList.appendChild(label);
        return checkbox;
      });
      wrapper.appendChild(optionList);
      return {
        key,
        node: wrapper,
        read: () => checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value),
      };
    }

    const titledArrayOptions = Array.isArray(spec?.items?.anyOf)
      ? spec.items.anyOf
      : (Array.isArray(spec?.items?.oneOf) ? spec.items.oneOf : []);
    if (spec?.type === 'array' && titledArrayOptions.length) {
      const optionList = document.createElement('div');
      optionList.className = 'approval-options approval-options-stacked';
      const selectedDefaults = new Set(Array.isArray(spec?.default) ? spec.default : []);
      const checkboxes = titledArrayOptions.map((value) => {
        const label = document.createElement('label');
        label.className = 'approval-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = value.const;
        checkbox.checked = selectedDefaults.has(value.const);
        label.appendChild(checkbox);
        const text = document.createElement('span');
        text.textContent = value.title || value.const;
        label.appendChild(text);
        optionList.appendChild(label);
        return checkbox;
      });
      wrapper.appendChild(optionList);
      return {
        key,
        node: wrapper,
        read: () => checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value),
      };
    }

    if (spec?.type === 'boolean') {
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'approval-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!spec.default;
      checkboxLabel.appendChild(checkbox);
      const text = document.createElement('span');
      text.textContent = isRequired ? '必填布尔值' : '布尔值';
      checkboxLabel.appendChild(text);
      wrapper.appendChild(checkboxLabel);
      return { key, node: wrapper, read: () => !!checkbox.checked };
    }

    const input = document.createElement(spec?.format === 'uri' || spec?.format === 'email' ? 'input' : 'textarea');
    input.className = 'approval-text-input';
    if (input instanceof HTMLInputElement) {
      input.type = spec?.format === 'email' ? 'email' : 'text';
      input.value = spec?.default == null ? '' : String(spec.default);
    } else {
      input.rows = spec?.type === 'string' ? 3 : 2;
      input.value = spec?.default == null ? '' : String(spec.default);
    }
    wrapper.appendChild(input);

    return {
      key,
      node: wrapper,
      read: () => {
        const raw = String(input.value || '').trim();
        if (!raw) {
          return spec?.type === 'number' || spec?.type === 'integer'
            ? null
            : '';
        }
        if (spec?.type === 'number') {
          const numberValue = Number(raw);
          return Number.isFinite(numberValue) ? numberValue : null;
        }
        if (spec?.type === 'integer') {
          const integerValue = Number.parseInt(raw, 10);
          return Number.isFinite(integerValue) ? integerValue : null;
        }
        return raw;
      },
    };
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
    if (isExecutionStatusActive(status)) {
      return '进行中';
    }
    return '执行中';
  }

  function isExecutionStatusActive(status) {
    const raw = typeof status === 'string' ? status : '';
    const compact = raw.replace(/[\s_-]/g, '').toLowerCase();
    return compact === 'running' || compact === 'inprogress';
  }

  function refreshLiveWorkingLabels() {
    const nodes = messagesEl.querySelectorAll('[data-live-working-thread-id]');
    nodes.forEach((node) => {
      const threadId = node.dataset.liveWorkingThreadId || '';
      node.textContent = threadId ? getTurnWorkingLabel(threadId) : '';
    });
  }

  return {
    focusServerRequestCard,
    forgetThread,
    handleMessagesScroll,
    jumpToBottom,
    refreshLiveWorkingLabels,
    renderMessages,
    submitServerRequestResponse,
  };
}

function flashSlashFocus(node) {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  node.classList.remove('slash-focus');
  void node.offsetWidth;
  node.classList.add('slash-focus');
  window.setTimeout(() => {
    node.classList.remove('slash-focus');
  }, 1800);
}
