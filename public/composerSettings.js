const REASONING_EFFORT_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const APPROVAL_POLICY_OPTIONS = ['untrusted', 'on-request', 'never', 'on-failure'];
const SANDBOX_MODE_OPTIONS = ['read-only', 'workspace-write', 'danger-full-access'];
const THEME_OPTIONS = [
  { value: 'paper', label: '纸墨' },
  { value: 'bay', label: '海湾' },
  { value: 'night', label: '夜航' },
];
const PERMISSION_PRESET_VALUES = new Set(['', 'read-only', 'auto', 'full-access', 'custom']);

export function createComposerSettingsController(deps) {
  const {
    state,
    composer,
    composerControlsToggle,
    modelSelect,
    reasoningEffortSelect,
    permissionPresetSelect,
    approvalPolicySelect,
    sandboxModeSelect,
    themeSelect,
    composerPrefsStorageKey,
    themeStorageKey,
  } = deps;

  const customSelectControllers = new WeakMap();
  let activeCustomSelect = null;

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
      applyTheme(window.localStorage.getItem(themeStorageKey) || 'paper');
    } catch (_error) {
      applyTheme('paper');
    }
  }

  function saveThemePreference(theme) {
    const normalized = normalizeTheme(theme);
    applyTheme(normalized);
    try {
      window.localStorage.setItem(themeStorageKey, normalized);
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
      const parsed = JSON.parse(window.localStorage.getItem(composerPrefsStorageKey) || '{}');
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
      window.localStorage.setItem(composerPrefsStorageKey, JSON.stringify(state.composerGlobalPrefs));
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

  function positionCustomSelectMenu(controller = activeCustomSelect) {
    if (!controller) {
      return;
    }
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

  function openCustomSelectFor(selectEl) {
    const controller = ensureCustomSelect(selectEl);
    if (!controller || selectEl.disabled) {
      return;
    }
    openCustomSelect(controller);
  }

  function handleDocumentClick(target) {
    if (!(target instanceof Node)) {
      closeActiveCustomSelect();
      return;
    }
    if (activeCustomSelect && !activeCustomSelect.wrapper.contains(target)) {
      closeActiveCustomSelect();
    }
  }

  function initialize() {
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

    loadComposerGlobalPrefs();
    loadThemePreference();
  }

  return {
    applyPermissionPreset,
    buildApprovalPolicySelectOptions,
    buildComposerPrefs,
    buildEffortSelectOptions,
    buildModelSelectOptions,
    buildPermissionPresetSelectOptions,
    buildSandboxModeSelectOptions,
    closeActiveCustomSelect,
    fillSelectOptions,
    formatApprovalPolicyLabel,
    formatMobileComposerSummary,
    formatPermissionPresetLabel,
    formatReasoningEffortLabel,
    formatSandboxModeLabel,
    getActiveComposerPrefs,
    getModelDefinition,
    inferPermissionPresetValue,
    initialize,
    handleDocumentClick,
    normalizeComposerApprovalPolicy,
    normalizeComposerEffort,
    normalizeComposerModel,
    normalizeComposerSandboxMode,
    openCustomSelectFor,
    positionCustomSelectMenu,
    saveThemePreference,
    setComposerPrefsFromInputs,
    syncCustomSelect,
    themeOptions: THEME_OPTIONS,
  };
}
