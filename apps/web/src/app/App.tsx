import { useEffect, useState } from 'react';

type HealthResponse = {
  status: string;
  tabs: number;
  websocketClients: number;
  uptimeSec: number;
};

async function loadHealth(): Promise<HealthResponse> {
  const response = await fetch('http://127.0.0.1:18637/health');
  if (!response.ok) {
    throw new Error(`health request failed: ${response.status}`);
  }
  return response.json() as Promise<HealthResponse>;
}

function SessionRail() {
  return (
    <aside className="panel session-rail">
      <div className="panel-title">Sessions</div>
      <div className="panel-body muted">Session rail scaffold</div>
    </aside>
  );
}

function TimelineWorkspace({ health, error }: { health: HealthResponse | null; error: string }) {
  return (
    <section className="panel timeline-workspace">
      <div className="panel-title">Timeline</div>
      <div className="panel-body">
        {error ? <div className="status error">{error}</div> : null}
        {!error && !health ? <div className="status">Loading health…</div> : null}
        {health ? (
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

function InspectorPanel() {
  return (
    <aside className="panel inspector-panel">
      <div className="panel-title">Inspector</div>
      <div className="panel-body muted">Context / settings scaffold</div>
    </aside>
  );
}

function ComposerDock() {
  return (
    <footer className="panel composer-dock">
      <div className="panel-title">Composer</div>
      <div className="panel-body">
        <textarea className="composer-input" placeholder="Prompt scaffold" />
      </div>
    </footer>
  );
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadHealth()
      .then((result) => {
        if (!cancelled) {
          setHealth(result);
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Rebuild</div>
          <h1>Codex Remote Console</h1>
        </div>
        <div className="topbar-meta">React + Vite scaffold</div>
      </header>
      <main className="workspace-grid">
        <SessionRail />
        <TimelineWorkspace health={health} error={error} />
        <InspectorPanel />
      </main>
      <ComposerDock />
    </div>
  );
}
