export const SQLITE_MIGRATIONS = [
  `
    CREATE TABLE IF NOT EXISTS sessions (
      thread_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL,
      window_status TEXT NOT NULL,
      approval_policy TEXT NOT NULL DEFAULT '',
      sandbox_mode TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS pending_requests (
      request_id TEXT PRIMARY KEY,
      thread_id TEXT,
      turn_id TEXT,
      item_id TEXT,
      kind TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      submitted_at INTEGER
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS thread_preferences (
      thread_id TEXT PRIMARY KEY,
      approval_policy TEXT NOT NULL DEFAULT '',
      sandbox_mode TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      reasoning_effort TEXT NOT NULL DEFAULT ''
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      saved_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS window_bindings (
      thread_id TEXT PRIMARY KEY,
      pid INTEGER,
      command_line TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS timeline_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_timeline_events_thread_sequence
    ON timeline_events(thread_id, sequence);
  `,
];
