import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodexOptionsResponse } from '@codex-remote/protocol';
import { ComposerDock } from '../features/composer/ComposerDock.js';
import { SessionRail } from '../features/sessions/SessionRail.js';
import { TimelineWorkspace } from '../features/timeline/TimelineWorkspace.js';
import { WorkspaceBrowser } from '../features/workspace/WorkspaceBrowser.js';
import { buildSessionNameFromPrompt, formatTokenUsageValue } from './view-helpers.js';
import { readStoredToken, writeStoredToken } from '../lib/storage.js';
import { useAppStore, mapServerMessageToStore, type ServerRequestItem } from '../store/appStore.js';
import { getHealth } from '../transport/http/health.js';
import { getCodexOptions } from '../transport/http/codex.js';
import { createSocketClient } from '../transport/ws/createSocketClient.js';

type ComposerPrefs = {
  model: string;
  reasoningEffort: string;
  approvalPolicy: string;
  sandboxMode: string;
};

type SessionDraft = {
  name: string;
  cwd: string;
};

const THEME_OPTIONS = [
  { value: 'paper', label: '纸墨' },
  { value: 'bay', label: '海湾' },
  { value: 'night', label: '夜航' },
];

const APPROVAL_POLICY_OPTIONS = ['untrusted', 'on-request', 'never', 'on-failure'];
const SANDBOX_MODE_OPTIONS = ['read-only', 'workspace-write', 'danger-full-access'];

function readThemePreference(): string {
  try {
    const saved = window.localStorage.getItem('codex-remote-theme') || '';
    return THEME_OPTIONS.some((item) => item.value === saved) ? saved : 'paper';
  } catch {
    return 'paper';
  }
}

function writeThemePreference(theme: string): string {
  const next = THEME_OPTIONS.some((item) => item.value === theme) ? theme : 'paper';
  try {
    window.localStorage.setItem('codex-remote-theme', next);
  } catch {
    // Ignore storage failures.
  }
  return next;
}

function normalizeModel(value: string): string {
  return value.trim();
}

function normalizeReasoningEffort(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(normalized) ? normalized : '';
}

function normalizeApprovalPolicy(value: string): string {
  const normalized = value.trim().toLowerCase();
  return APPROVAL_POLICY_OPTIONS.includes(normalized) ? normalized : '';
}

function normalizeSandboxMode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SANDBOX_MODE_OPTIONS.includes(normalized) ? normalized : '';
}

function formatReasoningEffortLabel(value: string): string {
  if (!value) {
    return '跟随当前配置';
  }
  if (value === 'none') {
    return '关闭';
  }
  if (value === 'minimal') {
    return '极低';
  }
  if (value === 'low') {
    return '低';
  }
  if (value === 'medium') {
    return '中';
  }
  if (value === 'high') {
    return '高';
  }
  if (value === 'xhigh') {
    return '超高';
  }
  return value;
}

function formatApprovalPolicyLabel(value: string): string {
  if (!value) {
    return '跟随当前配置';
  }
  if (value === 'untrusted') {
    return '仅不受信命令需批准';
  }
  if (value === 'on-request') {
    return '按需批准';
  }
  if (value === 'never') {
    return '从不询问';
  }
  if (value === 'on-failure') {
    return '失败后询问';
  }
  return value;
}

function formatSandboxModeLabel(value: string): string {
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
    return '完全权限';
  }
  return value;
}

function getPermissionPresetDefinition(value: string): { approvalPolicy: string; sandboxMode: string; label: string } | null {
  if (value === 'read-only') {
    return { approvalPolicy: 'on-request', sandboxMode: 'read-only', label: 'Read Only' };
  }
  if (value === 'auto') {
    return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', label: 'Auto' };
  }
  if (value === 'full-access') {
    return { approvalPolicy: 'on-request', sandboxMode: 'danger-full-access', label: 'Full Access' };
  }
  return null;
}

