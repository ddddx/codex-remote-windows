import { useMemo, useState } from 'react';
import { formatWindowStatus, formatWorkspaceLabel } from '../../app/view-helpers.js';
import { useAppStore } from '../../store/appStore.js';

type SessionRailProps = {
  onNewSession: () => void;
  onCloseSessionWindow: (threadId: string) => void;
};

function buildStatusDotClass(status: string | undefined): string {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'attached') {
    return 'open';
  }
  if (normalized === 'opening' || normalized === 'pending') {
    return 'waiting';
  }
  return 'closed';
}

function isSessionWindowOpen(session: { windowStatus?: string }): boolean {
  const normalized = (session.windowStatus || '').trim().toLowerCase();
  return normalized === 'attached' || normalized === 'opening' || normalized === 'pending';
}

export function SessionRail({ onNewSession, onCloseSessionWindow }: SessionRailProps) {
  const sessions = useAppStore((state) => state.sessions.items);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const approvals = useAppStore((state) => state.approvals.items);
  const setActiveSession = useAppStore((state) => state.setActiveSession);
  const [collapsedClosed, setCollapsedClosed] = useState(true);
  const pendingCountsBySessionId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const request of approvals) {
      if (!request.threadId) {
        continue;
      }
      counts[request.threadId] = (counts[request.threadId] || 0) + 1;
    }
    return counts;
  }, [approvals]);

  const openSessions = sessions.filter(isSessionWindowOpen);
  const closedSessions = sessions.filter((session) => !isSessionWindowOpen(session));

  function renderSession(session: typeof sessions[number]) {
    const pendingCount = pendingCountsBySessionId[session.threadId] || 0;
    const isActive = session.threadId === activeSessionId;
    const isClosed = !isSessionWindowOpen(session);
    return (
      <div
        key={session.threadId}
        className={`tab-item${isActive ? ' active' : ''}${isClosed ? ' closed' : ''}${pendingCount ? ' has-unread' : ''}`}
      >
        <button
          type="button"
          className="tab-item-main"
          onClick={() => setActiveSession(session.threadId)}
        >
          <span className="name">{session.name}</span>
          <span className="workspace" title={session.cwd || '未设置工作区'}>{formatWorkspaceLabel(session.cwd)}</span>
          <span className="meta">
            <span className={`status-dot ${buildStatusDotClass(session.windowStatus)}`}></span>
            <span>{formatWindowStatus(session.windowStatus) || '窗口未打开'}</span>
          </span>
        </button>
        <button
          type="button"
          className="tab-item-close"
          aria-label={`关闭 ${session.name} 的 Codex 窗口`}
          title="关闭 Codex 窗口"
          onClick={(event) => {
            event.stopPropagation();
            onCloseSessionWindow(session.threadId);
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <>
      <div id="tabList" className="tab-list">
        {sessions.length ? (
          <>
            {openSessions.map(renderSession)}
            {closedSessions.length ? (
              <section className="tab-section">
                <button
                  type="button"
                  className="tab-section-toggle"
                  aria-expanded={collapsedClosed ? 'false' : 'true'}
                  onClick={() => setCollapsedClosed((value) => !value)}
                >
                  <span>{collapsedClosed ? '›' : '⌄'}</span>
                  <strong>未打开</strong>
                  <em>{closedSessions.length}</em>
                </button>
                {!collapsedClosed ? (
                  <div className="tab-section-body">
                    {closedSessions.map(renderSession)}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <strong>还没有会话</strong>
            <span>点下方按钮新建，或者直接在输入区发送第一条消息。</span>
          </div>
        )}
      </div>
      <button id="newTabBtn" className="btn" style={{ width: '100%', marginTop: 8 }} type="button" onClick={onNewSession}>
        + 新建会话
      </button>
    </>
  );
}
