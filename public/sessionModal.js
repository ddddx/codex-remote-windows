export function createSessionModalController(deps) {
  const {
    state,
    sessionModalState,
    elements,
    apiFetchJson,
    render,
    send,
    openTextModal,
    getDefaultWorkspacePath,
    getActiveComposerPrefs,
    normalizeComposerModel,
    normalizeComposerApprovalPolicy,
    normalizeComposerSandboxMode,
  } = deps;

  const {
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
  } = elements;

  let modalGeneration = 0;

  function isActiveModalGeneration(generation) {
    return sessionModalState.resolve && generation === modalGeneration;
  }

  function updateSessionWorkspacePath(path) {
    sessionWorkspaceInput.value = path || '';
  }

  function setSessionModalHint(text, isError = false) {
    sessionModalHint.textContent = text;
    sessionModalHint.classList.toggle('error', isError);
  }

  function renderSessionModal() {
    const shortcuts = sessionModalState.shortcuts || {};
    workspaceShortcutList.replaceChildren();

    const shortcutItems = [
      { label: '项目目录', path: shortcuts.projectRoot },
      { label: '桌面', path: shortcuts.desktopPath },
      { label: '上次使用', path: shortcuts.lastUsedPath },
      ...(Array.isArray(shortcuts.roots) ? shortcuts.roots.map((rootPath) => ({
        label: `磁盘 ${rootPath.replace(/[\\/]+$/, '')}`,
        path: rootPath,
      })) : []),
    ];

    shortcutItems.forEach((shortcut) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary workspace-shortcut';
      button.disabled = !shortcut.path || sessionModalState.loadingShortcuts || sessionModalState.browserLoading || sessionModalState.creatingWorkspace;

      const label = document.createElement('span');
      label.className = 'workspace-shortcut-label';
      label.textContent = `${shortcut.label}: ${shortcut.path || '不可用'}`;
      button.appendChild(label);

      button.addEventListener('click', async () => {
        if (!shortcut.path) {
          return;
        }
        updateSessionWorkspacePath(shortcut.path);
        await browseWorkspacePath(shortcut.path);
      });
      workspaceShortcutList.appendChild(button);
    });

    const busy = sessionModalState.loadingShortcuts || sessionModalState.browserLoading || sessionModalState.creatingWorkspace;
    sessionNameInput.disabled = busy;
    sessionWorkspaceInput.disabled = busy;
    browseWorkspaceBtn.disabled = busy;
    workspaceUpBtn.disabled = busy || !sessionModalState.browserParentPath;
    workspaceRefreshBtn.disabled = busy || !sessionModalState.browserPath;
    createWorkspaceBtn.disabled = busy;
    useCurrentWorkspaceBtn.disabled = busy || !sessionModalState.browserPath;
    sessionModalCancelBtn.disabled = busy;
    sessionModalConfirmBtn.disabled = busy;
    browseWorkspaceBtn.textContent = sessionModalState.browserLoading ? '加载中...' : '进入路径';
    createWorkspaceBtn.textContent = sessionModalState.creatingWorkspace ? '正在创建...' : '新建文件夹';

    workspaceBrowserPath.textContent = sessionModalState.browserPath || '尚未加载目录';
    workspaceBrowserList.replaceChildren();

    if (sessionModalState.browserLoading) {
      const loading = document.createElement('div');
      loading.className = 'workspace-browser-item empty';
      loading.textContent = '正在加载目录...';
      workspaceBrowserList.appendChild(loading);
      return;
    }

    if (!sessionModalState.browserEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'workspace-browser-item empty';
      empty.textContent = sessionModalState.browserPath ? '当前目录下没有子文件夹。' : '请选择一个工作区目录。';
      workspaceBrowserList.appendChild(empty);
      return;
    }

    sessionModalState.browserEntries.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'workspace-browser-item';
      button.title = entry.path;

      const icon = document.createElement('span');
      icon.className = 'workspace-browser-item-icon';
      icon.textContent = '📁';
      button.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'workspace-browser-item-label';
      label.textContent = entry.name;
      button.appendChild(label);

      button.addEventListener('click', async () => {
        updateSessionWorkspacePath(entry.path);
        await browseWorkspacePath(entry.path);
      });
      workspaceBrowserList.appendChild(button);
    });
  }

  async function browseWorkspacePath(targetPath = '', options = {}) {
    const generation = options.generation ?? modalGeneration;
    if (!isActiveModalGeneration(generation)) {
      return;
    }
    sessionModalState.browserLoading = true;
    renderSessionModal();
    setSessionModalHint('正在加载目录...');

    try {
      const url = new URL('/api/workspace/list', window.location.origin);
      if (targetPath) {
        url.searchParams.set('path', targetPath);
      }
      const result = await apiFetchJson(url);
      if (!isActiveModalGeneration(generation)) {
        return;
      }
      sessionModalState.browserPath = result.path || '';
      sessionModalState.browserParentPath = result.parentPath || '';
      sessionModalState.browserEntries = Array.isArray(result.entries) ? result.entries : [];
      updateSessionWorkspacePath(sessionModalState.browserPath);
      setSessionModalHint('已同步目录列表，可继续进入子目录或直接使用当前目录。');
    } catch (error) {
      if (!isActiveModalGeneration(generation)) {
        return;
      }
      setSessionModalHint(`读取目录失败：${error.message}`, true);
    } finally {
      if (!isActiveModalGeneration(generation)) {
        return;
      }
      sessionModalState.browserLoading = false;
      renderSessionModal();
    }
  }

  async function loadWorkspaceShortcuts(options = {}) {
    const generation = options.generation ?? modalGeneration;
    if (!isActiveModalGeneration(generation)) {
      return;
    }
    sessionModalState.loadingShortcuts = true;
    renderSessionModal();
    setSessionModalHint('正在读取常用工作区...');

    try {
      const shortcuts = await apiFetchJson('/api/workspace/shortcuts');
      if (!isActiveModalGeneration(generation)) {
        return;
      }
      sessionModalState.shortcuts = shortcuts;
      if (!sessionWorkspaceInput.value.trim()) {
        updateSessionWorkspacePath(getDefaultWorkspacePath(shortcuts));
      }
      setSessionModalHint('支持直接输入主机路径，也可以用下面的快捷路径。');
    } catch (error) {
      if (!isActiveModalGeneration(generation)) {
        return;
      }
      setSessionModalHint(`读取工作区失败：${error.message}`, true);
    } finally {
      if (!isActiveModalGeneration(generation)) {
        return;
      }
      sessionModalState.loadingShortcuts = false;
      renderSessionModal();
    }
  }

  function closeSessionModal(value) {
    if (!sessionModalState.resolve) {
      return;
    }

    const resolve = sessionModalState.resolve;
    sessionModalState.resolve = null;
    modalGeneration += 1;
    sessionModal.classList.remove('open');
    sessionModal.setAttribute('aria-hidden', 'true');
    resolve(value);

    if (sessionModalState.previousFocus && typeof sessionModalState.previousFocus.focus === 'function') {
      sessionModalState.previousFocus.focus();
    }
  }

  function openSessionModal(options = {}) {
    if (sessionModalState.resolve) {
      closeSessionModal(null);
    }

    modalGeneration += 1;
    const generation = modalGeneration;
    sessionModalState.previousFocus = document.activeElement;
    sessionModalState.shortcuts = null;
    sessionModalState.loadingShortcuts = false;
    sessionModalState.creatingWorkspace = false;
    sessionModalState.browserLoading = false;
    sessionModalState.browserPath = '';
    sessionModalState.browserParentPath = '';
    sessionModalState.browserEntries = [];
    sessionNameInput.value = '';
    updateSessionWorkspacePath('');
    setSessionModalHint('支持直接输入主机路径，也可以用下面的快捷路径。');
    renderSessionModal();
    sessionModal.classList.add('open');
    sessionModal.setAttribute('aria-hidden', 'false');

    const promise = new Promise((resolve) => {
      sessionModalState.resolve = resolve;
    });

    void (async () => {
      await loadWorkspaceShortcuts({ generation });
      if (!isActiveModalGeneration(generation)) {
        return;
      }
      const defaultPath = sessionWorkspaceInput.value.trim() || getDefaultWorkspacePath(sessionModalState.shortcuts);
      if (defaultPath) {
        await browseWorkspacePath(defaultPath, { generation });
      }
    })();

    window.setTimeout(() => {
      if (options.focusField === 'workspace') {
        sessionWorkspaceInput.focus();
        return;
      }
      sessionNameInput.focus();
    }, 0);

    return promise;
  }

  async function createWorkspaceOnHost() {
    if (sessionModalState.creatingWorkspace) {
      return;
    }

    const parentPath = sessionModalState.browserPath || sessionWorkspaceInput.value.trim() || getDefaultWorkspacePath(sessionModalState.shortcuts);
    if (!parentPath) {
      setSessionModalHint('请先输入或选择父目录，再新建文件夹。', true);
      sessionWorkspaceInput.focus();
      return;
    }

    const folderName = await openTextModal({
      title: '新建文件夹',
      label: '文件夹名称',
      placeholder: '请输入新文件夹名称',
      confirmText: '创建',
      inputType: 'text',
    });

    if (folderName === null) {
      return;
    }

    sessionModalState.creatingWorkspace = true;
    renderSessionModal();
    setSessionModalHint('正在主机上创建新文件夹...');

    try {
      const result = await apiFetchJson('/api/workspace/create-directory', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          parentPath,
          folderName,
        }),
      });

      if (result.path) {
        updateSessionWorkspacePath(result.path);
        if (sessionModalState.shortcuts) {
          sessionModalState.shortcuts.lastUsedPath = result.path;
        }
        setSessionModalHint('新工作区文件夹已创建。');
        await browseWorkspacePath(result.path);
      }
    } catch (error) {
      setSessionModalHint(`创建文件夹失败：${error.message}`, true);
    } finally {
      sessionModalState.creatingWorkspace = false;
      renderSessionModal();
    }
  }

  async function startNewSessionFlow(options = {}) {
    if (state.creatingTab) {
      return false;
    }

    const draft = await openSessionModal(options);
    if (draft === null) {
      return false;
    }

    state.creatingTab = true;
    render();
    const createPrefs = getActiveComposerPrefs();
    if (!send({
      type: 'tab_create',
      name: draft.name,
      cwd: draft.cwd,
      model: normalizeComposerModel(createPrefs?.model) || state.composerModelDefault || '',
      approvalPolicy: normalizeComposerApprovalPolicy(createPrefs?.approvalPolicy),
      sandboxMode: normalizeComposerSandboxMode(createPrefs?.sandboxMode),
    })) {
      state.creatingTab = false;
      render();
      return false;
    }
    if (window.innerWidth <= 680) {
      sidebar.classList.add('hidden');
      mainArea.classList.add('full');
    }
    return true;
  }

  return {
    browseWorkspacePath,
    closeSessionModal,
    createWorkspaceOnHost,
    loadWorkspaceShortcuts,
    openSessionModal,
    renderSessionModal,
    setSessionModalHint,
    startNewSessionFlow,
    updateSessionWorkspacePath,
  };
}
