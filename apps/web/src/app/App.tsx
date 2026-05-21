import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthSession, CodexOptionsResponse, HealthResponse } from '@codex-remote/protocol';
import { ComposerDock } from '../features/composer/ComposerDock.js';
import { SessionRail } from '../features/sessions/SessionRail.js';
import { TimelineWorkspace } from '../features/timeline/TimelineWorkspace.js';
import { WorkspaceBrowser } from '../features/workspace/WorkspaceBrowser.js';
import { buildSessionNameFromPrompt, buildTokenUsageDisplay } from './view-helpers.js';
import {
  readOrCreateDeviceId,
  readStoredActiveSessionId,
  readStoredToken,
  writeStoredActiveSessionId,
  writeStoredToken,
} from '../lib/storage.js';
import { useAppStore, mapServerMessageToStore, type ServerRequestItem } from '../store/appStore.js';
import { createAuthSession, listAuthSessions, revokeAuthSession } from '../transport/http/auth.js';
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
const DEFAULT_REASONING_EFFORT = 'medium';
const DEFAULT_APPROVAL_POLICY = 'on-request';
const DEFAULT_SANDBOX_MODE = 'workspace-write';

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

function normalizeAvailableModel(value: string, options: CodexOptionsResponse | null): string {
  const normalized = normalizeModel(value);
  if (!normalized || !options?.models?.length) {
    return normalized;
  }
  return options.models.some((item) => item.model === normalized || item.id === normalized) ? normalized : '';
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
    return '未设置';
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
    return '未设置';
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
    return '未设置';
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
    return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', label: 'Default' };
  }
  if (value === 'full-access') {
    return { approvalPolicy: 'never', sandboxMode: 'danger-full-access', label: 'Full Access' };
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
  return '';
}

function formatPermissionPresetLabel(value: string): string {
  if (!value) {
    return '未设置';
  }
  if (value === 'read-only') {
    return 'Read Only';
  }
  if (value === 'auto') {
    return 'Default';
  }
  if (value === 'full-access') {
    return 'Full Access';
  }
  return value;
}

function formatPermissionPresetSummary(value: string, approvalPolicy: string, sandboxMode: string): string {
  if (value) {
    return formatPermissionPresetLabel(value);
  }
  if (approvalPolicy && sandboxMode) {
    return `${formatApprovalPolicyLabel(approvalPolicy)} / ${formatSandboxModeLabel(sandboxMode)}`;
  }
  return '未设置';
}

function buildDefaultComposerPrefs(options: CodexOptionsResponse | null): ComposerPrefs {
  return {
    model: normalizeModel(options?.defaults.model || ''),
    reasoningEffort: normalizeReasoningEffort(options?.defaults.reasoningEffort || DEFAULT_REASONING_EFFORT),
    approvalPolicy: normalizeApprovalPolicy(options?.defaults.approvalPolicy || DEFAULT_APPROVAL_POLICY),
    sandboxMode: normalizeSandboxMode(options?.defaults.sandboxMode || DEFAULT_SANDBOX_MODE),
  };
}

function buildConnectionStatusTone(status: string, healthStatus?: string): 'connected' | 'waiting' | 'error' {
  if (status === 'connected') {
    return 'connected';
  }
  if (status === 'auth_failed' || status === 'disconnected') {
    return 'error';
  }
  if (healthStatus === 'ok' && status === 'idle') {
    return 'connected';
  }
  return 'waiting';
}

function buildDeviceName(): string {
  if (typeof navigator === 'undefined') {
    return '当前设备';
  }
  const platform = typeof navigator.platform === 'string' ? navigator.platform.trim() : '';
  const userAgent = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)
          ? 'Safari'
          : '浏览器';
  return [platform || '设备', browser].filter(Boolean).join(' · ');
}