function inferPermissionPresetValue(approvalPolicy: string, sandboxMode: string): string {
  const normalizedApproval = normalizeApprovalPolicy(approvalPolicy);
  const normalizedSandbox = normalizeSandboxMode(sandboxMode);
  if (!normalizedApproval && !normalizedSandbox) {
    return '';
  }
  for (const value of ['read-only', 'auto', 'full-access']) {
    const preset = getPermissionPresetDefinition(value);
    if (preset && preset.approvalPolicy === normalizedApproval && preset.sandboxMode === normalizedSandbox) {
      return value;
    }
  }
  return 'custom';
}

function formatPermissionPresetLabel(value: string): string {
  if (!value) {
    return '跟随当前配置';
  }
  if (value === 'read-only') {
    return 'Read Only';
  }
  if (value === 'auto') {
    return 'Auto';
  }
  if (value === 'full-access') {
    return 'Full Access';
  }
  if (value === 'custom') {
    return '自定义';
  }
  return value;
}

function buildDefaultComposerPrefs(options: CodexOptionsResponse | null): ComposerPrefs {
  return {
    model: normalizeModel(options?.defaults.model || ''),
    reasoningEffort: normalizeReasoningEffort(options?.defaults.reasoningEffort || ''),
    approvalPolicy: normalizeApprovalPolicy(options?.defaults.approvalPolicy || ''),
    sandboxMode: normalizeSandboxMode(options?.defaults.sandboxMode || ''),
  };
}

function buildConnectionStatusLabel(status: string, healthStatus?: string): string {
  if (status === 'connected') {
    return '已连接';
  }
  if (status === 'connecting') {
    return '连接中';
  }
  if (status === 'auth_failed') {
    return '鉴权失败';
  }
  if (status === 'disconnected') {
    return '已断开';
  }
  if (healthStatus === 'ok') {
    return '服务正常';
  }
  return '空闲';
}

function buildSessionCreatePayload(draft: SessionDraft, prefs: ComposerPrefs) {
  return {
    type: 'tab_create' as const,
    name: draft.name.trim() || '',
    cwd: draft.cwd.trim() || '',
    model: prefs.model || undefined,
    approvalPolicy: prefs.approvalPolicy || undefined,
    sandboxMode: prefs.sandboxMode || undefined,
  };
}

