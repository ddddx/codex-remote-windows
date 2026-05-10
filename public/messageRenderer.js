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
    return { open: existing.open };
  }

  function applyDetailOpenState(details, preservedState, fallbackOpen) {
    if (!(details instanceof HTMLDetailsElement)) {
      return;
    }
    details.open = preservedState ? preservedState.open : !!fallbackOpen;
  }

  function populateCommandEntry(node, entry) {
    node.className = 'timeline-card timeline-card-command';
    const preservedState = preserveDetailOpenState(node, getDetailStateKey(entry, 'command'));

    const details = document.createElement('details');
    details.className = 'timeline-inline-detail-row';
    applyDetailOpenState(details, preservedState, entry.status === 'running' || entry.status === 'pendingApproval' || entry.status === 'failed');

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
    } else if (entry.status === 'running' || entry.status === 'pendingApproval') {
      body.appendChild(createTimelinePlaceholder(entry.status === 'pendingApproval' ? '等待批准后继续执行…' : '命令正在执行…'));
    }
    details.appendChild(body);

    node.appendChild(details);
  }

  function populateFileChangeEntry(node, entry) {
    node.className = 'timeline-card timeline-card-file-change';
    const preservedState = preserveDetailOpenState(node, getDetailStateKey(entry, 'fileChange'));

    const details = document.createElement('details');
    details.className = 'timeline-inline-detail-row';
    applyDetailOpenState(details, preservedState, entry.status === 'pendingApproval' || entry.status === 'running');

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
      line.textContent = `${formatFileChangePrefix(change.kind)} ${change.path}${formatFileChangeLineStats(change)}`;
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
      } else if (entry.assistantEntries.length) {
        meta.appendChild(createTurnBadge('已完成', 'done'));
      }
      node.appendChild(meta);

      if (entry.userEntry) {
        const userRow = createTranscriptRow('user');
        userRow.body.appendChild(createEntryElement(entry.userEntry));
        node.appendChild(userRow.row);
      }

      const shouldRenderAssistantRow = entry.assistantEntries.length > 0 || entry.isActive;
      if (shouldRenderAssistantRow) {
        const assistantRow = createTranscriptRow('assistant');
        const stack = document.createElement('div');
        stack.className = 'assistant-main-stack';
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
          line.textContent = `${formatFileChangePrefix(change.kind)} ${change.path}${formatFileChangeLineStats(change)}`;
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
