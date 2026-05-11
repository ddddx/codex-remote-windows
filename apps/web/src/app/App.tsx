import { useEffect, useMemo, useState } from 'react';
import { writeStoredToken, readStoredToken } from '../lib/storage.js';
import { useAppStore, mapServerMessageToStore, type ServerRequestItem } from '../store/appStore.js';
import { getHealth } from '../transport/http/health.js';
import { createSocketClient } from '../transport/ws/createSocketClient.js';

function buildSessionNameFromPrompt(text: string): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return '新会话';
  }
  return firstLine.slice(0, 40);
}

function formatTokenUsageValue(value: unknown): string {
  if (typeof value === 'number') {
    return String(value);
  }
  if (!value || typeof value !== 'object') {
    return '-';
  }

  const usage = value as Record<string, unknown>;
  const total = usage.totalTokens ?? usage.total_tokens;
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens;
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens;

  if (typeof total === 'number') {
    return String(total);
  }

  const parts = [
    typeof input === 'number' ? `in ${input}` : '',
    typeof output === 'number' ? `out ${output}` : '',
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : '-';
}

function buildApprovalSummary(request: {
  kind?: string;
  reason?: string;
  command?: string;
  tool?: string;
  serverName?: string;
  message?: string;
  patch?: string;
  questions?: Array<{ question?: string; header?: string }>;
}): string {
  if (request.reason) {
    return request.reason;
  }
  if (request.command) {
    return request.command;
  }
  if (request.message) {
    return request.message;
  }
  if (request.tool) {
    return `Tool: ${request.tool}`;
  }
  if (request.serverName) {
    return `Server: ${request.serverName}`;
  }
  if (request.questions?.length) {
    return request.questions
      .map((entry) => entry.question || entry.header || '')
      .filter(Boolean)
      .join('\n');
  }
  if (request.patch) {
    return request.patch.slice(0, 240);
  }
  return request.kind || 'Pending approval';
}

function getDecisionLabel(decision: string | Record<string, unknown>): string {
  if (typeof decision === 'string') {
    if (decision === 'accept' || decision === 'approved') {
      return 'Approve';
    }
    if (decision === 'acceptForSession' || decision === 'approved_for_session') {
      return 'Approve for session';
    }
    if (decision === 'decline' || decision === 'denied') {
      return 'Reject';
    }
    if (decision === 'cancel') {
      return 'Cancel';
    }
    return decision;
  }

  if (decision && typeof decision === 'object') {
    if ('acceptWithExecpolicyAmendment' in decision) {
      return 'Approve with policy';
    }
    if ('acceptWithNetworkPolicyAmendments' in decision) {
      return 'Approve network';
    }
  }

  return 'Respond';
}

function SessionRail() {
  const sessions = useAppStore((state) => state.sessions.items);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const approvals = useAppStore((state) => state.approvals.items);
  const setActiveSession = useAppStore((state) => state.setActiveSession);

  return (
    <aside className="panel session-rail">
      <div className="panel-title">Sessions</div>
      <div className="panel-body">
        {sessions.length ? (
          <div className="session-list">
            {sessions.map((session) => {
              const pendingCount = approvals.filter((request) => request.threadId === session.threadId).length;
              return (
                <button
                  key={session.threadId}
                  type="button"
                  className={`session-item${session.threadId === activeSessionId ? ' active' : ''}`}
                  onClick={() => setActiveSession(session.threadId)}
                >
                  <div className="session-item-row">
                    <strong>{session.name}</strong>
                    {pendingCount ? <span className="badge warning">{pendingCount}</span> : null}
                  </div>
                  <span>{session.cwd || 'No workspace'}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <strong>No sessions yet</strong>
            <span>Send a prompt from Composer to create the first session.</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function TimelineWorkspace() {
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const entries = useAppStore((state) => activeSessionId ? (state.timeline.entriesBySessionId[activeSessionId] || []) : []);
  const health = useAppStore((state) => state.health.data);
  const error = useAppStore((state) => state.health.error || state.connection.error || '');
  const turnState = useAppStore((state) => activeSessionId ? state.turns.activeBySessionId[activeSessionId] : undefined);
  const usage = useAppStore((state) => activeSessionId ? state.tokenUsage.bySessionId[activeSessionId] : null);

  return (
    <section className="panel timeline-workspace">
      <div className="panel-title">Timeline</div>
      <div className="panel-body timeline-body">
        {activeSessionId ? (
          <div className="timeline-toolbar">
            <div className={`status-chip${turnState?.active ? ' running' : ''}`}>
              {turnState?.active ? 'Running' : 'Idle'}
            </div>
            <div className="token-usage">
              <span className="label">Tokens</span>
              <strong>{formatTokenUsageValue(usage)}</strong>
            </div>
          </div>
        ) : null}
        {error ? <div className="status error">{error}</div> : null}
        {!error && !health ? <div className="status">Loading health…</div> : null}
        {activeSessionId && entries.length ? (
          <div className="timeline-list">
            {entries.map((entry) => (
              <article
                key={entry.id}
                className={`timeline-entry${entry.role ? ` ${entry.role}` : ''}`}
              >
                <div className="timeline-entry-head">
                  <div className="label">{entry.role || entry.type}</div>
                </div>
                <div className="timeline-entry-text">{entry.text || 'No text'}</div>
              </article>
            ))}
          </div>
        ) : null}
        {activeSessionId && !entries.length ? (
          <div className="empty-state">
            <strong>No timeline yet</strong>
            <span>Submit a prompt to start the first turn in this session.</span>
          </div>
        ) : null}
        {!activeSessionId && health ? (
          <div className="health-grid">
            <div className="health-card">
              <span className="label">Status</span>
              <strong>{health.status}</strong>
            </div>
            <div className="health-card">
              <span className="label">Tabs</span>
              <strong>{health.tabs}</strong>
            </div>
            <div className="health-card">
              <span className="label">WebSocket</span>
              <strong>{health.websocketClients}</strong>
            </div>
            <div className="health-card">
              <span className="label">Uptime</span>
              <strong>{health.uptimeSec}s</strong>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type InspectorPanelProps = {
  onRespond: (request: ServerRequestItem, response: unknown) => void;
};

function InspectorPanel({ onRespond }: InspectorPanelProps) {
  const health = useAppStore((state) => state.health.data);
  const connection = useAppStore((state) => state.connection);
  const token = useAppStore((state) => state.auth.token);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const approvals = useAppStore((state) => state.approvals.items);

  const visibleApprovals = useMemo(
    () => activeSessionId
      ? approvals.filter((item) => item.threadId === activeSessionId)
      : approvals,
    [activeSessionId, approvals],
  );

  return (
    <aside className="panel inspector-panel">
      <div className="panel-title">Inspector</div>
      <div className="panel-body inspector-body">
        <div className="inspector-card-grid">
          <div className="inspector-card">
            <span className="label">HTTP</span>
            <strong>{health?.status || 'unknown'}</strong>
          </div>
          <div className="inspector-card">
            <span className="label">WS</span>
            <strong>{connection.status}</strong>
          </div>
          <div className="inspector-card">
            <span className="label">Token</span>
            <strong>{token ? 'configured' : 'missing'}</strong>
          </div>
          <div className="inspector-card">
            <span className="label">Approvals</span>
            <strong>{visibleApprovals.length}</strong>
          </div>
        </div>
        <div className="approval-section">
          <div className="section-head">
            <strong>Pending approvals</strong>
            <span className="muted">{activeSessionId ? 'Current session' : 'All sessions'}</span>
          </div>
          {visibleApprovals.length ? (
            <div className="approval-list">
              {visibleApprovals.map((request) => (
                <article key={request.requestId} className="approval-item">
                  <div className="approval-item-row">
                    <strong>{request.kind || 'request'}</strong>
                    <span className={`badge${request.status === 'submitting' ? '' : ' warning'}`}>
                      {request.status || 'pending'}
                    </span>
                  </div>
                  <div className="approval-summary">{buildApprovalSummary(request)}</div>
                  <div className="approval-meta">
                    <span>{request.threadId || 'global'}</span>
                    <span>{request.requestId}</span>
                  </div>
                  <div className="approval-actions">
                    {(request.availableDecisions?.length
                      ? request.availableDecisions
                      : ['accept', 'decline']).map((decision, index) => {
                        const key = typeof decision === 'string' ? decision : JSON.stringify(decision);
                        const isPrimary = index === 0;
                        const response = typeof decision === 'string' ? { decision } : decision;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={isPrimary ? 'primary-button small' : 'secondary-button'}
                            disabled={request.status === 'submitting'}
                            onClick={() => onRespond(request, response)}
                          >
                            {getDecisionLabel(decision)}
                          </button>
                        );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No pending approvals</strong>
              <span>Requests from the server will appear here.</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

type ComposerDockProps = {
  draft: string;
  setDraft: (value: string) => void;
  submit: () => void;
  busy: boolean;
  composerError: string;
};

function ComposerDock({ draft, setDraft, submit, busy, composerError }: ComposerDockProps) {
  const token = useAppStore((state) => state.auth.token);
  const setToken = useAppStore((state) => state.setToken);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const connectionStatus = useAppStore((state) => state.connection.status);

  return (
    <footer className="panel composer-dock">
      <div className="panel-title">Composer</div>
      <div className="panel-body composer-body">
        <div className="composer-topline">
          <input
            className="token-input"
            placeholder="WebSocket token"
            value={token}
            onChange={(event) => {
              const nextToken = writeStoredToken(event.target.value);
              setToken(nextToken);
            }}
          />
          <div className={`status-chip small${connectionStatus === 'connected' ? '' : ' warning'}`}>
            {connectionStatus}
          </div>
        </div>
        <textarea
          className="composer-input"
          placeholder={activeSessionId ? 'Type a prompt…' : 'Type a prompt to create a new session…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-actions">
          <div className="composer-hint">
            <span className="muted">
              {activeSessionId ? 'Send to active session' : 'Will create a new session first'}
            </span>
            {composerError ? <span className="composer-error">{composerError}</span> : null}
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={submit}
            disabled={busy || !draft.trim()}
          >
            {busy ? 'Sending…' : activeSessionId ? 'Send' : 'Create & send'}
          </button>
        </div>
      </div>
    </footer>
  );
}

export function App() {
  const setHealthLoading = useAppStore((state) => state.setHealthLoading);
  const setHealthReady = useAppStore((state) => state.setHealthReady);
  const setHealthError = useAppStore((state) => state.setHealthError);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const token = useAppStore((state) => state.auth.token);
  const setToken = useAppStore((state) => state.setToken);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const connectionStatus = useAppStore((state) => state.connection.status);
  const appendTimelineEntry = useAppStore((state) => state.appendTimelineEntry);

  const [draft, setDraft] = useState('');
  const [queuedPrompt, setQueuedPrompt] = useState('');
  const [composerError, setComposerError] = useState('');

  const socketClient = useMemo(() => createSocketClient({
    onMessage: (message) => {
      mapServerMessageToStore(message);
    },
    onStatusChange: (status, error) => {
      setConnectionStatus(status, error);
    },
  }), [setConnectionStatus]);

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
      .catch((loadError: Error) => {
        if (!cancelled) {
          setHealthError(loadError.message);
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
    if (!activeSessionId) {
      return;
    }
    socketClient.send({
      type: 'thread_sync',
      threadId: activeSessionId,
    });
  }, [activeSessionId, socketClient]);

  useEffect(() => {
    if (!queuedPrompt.trim() || !activeSessionId || connectionStatus !== 'connected') {
      return;
    }
    const sent = socketClient.send({
      type: 'turn_send',
      threadId: activeSessionId,
      text: queuedPrompt,
      attachments: [],
    });
    if (sent) {
      appendTimelineEntry(activeSessionId, {
        id: `local-user-${Date.now()}`,
        type: 'message',
        role: 'user',
        text: queuedPrompt,
      });
      setQueuedPrompt('');
      setComposerError('');
      setDraft('');
    } else {
      setComposerError('Failed to send the queued prompt.');
    }
  }, [activeSessionId, connectionStatus, queuedPrompt, socketClient]);

  function submitComposer() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    if (!token) {
      setComposerError('Configure a WebSocket token first.');
      return;
    }
    if (connectionStatus !== 'connected') {
      setComposerError('WebSocket is not connected yet.');
      return;
    }

    setComposerError('');

    if (!activeSessionId) {
      const created = socketClient.send({
        type: 'tab_create',
        name: buildSessionNameFromPrompt(text),
      });
      if (!created) {
        setComposerError('Failed to create session.');
        return;
      }
      setQueuedPrompt(text);
      return;
    }

    const sent = socketClient.send({
      type: 'turn_send',
      threadId: activeSessionId,
      text,
      attachments: [],
    });

    if (!sent) {
      setComposerError('Failed to send prompt.');
      return;
    }

    appendTimelineEntry(activeSessionId, {
      id: `local-user-${Date.now()}`,
      type: 'message',
      role: 'user',
      text,
    });
    setDraft('');
  }

  function respondApproval(request: ServerRequestItem, response: unknown) {
    const sent = socketClient.send({
      type: 'server_request_respond',
      requestId: request.requestId,
      response,
    });

    if (!sent) {
      setComposerError('Failed to respond to approval request.');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Rebuild</div>
          <h1>Codex Remote Console</h1>
        </div>
        <div className="topbar-meta">Minimal interactive loop on new web shell</div>
      </header>
      <main className="workspace-grid">
        <SessionRail />
        <TimelineWorkspace />
        <InspectorPanel onRespond={respondApproval} />
      </main>
      <ComposerDock
        draft={draft}
        setDraft={setDraft}
        submit={submitComposer}
        busy={Boolean(queuedPrompt)}
        composerError={composerError}
      />
    </div>
  );
}
