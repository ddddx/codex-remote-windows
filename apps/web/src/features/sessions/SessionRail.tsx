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

export function SessionRail({ onNewSession, onCloseSessionWindow }: SessionRailProps) {
  const sessions = useAppStore((state) => state.sessions.items);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const approvals = useAppStore((state) => state.approvals.items);
  const setActiveSession = useAppStore((state) => state.setActiveSession);

  return (
    <>
      <div id="tabList" className="tab-list">
        {sessions.length ? sessions.map((session) => {
          const pendingCount = approvals.filter((request) => request.threadId === session.threadId).length;
          const isActive = session.threadId === activeSessionId;
          const isClosed = (session.status || '').trim().toLowerCase() === 'closed';
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
        }) : (
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
