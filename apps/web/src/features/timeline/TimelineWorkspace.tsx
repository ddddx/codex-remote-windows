import { useMemo } from 'react';
import { buildApprovalSummary, formatTimelineLabel, formatTokenUsageValue, summarizeTimelineEntry } from '../../app/view-helpers.js';
import { useAppStore, type ServerRequestItem, type TimelineEntry } from '../../store/appStore.js';
import { buildTimelineGroups } from './model.js';

function TimelineEntryCard({ entry }: { entry: TimelineEntry }) {
  return (
    <article className={`timeline-entry${entry.role ? ` ${entry.role}` : ''}${entry.type ? ` type-${entry.type}` : ''}`}>
      <div className="timeline-entry-head">
        <div className="label">{formatTimelineLabel(entry)}</div>
        {entry.status ? <div className={`badge${entry.status === 'running' ? ' warning' : ''}`}>{entry.status}</div> : null}
      </div>
      <div className="timeline-entry-text">{summarizeTimelineEntry(entry)}</div>
      {entry.meta?.length ? (
        <div className="timeline-entry-meta">
          {entry.meta.map((line, index) => <span key={`${entry.id}-meta-${index}`}>{line}</span>)}
        </div>
      ) : null}
      {entry.changes?.length ? (
        <div className="timeline-entry-changes">
          {entry.changes.map((change, index) => (
            <span key={`${entry.id}-change-${index}`} className="timeline-chip">
              {[change.kind, change.path].filter(Boolean).join(': ')}
            </span>
          ))}
        </div>
      ) : null}
      {entry.patch ? <pre className="timeline-entry-pre">{entry.patch}</pre> : null}
    </article>
  );
}

function InlineApprovalCard({ request }: { request: ServerRequestItem }) {
  return (
    <article className="timeline-approval-card">
      <div className="timeline-entry-head">
        <div className="label">{request.kind || 'approval'}</div>
        <div className={`badge${request.status === 'submitting' ? '' : ' warning'}`}>{request.status || 'pending'}</div>
      </div>
      <div className="timeline-entry-text">{buildApprovalSummary(request)}</div>
      <div className="timeline-entry-meta">
        <span>{request.threadId || 'global'}</span>
        <span>{request.requestId}</span>
        {request.command ? <span>{request.command}</span> : null}
        {request.cwd ? <span>{request.cwd}</span> : null}
      </div>
      {request.patch ? <pre className="timeline-entry-pre">{request.patch}</pre> : null}
    </article>
  );
}

export function TimelineWorkspace() {
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const entriesBySessionId = useAppStore((state) => state.timeline.entriesBySessionId);
  const health = useAppStore((state) => state.health.data);
  const error = useAppStore((state) => state.health.error || state.connection.error || '');
  const turnState = useAppStore((state) => activeSessionId ? state.turns.activeBySessionId[activeSessionId] : undefined);
  const usage = useAppStore((state) => activeSessionId ? state.tokenUsage.bySessionId[activeSessionId] : null);
  const approvalItems = useAppStore((state) => state.approvals.items);

  const entries = useMemo(
    () => activeSessionId ? (entriesBySessionId[activeSessionId] || []) : [],
    [activeSessionId, entriesBySessionId],
  );
  const approvals = useMemo(
    () => activeSessionId ? approvalItems.filter((item) => item.threadId === activeSessionId) : [],
    [activeSessionId, approvalItems],
  );

  const groups = useMemo(
    () => buildTimelineGroups(entries, approvals, turnState),
    [approvals, entries, turnState],
  );

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
        {activeSessionId && groups.length ? (
          <div className="timeline-group-list">
            {groups.map((group) => (
              <section key={group.id} className={`timeline-group status-${group.status}`}>
                <div className="timeline-group-head">
                  <div>
                    <strong>{group.label}</strong>
                    {group.turnId ? <span className="timeline-group-id">{group.turnId}</span> : null}
                  </div>
                  <div className={`badge${group.status === 'running' || group.status === 'pending' ? ' warning' : ''}`}>{group.status}</div>
                </div>
                <div className="timeline-group-body">
                  {group.entries.map((entry) => <TimelineEntryCard key={entry.id} entry={entry} />)}
                  {group.approvals.map((request) => <InlineApprovalCard key={request.requestId} request={request} />)}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {activeSessionId && !groups.length ? (
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
