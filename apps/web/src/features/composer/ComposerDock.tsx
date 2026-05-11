import { useMemo } from 'react';
import { writeStoredToken } from '../../lib/storage.js';
import { useAppStore } from '../../store/appStore.js';
import { uploadImage } from '../../transport/http/uploads.js';

type ComposerDockProps = {
  draft: string;
  setDraft: (value: string) => void;
  submit: () => void;
  busy: boolean;
  composerError: string;
  workspacePath: string;
  setWorkspacePath: (value: string) => void;
};

export function ComposerDock({
  draft,
  setDraft,
  submit,
  busy,
  composerError,
  workspacePath,
  setWorkspacePath,
}: ComposerDockProps) {
  const token = useAppStore((state) => state.auth.token);
  const setToken = useAppStore((state) => state.setToken);
  const activeSessionId = useAppStore((state) => state.sessions.activeSessionId);
  const connectionStatus = useAppStore((state) => state.connection.status);
  const attachmentsBySessionId = useAppStore((state) => state.composer.attachmentsBySessionId);
  const addAttachment = useAppStore((state) => state.addAttachment);
  const removeAttachment = useAppStore((state) => state.removeAttachment);
  const attachments = useMemo(() => {
    const key = activeSessionId || '__new__';
    return attachmentsBySessionId[key] || [];
  }, [activeSessionId, attachmentsBySessionId]);

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
        {!activeSessionId ? (
          <input
            className="token-input"
            placeholder="Workspace path for new session"
            value={workspacePath}
            onChange={(event) => setWorkspacePath(event.target.value)}
          />
        ) : null}
        <div className="attachment-toolbar">
          <label className="secondary-button file-button">
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file || !token) {
                  return;
                }
                const targetThreadId = activeSessionId || '__new__';
                void uploadImage(token, file)
                  .then((result) => {
                    addAttachment(targetThreadId, {
                      ...result,
                      previewUrl: URL.createObjectURL(file),
                    });
                  });
                event.currentTarget.value = '';
              }}
            />
            Upload image
          </label>
        </div>
        {attachments.length ? (
          <div className="attachment-list">
            {attachments.map((attachment) => (
              <article key={attachment.id} className="attachment-card">
                <img src={attachment.previewUrl} alt={attachment.name} className="attachment-preview" />
                <div className="attachment-meta">
                  <strong>{attachment.name}</strong>
                  <span>{attachment.contentType}</span>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => removeAttachment(activeSessionId || '__new__', attachment.id)}
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
        ) : null}
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
