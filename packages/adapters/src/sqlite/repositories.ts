import type { DatabaseSync } from 'node:sqlite';
import type {
  AppStateRecord,
  AppStateRepository,
  PendingRequestRecord,
  PendingRequestRepository,
  SessionRecord,
  SessionRepository,
  ThreadPreferenceRecord,
  ThreadPreferenceRepository,
  TimelineEventRecord,
  TimelineEventRepository,
  UploadRecord,
  UploadRepository,
  WindowBindingRecord,
  WindowBindingRepository,
} from '@codex-remote/domain';

function rowToSessionRecord(row: any): SessionRecord {
  return {
    threadId: row.thread_id,
    name: row.name,
    cwd: row.cwd,
    status: row.status,
    windowStatus: row.window_status,
    approvalPolicy: row.approval_policy,
    sandboxMode: row.sandbox_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPendingRequestRecord(row: any): PendingRequestRecord {
  return {
    requestId: row.request_id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    kind: row.kind,
    method: row.method,
    status: row.status,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
  };
}

function rowToThreadPreferenceRecord(row: any): ThreadPreferenceRecord {
  return {
    threadId: row.thread_id,
    approvalPolicy: row.approval_policy,
    sandboxMode: row.sandbox_mode,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
  };
}

function rowToUploadRecord(row: any): UploadRecord {
  return {
    id: row.id,
    savedName: row.saved_name,
    originalName: row.original_name,
    contentType: row.content_type,
    filePath: row.file_path,
    createdAt: row.created_at,
  };
}

function rowToWindowBindingRecord(row: any): WindowBindingRecord {
  return {
    threadId: row.thread_id,
    pid: row.pid,
    commandLine: row.command_line,
    updatedAt: row.updated_at,
  };
}

function rowToAppStateRecord(row: any): AppStateRecord {
  return {
    key: row.key,
    valueJson: row.value_json,
    updatedAt: row.updated_at,
  };
}

function rowToTimelineEventRecord(row: any): TimelineEventRecord {
  return {
    sequence: Number(row.sequence),
    threadId: row.thread_id,
    eventJson: row.event_json,
    createdAt: row.created_at,
  };
}

export function createSqliteRepositories(database: DatabaseSync): {
  sessions: SessionRepository;
  pendingRequests: PendingRequestRepository;
  threadPreferences: ThreadPreferenceRepository;
  uploads: UploadRepository;
  windowBindings: WindowBindingRepository;
  appState: AppStateRepository;
  timelineEvents: TimelineEventRepository;
} {
  const sessions: SessionRepository = {
    listSessions() {
      return database
        .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
        .all()
        .map(rowToSessionRecord);
    },
    getSession(threadId: string) {
      const row = database
        .prepare('SELECT * FROM sessions WHERE thread_id = ?')
        .get(threadId);
      return row ? rowToSessionRecord(row) : null;
    },
    upsertSession(record: SessionRecord) {
      database
        .prepare(
          `
        INSERT INTO sessions (thread_id, name, cwd, status, window_status, approval_policy, sandbox_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          name = excluded.name,
          cwd = excluded.cwd,
          status = excluded.status,
          window_status = excluded.window_status,
          approval_policy = excluded.approval_policy,
          sandbox_mode = excluded.sandbox_mode,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
        )
        .run(
          record.threadId,
          record.name,
          record.cwd,
          record.status,
          record.windowStatus,
          record.approvalPolicy,
          record.sandboxMode,
          record.createdAt,
          record.updatedAt,
        );
    },
    removeSession(threadId: string) {
      database
        .prepare('DELETE FROM sessions WHERE thread_id = ?')
        .run(threadId);
    },
  };

  const pendingRequests: PendingRequestRepository = {
    listPendingRequests() {
      return database
        .prepare('SELECT * FROM pending_requests ORDER BY created_at ASC')
        .all()
        .map(rowToPendingRequestRecord);
    },
    getPendingRequest(requestId: string) {
      const row = database
        .prepare('SELECT * FROM pending_requests WHERE request_id = ?')
        .get(requestId);
      return row ? rowToPendingRequestRecord(row) : null;
    },
    upsertPendingRequest(record: PendingRequestRecord) {
      database
        .prepare(
          `
        INSERT INTO pending_requests (request_id, thread_id, turn_id, item_id, kind, method, status, payload_json, created_at, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          item_id = excluded.item_id,
          kind = excluded.kind,
          method = excluded.method,
          status = excluded.status,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at,
          submitted_at = excluded.submitted_at
      `,
        )
        .run(
          record.requestId,
          record.threadId,
          record.turnId,
          record.itemId,
          record.kind,
          record.method,
          record.status,
          record.payloadJson,
          record.createdAt,
          record.submittedAt,
        );
    },
    removePendingRequest(requestId: string) {
      database
        .prepare('DELETE FROM pending_requests WHERE request_id = ?')
        .run(requestId);
    },
  };

  const threadPreferences: ThreadPreferenceRepository = {
    getThreadPreference(threadId: string) {
      const row = database
        .prepare('SELECT * FROM thread_preferences WHERE thread_id = ?')
        .get(threadId);
      return row ? rowToThreadPreferenceRecord(row) : null;
    },
    upsertThreadPreference(record: ThreadPreferenceRecord) {
      database
        .prepare(
          `
        INSERT INTO thread_preferences (thread_id, approval_policy, sandbox_mode, model, reasoning_effort)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          approval_policy = excluded.approval_policy,
          sandbox_mode = excluded.sandbox_mode,
          model = excluded.model,
          reasoning_effort = excluded.reasoning_effort
      `,
        )
        .run(
          record.threadId,
          record.approvalPolicy,
          record.sandboxMode,
          record.model,
          record.reasoningEffort,
        );
    },
  };

  const uploads: UploadRepository = {
    listUploads() {
      return database
        .prepare('SELECT * FROM uploads ORDER BY created_at DESC')
        .all()
        .map(rowToUploadRecord);
    },
    upsertUpload(record: UploadRecord) {
      database
        .prepare(
          `
        INSERT INTO uploads (id, saved_name, original_name, content_type, file_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          saved_name = excluded.saved_name,
          original_name = excluded.original_name,
          content_type = excluded.content_type,
          file_path = excluded.file_path,
          created_at = excluded.created_at
      `,
        )
        .run(
          record.id,
          record.savedName,
          record.originalName,
          record.contentType,
          record.filePath,
          record.createdAt,
        );
    },
  };

  const windowBindings: WindowBindingRepository = {
    listWindowBindings() {
      return database
        .prepare('SELECT * FROM window_bindings')
        .all()
        .map(rowToWindowBindingRecord);
    },
    upsertWindowBinding(record: WindowBindingRecord) {
      database
        .prepare(
          `
        INSERT INTO window_bindings (thread_id, pid, command_line, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          pid = excluded.pid,
          command_line = excluded.command_line,
          updated_at = excluded.updated_at
      `,
        )
        .run(record.threadId, record.pid, record.commandLine, record.updatedAt);
    },
  };

  const appState: AppStateRepository = {
    getAppState(key: string) {
      const row = database
        .prepare('SELECT * FROM app_state WHERE key = ?')
        .get(key);
      return row ? rowToAppStateRecord(row) : null;
    },
    setAppState(record: AppStateRecord) {
      database
        .prepare(
          `
        INSERT INTO app_state (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `,
        )
        .run(record.key, record.valueJson, record.updatedAt);
    },
  };

  const timelineEvents: TimelineEventRepository = {
    appendTimelineEvent(record) {
      database
        .prepare(
          `
        INSERT INTO timeline_events (thread_id, event_json, created_at)
        VALUES (?, ?, ?)
      `,
        )
        .run(record.threadId, record.eventJson, record.createdAt);
      const row = database
        .prepare('SELECT last_insert_rowid() AS sequence')
        .get();
      return {
        sequence: Number(
          (row as { sequence?: number | bigint } | undefined)?.sequence || 0,
        ),
        threadId: record.threadId,
        eventJson: record.eventJson,
        createdAt: record.createdAt,
      };
    },
    listTimelineEvents(threadId: string) {
      return database
        .prepare(
          'SELECT * FROM timeline_events WHERE thread_id = ? ORDER BY sequence ASC',
        )
        .all(threadId)
        .map(rowToTimelineEventRecord);
    },
  };

  return {
    sessions,
    pendingRequests,
    threadPreferences,
    uploads,
    windowBindings,
    appState,
    timelineEvents,
  };
}
