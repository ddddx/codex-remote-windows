export type SessionStatus =
  | 'idle'
  | 'running'
  | 'failed'
  | 'closed'
  | 'detached'
  | 'unknown';

export type SessionRecord = {
  threadId: string;
  name: string;
  cwd: string;
  status: SessionStatus | string;
  windowStatus: string;
  approvalPolicy: string;
  sandboxMode: string;
  createdAt: number;
  updatedAt: number;
};

export type PendingRequestRecord = {
  requestId: string;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  kind: string;
  method: string;
  status: 'pending' | 'submitting' | 'resolved';
  payloadJson: string;
  createdAt: number;
  submittedAt: number | null;
};

export type ThreadPreferenceRecord = {
  threadId: string;
  approvalPolicy: string;
  sandboxMode: string;
  model: string;
  reasoningEffort: string;
};

export type UploadRecord = {
  id: string;
  savedName: string;
  originalName: string;
  contentType: string;
  filePath: string;
  createdAt: number;
};

export type WindowBindingRecord = {
  threadId: string;
  pid: number | null;
  commandLine: string;
  updatedAt: number;
};

export type AppStateRecord = {
  key: string;
  valueJson: string;
  updatedAt: number;
};

export type TimelineEventRecord = {
  sequence: number;
  threadId: string;
  eventJson: string;
  createdAt: number;
};