function buildClientMessageId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const setHealthLoading = useAppStore((state) => state.setHealthLoading);
  const setHealthReady = useAppStore((state) => state.setHealthReady);
  const setHealthError = useAppStore((state) => state.setHealthError);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const setToken = useAppStore((state) => state.setToken);
  const setCodexOptionsLoading = useAppStore((state) => state.setCodexOptionsLoading);
  const setCodexOptionsReady = useAppStore((state) => state.setCodexOptionsReady);
  const setCodexOptionsError = useAppStore((state) => state.setCodexOptionsError);
  const setComposerPrefs = useAppStore((state) => state.setComposerPrefs);
  const health = useAppStore((state) => state.health.data);
  const healthError = useAppStore((state) => state.health.error);
  const token = useAppStore((state) => state.auth.token);
  const codexOptions = useAppStore((state) => state.codexOptions.data);
  const codexOptionsStatus = useAppStore((state) => state.codexOptions.status);
  const sessions = useAppStore((state) => state.sessions.items);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const approvals = useAppStore((state) => state.approvals.items);
  const connectionStatus = useAppStore((state) => state.connection.status);
  const connectionError = useAppStore((state) => state.connection.error);
  const appendTimelineEntry = useAppStore((state) => state.appendTimelineEntry);
  const clearAttachments = useAppStore((state) => state.clearAttachments);
  const notifications = useAppStore((state) => state.notifications.items);
  const dismissNotification = useAppStore((state) => state.dismissNotification);
  const workspaceSelectedPath = useAppStore((state) => state.workspace.selectedPath);
  const composerPrefsBySessionId = useAppStore((state) => state.composer.prefsBySessionId);
  const tokenUsageBySessionId = useAppStore((state) => state.tokenUsage.bySessionId);

  const [draft, setDraft] = useState('');
  const [queuedPrompt, setQueuedPrompt] = useState('');
  const [composerError, setComposerError] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 680));
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 680));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>({ name: '', cwd: '' });
  const [sessionBrowserPath, setSessionBrowserPath] = useState('');
  const [theme, setTheme] = useState(readThemePreference);
  const [tokenPromptOpen, setTokenPromptOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [composerPrefsDraft, setComposerPrefsDraft] = useState<ComposerPrefs>(() => buildDefaultComposerPrefs(null));
  const [composerControlsOpen, setComposerControlsOpen] = useState(false);
  const [composerResetSignal, setComposerResetSignal] = useState(0);
  const sessionNameInputRef = useRef<HTMLInputElement | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);

  const resolvedActiveSessionId = activeSessionId;
  const activeSession = sessions.find((item) => item.threadId === resolvedActiveSessionId) || null;
  const pendingApprovals = resolvedActiveSessionId
    ? approvals.filter((item) => item.threadId === resolvedActiveSessionId).length
    : approvals.length;
  const activeUsage = resolvedActiveSessionId
    ? (tokenUsageBySessionId[resolvedActiveSessionId] ?? activeSession?.tokenUsage ?? null)
    : null;
  const activePrefs = useMemo(() => {
    if (!resolvedActiveSessionId) {
      return composerPrefsDraft;
    }
    return composerPrefsBySessionId[resolvedActiveSessionId] || composerPrefsDraft;
  }, [resolvedActiveSessionId, composerPrefsBySessionId, composerPrefsDraft]);

  const socketClient = useMemo(() => createSocketClient({
    onMessage: (message) => {
      mapServerMessageToStore(message);
    },
    onStatusChange: (status, error) => {
      setConnectionStatus(status, error);
    },
  }), [setConnectionStatus]);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    function syncSidebarMode() {
      const nextDesktop = window.innerWidth > 680;
      setIsDesktopViewport(nextDesktop);
      if (nextDesktop) {
        setSidebarOpen(true);
        setMobileSidebarOpen(false);
      }
    }

    syncSidebarMode();
    window.addEventListener('resize', syncSidebarMode);
    return () => {
      window.removeEventListener('resize', syncSidebarMode);
    };
  }, []);

  useEffect(() => {
    setToken(readStoredToken());
  }, [setToken]);

  useEffect(() => {
    let cancelled = false;
    setHealthLoading();
    getHealth()
      .then((result) => {
        if (!cancelled) {
          setHealthReady(result);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setHealthError(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setHealthError, setHealthLoading, setHealthReady]);

  useEffect(() => {
    if (!token) {
      socketClient.disconnect();
      return;
    }
    void socketClient.connect(token);
    return () => {
      socketClient.disconnect();
    };
  }, [socketClient, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setCodexOptionsLoading();
    getCodexOptions(token, workspaceSelectedPath || workspacePath || undefined)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCodexOptionsReady(result);
        setComposerPrefsDraft((current) => ({
          model: current.model || normalizeModel(result.defaults.model || ''),
          reasoningEffort: current.reasoningEffort || normalizeReasoningEffort(result.defaults.reasoningEffort || ''),
          approvalPolicy: current.approvalPolicy || normalizeApprovalPolicy(result.defaults.approvalPolicy || ''),
          sandboxMode: current.sandboxMode || normalizeSandboxMode(result.defaults.sandboxMode || ''),
        }));
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setCodexOptionsError(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setCodexOptionsError, setCodexOptionsLoading, setCodexOptionsReady, token, workspacePath, workspaceSelectedPath]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    socketClient.send({
      type: 'thread_sync',
      threadId: activeSessionId,
    });
  }, [activeSessionId, socketClient]);

  useEffect(() => {
    if (!queuedPrompt.trim() || !activeSessionId) {
      return;
    }
    const clientMessageId = buildClientMessageId();
    const attachments = useAppStore.getState().composer.attachmentsBySessionId[activeSessionId] || [];
    const sent = socketClient.send({
      type: 'turn_send',
      threadId: activeSessionId,
      text: queuedPrompt,
      clientMessageId,
      attachments: attachments.map((item) => ({
        path: item.filePath,
        name: item.name,
      })),
      model: activePrefs.model || undefined,
      effort: activePrefs.reasoningEffort || undefined,
      approvalPolicy: activePrefs.approvalPolicy || undefined,
      sandboxMode: activePrefs.sandboxMode || undefined,
    });
    if (sent) {
      appendTimelineEntry(activeSessionId, {
        id: `local-user:${clientMessageId}`,
        type: 'message',
        role: 'user',
        turnId: `${activeSessionId}:pending-turn`,
        text: queuedPrompt,
        createdAt: Date.now(),
      });
      setQueuedPrompt('');
      setComposerError('');
      setDraft('');
      setComposerResetSignal((value) => value + 1);
      clearAttachments(activeSessionId);
    } else {
      setComposerError('发送暂存消息失败。');
    }
  }, [activePrefs, activeSessionId, appendTimelineEntry, clearAttachments, queuedPrompt, socketClient]);

  useEffect(() => {
    if (!sessionModalOpen) {
      return;
    }
    window.setTimeout(() => {
      sessionNameInputRef.current?.focus();
    }, 0);
  }, [sessionModalOpen]);

  useEffect(() => {
    if (!tokenPromptOpen) {
      return;
    }
    window.setTimeout(() => {
      tokenInputRef.current?.focus();
      tokenInputRef.current?.select();
    }, 0);
  }, [tokenPromptOpen]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    if (!composerPrefsBySessionId[activeSessionId]) {
      const session = sessions.find((item) => item.threadId === activeSessionId);
      setComposerPrefs(activeSessionId, {
        model: normalizeModel(session?.model || '') || composerPrefsDraft.model,
        reasoningEffort: normalizeReasoningEffort(session?.reasoningEffort || '') || composerPrefsDraft.reasoningEffort,
        approvalPolicy: normalizeApprovalPolicy(session?.approvalPolicy || '') || composerPrefsDraft.approvalPolicy,
        sandboxMode: normalizeSandboxMode(session?.sandboxMode || '') || composerPrefsDraft.sandboxMode,
      });
    }
  }, [activeSessionId, composerPrefsBySessionId, composerPrefsDraft, sessions, setComposerPrefs]);

  function submitComposer() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    if (!token) {
      setComposerError('请先设置访问 Token。');
      setTokenPromptOpen(true);
      setTokenDraft(token);
      return;
    }
    if (connectionStatus === 'auth_failed') {
      setComposerError('鉴权失败，请先更新 Token。');
      return;
    }

    setComposerError('');

    if (!activeSessionId) {
      setDraft(text);
      setSessionDraft({
        name: buildSessionNameFromPrompt(text),
        cwd: workspacePath || workspaceSelectedPath || '',
      });
      setSessionBrowserPath(workspacePath || workspaceSelectedPath || '');
      setSessionModalOpen(true);
      return;
    }

    const clientMessageId = buildClientMessageId();
    const attachments = useAppStore.getState().composer.attachmentsBySessionId[activeSessionId] || [];
    const sent = socketClient.send({
      type: 'turn_send',
      threadId: activeSessionId,
      text,
      clientMessageId,
      attachments: attachments.map((item) => ({
        path: item.filePath,
        name: item.name,
      })),
      model: activePrefs.model || undefined,
      effort: activePrefs.reasoningEffort || undefined,
      approvalPolicy: activePrefs.approvalPolicy || undefined,
      sandboxMode: activePrefs.sandboxMode || undefined,
    });

    if (!sent) {
      setComposerError('发送消息失败。');
      return;
    }

    appendTimelineEntry(activeSessionId, {
      id: `local-user:${clientMessageId}`,
      type: 'message',
      role: 'user',
      turnId: `${activeSessionId}:pending-turn`,
      text,
      createdAt: Date.now(),
    });
    setDraft('');
    setComposerResetSignal((value) => value + 1);
    clearAttachments(activeSessionId);
  }

  function createSessionAndQueuePrompt() {
    if (!token) {
      setComposerError('请先设置访问 Token。');
      return;
    }
    const payload = buildSessionCreatePayload({
      name: sessionDraft.name,
      cwd: sessionDraft.cwd || workspacePath || workspaceSelectedPath || '',
    }, composerPrefsDraft);
    if (!payload.cwd) {
      setComposerError('请先选择工作区目录。');
      return;
    }
    const created = socketClient.send(payload);
    if (!created) {
      setComposerError('创建会话失败。');
      return;
    }
    setSessionModalOpen(false);
    setQueuedPrompt(draft.trim());
  }

  function respondApproval(request: ServerRequestItem, response: unknown) {
    const sent = socketClient.send({
      type: 'server_request_respond',
      requestId: request.requestId,
      response,
    });

    if (!sent) {
      setComposerError('提交审批响应失败。');
    }
  }

  function handleThemeChange(value: string) {
    const next = writeThemePreference(value);
    setTheme(next);
  }

  function handleTokenSave() {
    const nextToken = writeStoredToken(tokenDraft);
    setToken(nextToken);
    setTokenPromptOpen(false);
  }

  function updateComposerPrefs(next: Partial<ComposerPrefs>) {
    const current = activeSessionId ? (composerPrefsBySessionId[activeSessionId] || composerPrefsDraft) : composerPrefsDraft;
    const merged: ComposerPrefs = {
      model: Object.prototype.hasOwnProperty.call(next, 'model') ? normalizeModel(next.model || '') : current.model,
      reasoningEffort: Object.prototype.hasOwnProperty.call(next, 'reasoningEffort') ? normalizeReasoningEffort(next.reasoningEffort || '') : current.reasoningEffort,
      approvalPolicy: Object.prototype.hasOwnProperty.call(next, 'approvalPolicy') ? normalizeApprovalPolicy(next.approvalPolicy || '') : current.approvalPolicy,
      sandboxMode: Object.prototype.hasOwnProperty.call(next, 'sandboxMode') ? normalizeSandboxMode(next.sandboxMode || '') : current.sandboxMode,
    };
    if (activeSessionId) {
      setComposerPrefs(activeSessionId, merged);
    } else {
      setComposerPrefsDraft(merged);
    }
  }

  function applyPermissionPreset(value: string) {
    if (!value) {
      updateComposerPrefs({ approvalPolicy: '', sandboxMode: '' });
      return;
    }
    const preset = getPermissionPresetDefinition(value);
    if (!preset) {
      return;
    }
    updateComposerPrefs({
      approvalPolicy: preset.approvalPolicy,
      sandboxMode: preset.sandboxMode,
    });
  }

  const activeTitle = activeSession?.name || 'Codex Remote Control';
  const connectionLabel = buildConnectionStatusLabel(connectionStatus, health?.status);
  const unreadWarning = pendingApprovals > 0;
  const permissionPresetValue = inferPermissionPresetValue(activePrefs.approvalPolicy, activePrefs.sandboxMode);
  const composerControlsSummary = [
    activePrefs.model || normalizeModel(codexOptions?.defaults.model || '') || '默认模型',
    formatReasoningEffortLabel(activePrefs.reasoningEffort || normalizeReasoningEffort(codexOptions?.defaults.reasoningEffort || '')),
    formatPermissionPresetLabel(permissionPresetValue),
  ].join(' · ');

  return (
    <>
      <div className="bg"></div>
      <main className="app">
        {mobileSidebarOpen && !isDesktopViewport ? (
          <button
            type="button"
            className="sidebar-scrim"
            aria-label="收起会话列表"
            onClick={() => {
              setMobileSidebarOpen(false);
            }}
          />
        ) : null}
        <aside className={`sidebar${sidebarOpen ? '' : ' hidden'}${mobileSidebarOpen && !isDesktopViewport ? ' mobile-open' : ''}`}>
          <div className="sidebar-header">
            <h2>会话</h2>
            <button
              id="sidebarClose"
              className="btn-icon"
              type="button"
              onClick={() => {
                if (!isDesktopViewport) {
                  setMobileSidebarOpen(false);
                  return;
                }
              }}
            >
              ✕
            </button>
          </div>
          <SessionRail
            onNewSession={() => {
              setSessionDraft({
                name: '',
                cwd: workspacePath || workspaceSelectedPath || '',
              });
              setSessionBrowserPath(workspacePath || workspaceSelectedPath || '');
              setSessionModalOpen(true);
            }}
          />
        </aside>

        <div className={`main-area${sidebarOpen ? '' : ' full'}`}>
          <header className="topbar">
            <button
              id="menuBtn"
              className={`btn-icon${unreadWarning ? ' has-unread' : ''}`}
              type="button"
              onClick={() => {
                if (!isDesktopViewport) {
                  setMobileSidebarOpen((value) => !value);
                  return;
                }
                setSidebarOpen(true);
              }}
            >
              ☰
            </button>
            <h1 id="activeTitle">{activeTitle}</h1>
            <div className="topbar-tools">
              <div id="contextUsage" className={`context-usage${activeUsage ? '' : ' is-empty'}`}>
                <span className="context-usage-label">用量</span>
                <strong>{formatTokenUsageValue(activeUsage)}</strong>
              </div>
              <label className="theme-select-group" htmlFor="themeSelect">
                <span className="sr-only">主题</span>
                <select id="themeSelect" aria-label="主题" value={theme} onChange={(event) => handleThemeChange(event.target.value)}>
                  {THEME_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <button
                id="tokenBtn"
                className="btn btn-secondary btn-inline topbar-action"
                type="button"
                onClick={() => {
                  setTokenDraft(token);
                  setTokenPromptOpen(true);
                }}
              >
                Token
              </button>
              <span id="activeStatus" className={`status-badge${connectionStatus === 'connected' ? '' : ' waiting'}`}>
                {connectionLabel}
              </span>
            </div>
          </header>

          <section className="panel">
            <div className="toast-stack" aria-live="polite" aria-atomic="false">
              {notifications.map((notice) => (
                <article key={notice.id} className={`toast toast-${notice.level}`}>
                  <div className="toast-body">
                    <strong>{notice.title}</strong>
                    <div>{notice.message}</div>
                  </div>
                  <button
                    type="button"
                    className="toast-close"
                    aria-label="关闭通知"
                    onClick={() => dismissNotification(notice.id)}
                  >
                    ✕
                  </button>
                </article>
              ))}
            </div>
            {(healthError || connectionError) ? (
              <div className="status error">{healthError || connectionError}</div>
            ) : null}
            <TimelineWorkspace
              onRespondApproval={respondApproval}
            />
            <ComposerDock
              draft={draft}
              setDraft={setDraft}
              submit={submitComposer}
              resetSignal={composerResetSignal}
              busy={Boolean(queuedPrompt)}
              composerError={composerError}
              workspacePath={workspacePath}
              setWorkspacePath={setWorkspacePath}
              tokenReady={Boolean(token)}
              activeSessionId={resolvedActiveSessionId}
              controlsOpen={composerControlsOpen}
              setControlsOpen={setComposerControlsOpen}
              prefs={activePrefs}
              composerControlsSummary={composerControlsSummary}
              onPrefsChange={updateComposerPrefs}
              onPresetChange={applyPermissionPreset}
              permissionPresetValue={permissionPresetValue}
              modelOptions={codexOptions?.models || []}
              defaults={buildDefaultComposerPrefs(codexOptions)}
              optionsStatus={codexOptionsStatus}
            />
          </section>
        </div>
      </main>

      <div className={`modal${tokenPromptOpen ? ' open' : ''}`} aria-hidden={tokenPromptOpen ? 'false' : 'true'}>
        <div className="modal-backdrop" onClick={() => setTokenPromptOpen(false)}></div>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="tokenModalTitle">
          <h2 id="tokenModalTitle" className="modal-title">设置 WebSocket Token</h2>
          <label className="modal-label" htmlFor="tokenInput">访问 Token</label>
          <input
            ref={tokenInputRef}
            id="tokenInput"
            className="modal-input"
            type="password"
            placeholder="请输入服务端配置的 WS_TOKEN"
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleTokenSave();
              }
            }}
          />
          <div className="modal-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setTokenPromptOpen(false)}>取消</button>
            <button className="btn" type="button" onClick={handleTokenSave}>保存并重连</button>
          </div>
        </div>
      </div>

      <div className={`modal${sessionModalOpen ? ' open' : ''}`} aria-hidden={sessionModalOpen ? 'false' : 'true'}>
        <div className="modal-backdrop" data-session-modal-close="true" onClick={() => setSessionModalOpen(false)}></div>
        <div className="modal-card session-modal-card" role="dialog" aria-modal="true" aria-labelledby="sessionModalTitle">
          <form
            className="session-modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              createSessionAndQueuePrompt();
            }}
          >
            <div className="session-modal-topbar">
              <h2 id="sessionModalTitle" className="modal-title">新建会话</h2>
              <button className="btn btn-secondary btn-inline session-modal-top-close" type="button" onClick={() => setSessionModalOpen(false)}>关闭</button>
            </div>

            <div className="session-modal-body">
              <label className="modal-label" htmlFor="sessionNameInput">会话名称</label>
              <input
                ref={sessionNameInputRef}
                id="sessionNameInput"
                className="modal-input"
                type="text"
                maxLength={120}
                placeholder="可留空"
                value={sessionDraft.name}
                onChange={(event) => setSessionDraft((state) => ({ ...state, name: event.target.value }))}
              />

              <label className="modal-label session-workspace-label" htmlFor="sessionWorkspaceInput">工作区目录</label>
              <div className="session-path-row">
                <input
                  id="sessionWorkspaceInput"
                  className="modal-input session-path-input"
                  type="text"
                  placeholder="请输入或选择主机上的工作区目录"
                  value={sessionDraft.cwd}
                  onChange={(event) => setSessionDraft((state) => ({ ...state, cwd: event.target.value }))}
                />
                <button className="btn btn-secondary" type="button">进入路径</button>
              </div>

              <div className="session-workspace-actions">
                <button className="btn btn-secondary" type="button">上级目录</button>
                <button className="btn btn-secondary" type="button">刷新</button>
                <button className="btn btn-secondary" type="button">新建文件夹</button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setSessionDraft((state) => ({ ...state, cwd: sessionBrowserPath || workspaceSelectedPath || workspacePath || state.cwd }))}
                >
                  使用当前目录
                </button>
              </div>

              <WorkspaceBrowser
                token={token}
                selectedPath={sessionBrowserPath || sessionDraft.cwd || workspaceSelectedPath || workspacePath}
                onSelectPath={setSessionBrowserPath}
                embedded
              />

              <div className="modal-label session-modal-hint">支持直接输入主机路径，也可以在下面选择目录。</div>
            </div>

            <div className="modal-actions session-modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setSessionModalOpen(false)}>取消</button>
              <button className="btn" type="submit">创建</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