function buildSessionCreatePayload(draft: SessionDraft, prefs: ComposerPrefs) {
  return {
    type: 'tab_create' as const,
    name: draft.name.trim() || '',
    cwd: draft.cwd.trim() || '',
    model: prefs.model || undefined,
    effort: prefs.reasoningEffort || undefined,
    approvalPolicy: prefs.approvalPolicy || undefined,
    sandboxMode: prefs.sandboxMode || undefined,
  };
}

function buildPrefsSignature(prefs: ComposerPrefs): string {
  return [
    prefs.model || '',
    prefs.reasoningEffort || '',
    prefs.approvalPolicy || '',
    prefs.sandboxMode || '',
  ].join('\u001f');
}

function buildClientMessageId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isComposerCommand(text: string): boolean {
  return text.startsWith('/') || text.startsWith('!');
}

function useRefreshHealth(
  token: string,
  connectionStatus: string,
  setHealthLoading: () => void,
  setHealthReady: (data: HealthResponse) => void,
  setHealthError: (message: string) => void,
) {
  useEffect(() => {
    if (!token || connectionStatus !== 'connected') {
      return;
    }
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
  }, [connectionStatus, setHealthError, setHealthLoading, setHealthReady, token]);
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
  const setActiveSession = useAppStore((state) => state.setActiveSession);
  const upsertServerRequest = useAppStore((state) => state.upsertServerRequest);
  const health = useAppStore((state) => state.health.data);
  const healthError = useAppStore((state) => state.health.error);
  const token = useAppStore((state) => state.auth.token);
  const codexOptions = useAppStore((state) => state.codexOptions.data);
  const codexOptionsStatus = useAppStore((state) => state.codexOptions.status);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const sessionItems = useAppStore((state) => state.sessions.items);
  const connectionStatus = useAppStore((state) => state.connection.status);
  const connectionError = useAppStore((state) => state.connection.error);
  const appendTimelineEntry = useAppStore((state) => state.appendTimelineEntry);
  const clearAttachments = useAppStore((state) => state.clearAttachments);
  const notifications = useAppStore((state) => state.notifications.items);
  const dismissNotification = useAppStore((state) => state.dismissNotification);
  const workspaceSelectedPath = useAppStore((state) => state.workspace.selectedPath);

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
  const [authReady, setAuthReady] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authSessions, setAuthSessions] = useState<AuthSession[]>([]);
  const [authSessionsLoading, setAuthSessionsLoading] = useState(false);
  const [authSessionsError, setAuthSessionsError] = useState('');
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [composerPrefsDraft, setComposerPrefsDraft] = useState<ComposerPrefs>(() => buildDefaultComposerPrefs(null));
  const [composerControlsOpen, setComposerControlsOpen] = useState(false);
  const [composerResetSignal, setComposerResetSignal] = useState(0);
  const previousConnectionStatusRef = useRef(connectionStatus);
  const needsForegroundThreadSyncRef = useRef(false);
  const lastSyncedPrefsRef = useRef<Record<string, string>>({});
  const sessionNameInputRef = useRef<HTMLInputElement | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const deviceIdRef = useRef(readOrCreateDeviceId());
  const storedActiveSessionIdRef = useRef(readStoredActiveSessionId());

  const resolvedActiveSessionId = activeSessionId;
  const activeSession = useAppStore((state) => (
    resolvedActiveSessionId
      ? state.sessions.items.find((item) => item.threadId === resolvedActiveSessionId) || null
      : null
  ));
  const pendingApprovals = useAppStore((state) => (
    resolvedActiveSessionId
      ? state.approvals.items.filter((item) => item.threadId === resolvedActiveSessionId).length
      : state.approvals.items.length
  ));
  const activeSessionPrefs = useAppStore((state) => (
    resolvedActiveSessionId
      ? state.composer.prefsBySessionId[resolvedActiveSessionId]
      : undefined
  ));
  const activeUsage = useAppStore((state) => (
    resolvedActiveSessionId
      ? (state.tokenUsage.bySessionId[resolvedActiveSessionId] ?? state.sessions.items.find((item) => item.threadId === resolvedActiveSessionId)?.tokenUsage ?? null)
      : null
  ));
  const activePrefs = useMemo(() => {
    const normalizePrefs = (prefs: ComposerPrefs): ComposerPrefs => ({
      ...prefs,
      model: normalizeAvailableModel(prefs.model, codexOptions),
    });
    if (!resolvedActiveSessionId) {
      return normalizePrefs(composerPrefsDraft);
    }
    return normalizePrefs(activeSessionPrefs || composerPrefsDraft);
  }, [resolvedActiveSessionId, activeSessionPrefs, composerPrefsDraft, codexOptions]);

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
    if (activeSessionId) {
      storedActiveSessionIdRef.current = writeStoredActiveSessionId(activeSessionId);
      return;
    }
    if (!sessionItems.length) {
      return;
    }
    const storedThreadId = storedActiveSessionIdRef.current || readStoredActiveSessionId();
    if (!storedThreadId) {
      return;
    }
    if (sessionItems.some((item) => item.threadId === storedThreadId)) {
      setActiveSession(storedThreadId);
      return;
    }
    storedActiveSessionIdRef.current = writeStoredActiveSessionId('');
  }, [activeSessionId, sessionItems, setActiveSession]);

  useEffect(() => {
    if (!token) {
      setAuthReady(false);
      socketClient.setAuthorized(false);
      return;
    }
    setAuthPending(true);
    setAuthSessionsError('');
    createAuthSession(token, buildDeviceName(), deviceIdRef.current)
      .then(() => {
        setAuthReady(true);
      })
      .catch((error: Error) => {
        setAuthReady(false);
        setAuthSessionsError(error.message);
      })
      .finally(() => {
        setAuthPending(false);
      });
  }, [socketClient, token]);

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

  useRefreshHealth(token, connectionStatus, setHealthLoading, setHealthReady, setHealthError);

  useEffect(() => {
    socketClient.setAuthorized(authReady);
    if (!authReady) {
      return;
    }
    void socketClient.connect();
    return () => {
      socketClient.disconnect(false);
    };
  }, [authReady, socketClient]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    let cancelled = false;
    setCodexOptionsLoading();
    getCodexOptions(workspaceSelectedPath || workspacePath || undefined)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCodexOptionsReady(result);
        setComposerPrefsDraft((current) => ({
          model: normalizeAvailableModel(current.model, result),
          reasoningEffort: current.reasoningEffort,
          approvalPolicy: current.approvalPolicy,
          sandboxMode: current.sandboxMode,
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
  }, [authReady, setCodexOptionsError, setCodexOptionsLoading, setCodexOptionsReady, workspacePath, workspaceSelectedPath]);

  useEffect(() => {
    if (!authReady) {
      setAuthSessions([]);
      setAuthSessionsError('');
      return;
    }
    let cancelled = false;
    setAuthSessionsLoading(true);
    setAuthSessionsError('');
    listAuthSessions()
      .then((result) => {
        if (!cancelled) {
          setAuthSessions(result.sessions || []);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setAuthSessionsError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthSessionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, connectionStatus]);

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
    const previousStatus = previousConnectionStatusRef.current;
    previousConnectionStatusRef.current = connectionStatus;

    if (previousStatus === 'connected' && connectionStatus !== 'connected') {
      needsForegroundThreadSyncRef.current = true;
    }
  }, [activeSessionId, connectionStatus, socketClient]);

  useEffect(() => {
    function syncActiveThreadOnForeground() {
      if (document.hidden || connectionStatus !== 'connected' || !needsForegroundThreadSyncRef.current) {
        return;
      }
      const targetThreadId = useAppStore.getState().sessions.activeSessionId;
      if (!targetThreadId) {
        return;
      }
      needsForegroundThreadSyncRef.current = false;
      socketClient.send({
        type: 'thread_sync',
        threadId: targetThreadId,
      });
    }

    document.addEventListener('visibilitychange', syncActiveThreadOnForeground);
    window.addEventListener('focus', syncActiveThreadOnForeground);
    return () => {
      document.removeEventListener('visibilitychange', syncActiveThreadOnForeground);
      window.removeEventListener('focus', syncActiveThreadOnForeground);
    };
  }, [connectionStatus, socketClient]);

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
    if (!activeSessionPrefs) {
      const session = activeSession;
      setComposerPrefs(activeSessionId, {
        model: normalizeAvailableModel(session?.model || '', codexOptions),
        reasoningEffort: normalizeReasoningEffort(session?.reasoningEffort || ''),
        approvalPolicy: normalizeApprovalPolicy(session?.approvalPolicy || ''),
        sandboxMode: normalizeSandboxMode(session?.sandboxMode || ''),
      });
    }
  }, [activeSession, activeSessionId, activeSessionPrefs, codexOptions, setComposerPrefs]);

  useEffect(() => {
    if (!activeSessionId || connectionStatus !== 'connected') {
      return;
    }
    const signature = buildPrefsSignature(activePrefs);
    if (lastSyncedPrefsRef.current[activeSessionId] === signature) {
      return;
    }
    const timer = window.setTimeout(() => {
      lastSyncedPrefsRef.current[activeSessionId] = signature;
      socketClient.send({
        type: 'thread_options_update',
        threadId: activeSessionId,
        model: activePrefs.model || undefined,
        effort: activePrefs.reasoningEffort || undefined,
        approvalPolicy: activePrefs.approvalPolicy || undefined,
        sandboxMode: activePrefs.sandboxMode || undefined,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activePrefs, activeSessionId, connectionStatus, socketClient]);

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
    if (!authReady || connectionStatus === 'auth_failed') {
      setComposerError('鉴权失败，请先更新 Token。');
      return;
    }

    setComposerError('');

    if (isComposerCommand(text)) {
      if (!activeSessionId) {
        setComposerError('请先选择一个会话再执行命令。');
        return;
      }
      const clientMessageId = buildClientMessageId();
      const sent = socketClient.send({
        type: 'command_send',
        threadId: activeSessionId,
        text,
        clientMessageId,
      });
      if (!sent) {
        setComposerError('执行命令失败。');
        return;
      }
      appendTimelineEntry(activeSessionId, {
        id: `local-user:${clientMessageId}`,
        type: 'message',
        role: 'user',
        turnId: `${activeSessionId}:command`,
        text,
        createdAt: Date.now(),
      });
      setDraft('');
      setComposerResetSignal((value) => value + 1);
      return;
    }

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
    if (!authReady) {
      setComposerError('请先完成登录。');
      return;
    }
    const payload = buildSessionCreatePayload({
      name: sessionDraft.name,
      cwd: sessionBrowserPath || sessionDraft.cwd || workspacePath || workspaceSelectedPath || '',
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
    if (request.status === 'submitting') {
      return;
    }

    upsertServerRequest({
      ...request,
      status: 'submitting',
    });

    const sent = socketClient.send({
      type: 'server_request_respond',
      requestId: request.requestId,
      response,
    });

    if (!sent) {
      upsertServerRequest({
        ...request,
        status: 'pending',
      });
      setComposerError('提交审批响应失败。');
    }
  }

  function closeSessionWindow(threadId: string) {
    const sent = socketClient.send({
      type: 'tab_close',
      threadId,
    });
    if (!sent) {
      setComposerError('关闭 Codex 窗口失败。');
    }
  }

  function handleThemeChange(value: string) {
    const next = writeThemePreference(value);
    setTheme(next);
  }

  function handleTokenSave() {
    const nextToken = writeStoredToken(tokenDraft);
    setToken(nextToken);
    if (!nextToken) {
      setAuthReady(false);
      setTokenPromptOpen(false);
      return;
    }
    setTokenPromptOpen(false);
  }

  function handleRevokeSessions() {
    setRevokingSessions(true);
    setAuthSessionsError('');
    revokeAuthSession()
      .then((result) => {
        const removedSessionIds = new Set(result.removedSessionIds || (result.removedSessionId ? [result.removedSessionId] : []));
        setAuthSessions((current) => current.filter((item) => !removedSessionIds.has(item.sessionId)));
        setAuthReady(false);
        setTokenPromptOpen(true);
      })
      .catch((error: Error) => {
        setAuthSessionsError(error.message);
      })
      .finally(() => {
        setRevokingSessions(false);
      });
  }

  function updateComposerPrefs(next: Partial<ComposerPrefs>) {
    const current = activeSessionId ? (activeSessionPrefs || composerPrefsDraft) : composerPrefsDraft;
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

  const activeTitle = activeSession?.name || 'codex-remote-windows';
  const connectionTone = buildConnectionStatusTone(connectionStatus, health?.status);
  const unreadWarning = pendingApprovals > 0;
  const effectiveModel = activePrefs.model || normalizeModel(codexOptions?.defaults.model || '');
  const effectiveReasoningEffort = activePrefs.reasoningEffort || normalizeReasoningEffort(codexOptions?.defaults.reasoningEffort || DEFAULT_REASONING_EFFORT);
  const effectiveApprovalPolicy = activePrefs.approvalPolicy || normalizeApprovalPolicy(codexOptions?.defaults.approvalPolicy || DEFAULT_APPROVAL_POLICY);
  const effectiveSandboxMode = activePrefs.sandboxMode || normalizeSandboxMode(codexOptions?.defaults.sandboxMode || DEFAULT_SANDBOX_MODE);
  const permissionPresetValue = inferPermissionPresetValue(activePrefs.approvalPolicy, activePrefs.sandboxMode);
  const effectivePermissionPresetValue = inferPermissionPresetValue(effectiveApprovalPolicy, effectiveSandboxMode);
  const tokenUsageDisplay = buildTokenUsageDisplay(activeUsage);
  const composerControlsSummary = [
    effectiveModel || '未设置',
    formatReasoningEffortLabel(effectiveReasoningEffort),
    formatPermissionPresetSummary(effectivePermissionPresetValue, effectiveApprovalPolicy, effectiveSandboxMode),
  ].join(' · ');

  const authStatusLabel = authReady ? '已登录' : token ? '未登录' : '未设置 Token';

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
            onCloseSessionWindow={closeSessionWindow}
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
              <label className="theme-select-group" htmlFor="themeSelect">
                <span className="sr-only">主题</span>
                <select id="themeSelect" aria-label="主题" value={theme} onChange={(event) => handleThemeChange(event.target.value)}>
                  {THEME_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <span
                id="activeStatus"
                className={`status-badge status-badge-dot ${connectionTone === 'connected' ? '' : connectionTone === 'error' ? ' error' : ' waiting'}`}
                aria-label={connectionStatus}
                title={connectionStatus}
              />
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
              homeAside={!resolvedActiveSessionId ? (
                <div className="home-settings-stack">
                  <article className="home-settings-card">
                    <div className="home-settings-card-head">
                      <strong>连接鉴权</strong>
                      <span>{authStatusLabel}</span>
                    </div>
                    <div className="home-settings-card-body">
                      <span>Token 仅用于登录，连接会使用设备会话。</span>
                      <button
                        id="tokenBtn"
                        className="btn btn-secondary home-settings-card-action"
                        type="button"
                        onClick={() => {
                          setTokenDraft(token);
                          setTokenPromptOpen(true);
                        }}
                      >
                        {token ? '更新 Token' : '设置 Token'}
                      </button>
                    </div>
                  </article>
                  <article className="home-settings-card">
                    <div className="home-settings-card-head">
                      <strong>在线连接</strong>
                      <span>{authSessionsLoading ? '同步中' : `${authSessions.length} 个连接`}</span>
                    </div>
                    <div className="home-settings-card-body">
                      {authSessionsError ? <div className="status error">{authSessionsError}</div> : null}
                      <span>全部踢下线会撤销所有设备会话，并使旧 Token 失效；之后需要手动填写新 Token。</span>
                      {authReady && authSessions.length ? (
                        <button
                          type="button"
                          className="btn btn-secondary home-settings-card-action"
                          disabled={revokingSessions}
                          onClick={handleRevokeSessions}
                        >
                          {revokingSessions ? '踢下线中…' : '全部踢下线'}
                        </button>
                      ) : null}
                      {authReady ? (
                        <div className="device-session-list">
                          {authSessions.length ? authSessions.map((session) => (
                            <div key={session.sessionId} className="device-session-item">
                              <div className="device-session-copy">
                                <strong>{session.deviceName}</strong>
                                <span>{session.current ? '当前连接' : `最近活动 ${new Date(session.lastSeenAt).toLocaleString()}`}</span>
                              </div>
                            </div>
                          )) : (
                            <div className="status">暂无在线连接。</div>
                          )}
                        </div>
                      ) : (
                        <div className="status">登录后显示在线连接。</div>
                      )}
                    </div>
                  </article>
                </div>
              ) : null}
            />
            <ComposerDock
              draft={draft}
              setDraft={setDraft}
              submit={submitComposer}
              resetSignal={composerResetSignal}
              busy={Boolean(queuedPrompt)}
              composerError={composerError}
              tokenReady={Boolean(token)}
              activeSessionId={resolvedActiveSessionId}
              controlsOpen={composerControlsOpen}
              setControlsOpen={setComposerControlsOpen}
              prefs={activePrefs}
              composerControlsSummary={composerControlsSummary}
              onPrefsChange={updateComposerPrefs}
              onPresetChange={applyPermissionPreset}
              permissionPresetValue={permissionPresetValue}
              effectivePermissionPresetValue={effectivePermissionPresetValue}
              modelOptions={codexOptions?.models || []}
              defaults={buildDefaultComposerPrefs(codexOptions)}
              optionsStatus={codexOptionsStatus}
              tokenUsage={tokenUsageDisplay}
            />
          </section>
        </div>
      </main>

      <div className={`modal${tokenPromptOpen ? ' open' : ''}`} aria-hidden={tokenPromptOpen ? 'false' : 'true'}>
        <div className="modal-backdrop" onClick={() => setTokenPromptOpen(false)}></div>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="tokenModalTitle">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleTokenSave();
            }}
          >
            <input
              type="text"
              name="username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
            />
            <h2 id="tokenModalTitle" className="modal-title">设置 WebSocket Token</h2>
            <label className="modal-label" htmlFor="tokenInput">访问 Token</label>
            <input
              ref={tokenInputRef}
              id="tokenInput"
              className="modal-input"
              type="password"
              autoComplete="new-password"
              placeholder="请输入服务端配置的主 Token"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
            />
            {authSessionsError ? <div className="status error">{authSessionsError}</div> : null}
            <div className="modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setTokenPromptOpen(false)}>取消</button>
              <button className="btn" type="submit" disabled={authPending}>{authPending ? '登录中…' : '保存并登录'}</button>
            </div>
          </form>
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

              <label className="modal-label session-workspace-label">工作区目录</label>

              <WorkspaceBrowser
                ready={authReady}
                selectedPath={sessionBrowserPath || sessionDraft.cwd || workspaceSelectedPath || workspacePath}
                onSelectPath={(path) => {
                  setSessionBrowserPath(path);
                  setSessionDraft((state) => ({ ...state, cwd: path }));
                }}
                embedded
              />

              <div className="modal-label session-modal-hint">在下面选择要作为会话工作区的目录。</div>
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
