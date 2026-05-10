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

export function createSlashController(deps) {
  const {
    state,
    sidebar,
    mainArea,
    composer,
    composerControlsToggle,
    promptInput,
    slashMenu,
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
  } = deps;

  const slashMenuState = {
    visible: false,
    query: '',
    items: [],
    activeIndex: 0,
  };

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

  function getExactSlashCommand(text) {
    const normalized = normalizeSlashToken(text);
    return SLASH_COMMANDS.find((command) => getSlashCommandTokens(command).includes(normalized)) || null;
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
      const connected = isSocketConnected() ? '已连接' : '未连接';
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

  function applySlashCommand(command) {
    if (!command) {
      return;
    }
    promptInput.value = command.name;
    closeSlashMenu();
    promptInput.focus();
    executeSlashCommand(command);
  }

  function handleDocumentClick(target) {
    if (!slashMenu.hidden && target !== promptInput && !slashMenu.contains(target)) {
      closeSlashMenu();
    }
  }

  function handlePromptKeydown(event) {
    if (slashMenuState.visible && slashMenuState.items.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        slashMenuState.activeIndex = (slashMenuState.activeIndex + 1) % slashMenuState.items.length;
        renderSlashMenu();
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        slashMenuState.activeIndex = (slashMenuState.activeIndex - 1 + slashMenuState.items.length) % slashMenuState.items.length;
        renderSlashMenu();
        return true;
      }
      if ((event.key === 'Enter' && !event.shiftKey && !event.isComposing) || event.key === 'Tab') {
        event.preventDefault();
        applySlashCommand(slashMenuState.items[slashMenuState.activeIndex]);
        return true;
      }
      if (event.key === 'Escape') {
        closeSlashMenu();
        return true;
      }
    }

    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return false;
    }

    event.preventDefault();
    composer.requestSubmit();
    return true;
  }

  function handlePromptInput() {
    autoResizePromptInput();
    updateSlashMenu();
    renderComposer();
  }

  function handlePromptFocus() {
    autoResizePromptInput();
    updateSlashMenu();
  }

  function handleComposerSubmit() {
    const text = promptInput.value.trim();
    const attachments = getComposerAttachments();
    if (!text && !attachments.length) {
      return false;
    }

    const slashCommand = attachments.length ? null : getExactSlashCommand(text);
    if (slashCommand) {
      if (canExecuteSlashCommandAfterSend(slashCommand) && state.activeThreadId && getComposerUploadCount() === 0) {
        submitTurnMessage(state.activeThreadId, text, attachments, {
          afterSend: () => {
            executeSlashCommand(slashCommand);
          },
        });
        return true;
      }
      executeSlashCommand(slashCommand);
      return true;
    }

    if (!state.activeThreadId || getComposerUploadCount() > 0) {
      return false;
    }

    submitTurnMessage(state.activeThreadId, text, attachments);
    return true;
  }

  return {
    addThreadNotice,
    applyPermissionPresetChoice,
    closeSlashMenu,
    handleComposerSubmit,
    handleDocumentClick,
    handlePromptFocus,
    handlePromptInput,
    handlePromptKeydown,
    openAdvancedPermissionSettings,
    showPermissionPresetPrompt,
    updateSlashMenu,
  };
}
