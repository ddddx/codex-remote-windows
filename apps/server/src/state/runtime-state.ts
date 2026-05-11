type RuntimeTab = {
  threadId: string;
  name: string;
  cwd: string;
  status: string;
  updatedAt: number;
  createdAt: number;
  windowStatus: string;
  approvalPolicy?: string;
  sandboxMode?: string;
};

type ServerRequestRecord = {
  requestId: string;
  rawRequestId: string | number;
  method: string;
  kind: string;
  status: 'pending' | 'submitting';
  createdAt: number;
  submittedAt?: number | null;
  threadId?: string | null;
  turnId?: string | null;
  itemId?: string | null;
  reason?: string;
  command?: string;
  cwd?: string;
  patch?: string;
  changes?: unknown[];
  permissions?: unknown;
  questions?: unknown[];
  responseSchema?: unknown;
  raw?: Record<string, unknown>;
};

export type TurnPlanSnapshot = {
  turnId: string;
  explanation: string;
  plan: Array<{ step?: string; status?: string }>;
  updatedAt: number;
};

export type TurnDiffSnapshot = {
  turnId: string;
  diff: string;
  updatedAt: number;
};

export type SupplementalItemSnapshot = {
  id: string;
  type: string;
  _turnId?: string | null;
  phase?: string;
  status?: string;
  run?: Record<string, unknown>;
  review?: Record<string, unknown> | null;
  action?: Record<string, unknown> | null;
  targetItemId?: string | null;
  decisionSource?: string | null;
  createdAt?: number;
  updatedAt?: number;
  startedAt?: number;
  completedAt?: number | null;
  [key: string]: unknown;
};

export type GlobalNoticeSnapshot = {
  id: string;
  type: string;
  text: string;
  noticeKind?: string;
  createdAt: number;
  [key: string]: unknown;
};

type RuntimeRepositories = {
  sessions: {
    listSessions: () => RuntimeTab[];
    getSession: (threadId: string) => RuntimeTab | null;
    upsertSession: (record: RuntimeTab) => void;
    removeSession: (threadId: string) => void;
  };
  pendingRequests: {
    listPendingRequests: () => ServerRequestRecord[];
    getPendingRequest: (requestId: string) => ServerRequestRecord | null;
    upsertPendingRequest: (record: ServerRequestRecord & { payloadJson?: string }) => void;
    removePendingRequest: (requestId: string) => void;
  };
  threadPreferences: {
    getThreadPreference: (threadId: string) => {
      threadId: string;
      approvalPolicy: string;
      sandboxMode: string;
      model: string;
      reasoningEffort: string;
    } | null;
    upsertThreadPreference: (record: {
      threadId: string;
      approvalPolicy: string;
      sandboxMode: string;
      model: string;
      reasoningEffort: string;
    }) => void;
  };
  uploads: {
    listUploads: () => Array<{
      id: string;
      savedName: string;
      originalName: string;
      contentType: string;
      filePath: string;
      createdAt: number;
    }>;
    upsertUpload: (record: {
      id: string;
      savedName: string;
      originalName: string;
      contentType: string;
      filePath: string;
      createdAt: number;
    }) => void;
  };
  windowBindings: {
    listWindowBindings: () => Array<{
      threadId: string;
      pid: number | null;
      commandLine: string;
      updatedAt: number;
    }>;
    upsertWindowBinding: (record: {
      threadId: string;
      pid: number | null;
      commandLine: string;
      updatedAt: number;
    }) => void;
  };
  appState: {
    getAppState: (key: string) => {
      key: string;
      valueJson: string;
      updatedAt: number;
    } | null;
    setAppState: (record: {
      key: string;
      valueJson: string;
      updatedAt: number;
    }) => void;
  };
};

export type RuntimeWsClient = {
  send: (payload: string) => void;
  close: (code?: number, reason?: string) => void;
};

export type RuntimeState = {
  startedAt: number;
  websocketClientCount: number;
  isShuttingDown: boolean;
  codexStarted: boolean;
  codexBridgeRegistered: boolean;
  clients: Set<RuntimeWsClient>;
  tabsById: Map<string, RuntimeTab>;
  serverRequestsById: Map<string, ServerRequestRecord>;
  turnPlansByThread: Map<string, Map<string, TurnPlanSnapshot>>;
  turnDiffsByThread: Map<string, Map<string, TurnDiffSnapshot>>;
  supplementalItemsByThread: Map<string, Map<string, SupplementalItemSnapshot>>;
  globalNotices: GlobalNoticeSnapshot[];
  repositories: RuntimeRepositories | null;
};

export function createRuntimeState(): RuntimeState {
  return {
    startedAt: Date.now(),
    websocketClientCount: 0,
    isShuttingDown: false,
    codexStarted: false,
    codexBridgeRegistered: false,
    clients: new Set(),
    tabsById: new Map(),
    serverRequestsById: new Map(),
    turnPlansByThread: new Map(),
    turnDiffsByThread: new Map(),
    supplementalItemsByThread: new Map(),
    globalNotices: [],
    repositories: null,
  };
}
