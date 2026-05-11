import { create } from 'zustand';
import type { HealthResponse, ServerMessage } from '@codex-remote/protocol';
import type { ConnectionStatus } from '../transport/ws/createSocketClient.js';

export type SessionItem = {
  threadId: string;
  name: string;
  cwd?: string;
  status?: string;
  windowStatus?: string;
};

export type TimelineEntry = {
  id: string;
  type: string;
  role?: string;
  text?: string;
};

export type ServerRequestItem = {
  requestId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  kind?: string;
  status?: 'pending' | 'submitting';
  reason?: string;
  message?: string;
  command?: string;
  cwd?: string;
  tool?: string;
  serverName?: string;
  patch?: string;
  questions?: Array<{ id?: string; question?: string; header?: string }>;
  permissions?: unknown;
  availableDecisions?: Array<string | Record<string, unknown>>;
  createdAt?: number;
};

export type ThreadRunState = {
  active: boolean;
  turnId?: string;
  startedAt?: number;
};

type AppStore = {
  health: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: HealthResponse | null;
    error: string | null;
  };
  connection: {
    status: ConnectionStatus;
    error: string | null;
  };
  auth: {
    token: string;
  };
  sessions: {
    items: SessionItem[];
    activeSessionId: string | null;
  };
  timeline: {
    entriesBySessionId: Record<string, TimelineEntry[]>;
  };
  approvals: {
    items: ServerRequestItem[];
  };
  turns: {
    activeBySessionId: Record<string, ThreadRunState>;
  };
  tokenUsage: {
    bySessionId: Record<string, unknown>;
  };
  setHealthLoading: () => void;
  setHealthReady: (data: HealthResponse) => void;
  setHealthError: (message: string) => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  setToken: (token: string) => void;
  setSessions: (items: SessionItem[]) => void;
  upsertSession: (item: SessionItem) => void;
  removeSession: (threadId: string) => void;
  setActiveSession: (threadId: string | null) => void;
  replaceServerRequests: (items: unknown[]) => void;
  upsertServerRequest: (request: unknown) => void;
  removeServerRequest: (requestId: string) => void;
  resetServerRequests: () => void;
  setTurnStarted: (threadId: string, turnId?: string, startedAt?: number) => void;
  setTurnCompleted: (threadId: string, turnId?: string) => void;
  setTokenUsage: (threadId: string, usage: unknown) => void;
  setThreadSync: (threadId: string, message: Extract<ServerMessage, { type: 'thread_sync' }>) => void;
  appendTimelineEntry: (threadId: string, entry: TimelineEntry) => void;
  appendAssistantDelta: (threadId: string, itemId: string, delta: string) => void;
};

function normalizeTab(tab: any): SessionItem {
  return {
    threadId: String(tab?.threadId || ''),
    name: String(tab?.name || '').trim() || '未命名会话',
    cwd: typeof tab?.cwd === 'string' ? tab.cwd : '',
    status: typeof tab?.status === 'string' ? tab.status : '',
    windowStatus: typeof tab?.windowStatus === 'string' ? tab.windowStatus : '',
  };
}

function extractTurnText(turn: any): string {
  if (typeof turn?.text === 'string' && turn.text.trim()) {
    return turn.text;
  }

  const inputItems = Array.isArray(turn?.input) ? turn.input : [];
  const textParts = inputItems
    .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part: any) => part.text.trim())
    .filter(Boolean);
  if (textParts.length) {
    return textParts.join('\n');
  }

  if (typeof turn?.summary === 'string' && turn.summary.trim()) {
    return turn.summary;
  }

  return '';
}

function normalizeServerRequest(request: any): ServerRequestItem | null {
  const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
  if (!requestId) {
    return null;
  }

  return {
    requestId,
    threadId: typeof request?.threadId === 'string' ? request.threadId : undefined,
    turnId: typeof request?.turnId === 'string' ? request.turnId : undefined,
    itemId: typeof request?.itemId === 'string' ? request.itemId : undefined,
    kind: typeof request?.kind === 'string' ? request.kind : undefined,
    status: request?.status === 'submitting' ? 'submitting' : 'pending',
    reason: typeof request?.reason === 'string' ? request.reason : undefined,
    message: typeof request?.message === 'string' ? request.message : undefined,
    command: typeof request?.command === 'string' ? request.command : undefined,
    cwd: typeof request?.cwd === 'string' ? request.cwd : undefined,
    tool: typeof request?.tool === 'string' ? request.tool : undefined,
    serverName: typeof request?.serverName === 'string' ? request.serverName : undefined,
    patch: typeof request?.patch === 'string' ? request.patch : undefined,
    questions: Array.isArray(request?.questions) ? request.questions : undefined,
    permissions: request?.permissions ?? undefined,
    availableDecisions: Array.isArray(request?.availableDecisions) ? request.availableDecisions : undefined,
    createdAt: typeof request?.createdAt === 'number' ? request.createdAt : undefined,
  };
}

export const useAppStore = create<AppStore>((set) => ({
  health: {
    status: 'idle',
    data: null,
    error: null,
  },
  connection: {
    status: 'idle',
    error: null,
  },
  auth: {
    token: '',
  },
  sessions: {
    items: [],
    activeSessionId: null,
  },
  timeline: {
    entriesBySessionId: {},
  },
  approvals: {
    items: [],
  },
  turns: {
    activeBySessionId: {},
  },
  tokenUsage: {
    bySessionId: {},
  },
  setHealthLoading: () => set((state) => ({
    health: {
      ...state.health,
      status: 'loading',
      error: null,
    },
  })),
  setHealthReady: (data) => set({
    health: {
      status: 'ready',
      data,
      error: null,
    },
  }),
  setHealthError: (message) => set({
    health: {
      status: 'error',
      data: null,
      error: message,
    },
  }),
  setConnectionStatus: (status, error) => set({
    connection: {
      status,
      error: error || null,
    },
  }),
  setToken: (token) => set((state) => ({
    auth: {
      ...state.auth,
      token,
    },
  })),
  setSessions: (items) => set((state) => ({
    sessions: {
      items,
      activeSessionId: state.sessions.activeSessionId && items.some((item) => item.threadId === state.sessions.activeSessionId)
        ? state.sessions.activeSessionId
        : (items[0]?.threadId || null),
    },
  })),
  upsertSession: (item) => set((state) => {
    const nextItems = [...state.sessions.items];
    const index = nextItems.findIndex((entry) => entry.threadId === item.threadId);
    if (index >= 0) {
      nextItems[index] = {
        ...nextItems[index],
        ...item,
      };
    } else {
      nextItems.unshift(item);
    }
    return {
      sessions: {
        items: nextItems,
        activeSessionId: state.sessions.activeSessionId || item.threadId,
      },
    };
  }),
  removeSession: (threadId) => set((state) => {
    const nextTurns = { ...state.turns.activeBySessionId };
    const nextUsage = { ...state.tokenUsage.bySessionId };
    const nextEntries = { ...state.timeline.entriesBySessionId };
    delete nextTurns[threadId];
    delete nextUsage[threadId];
    delete nextEntries[threadId];

    const nextItems = state.sessions.items.filter((item) => item.threadId !== threadId);
    return {
      sessions: {
        items: nextItems,
        activeSessionId: state.sessions.activeSessionId === threadId ? (nextItems[0]?.threadId || null) : state.sessions.activeSessionId,
      },
      timeline: {
        entriesBySessionId: nextEntries,
      },
      turns: {
        activeBySessionId: nextTurns,
      },
      tokenUsage: {
        bySessionId: nextUsage,
      },
      approvals: {
        items: state.approvals.items.filter((item) => item.threadId !== threadId),
      },
    };
  }),
  setActiveSession: (threadId) => set((state) => ({
    sessions: {
      ...state.sessions,
      activeSessionId: threadId,
    },
  })),
  replaceServerRequests: (items) => set(() => ({
    approvals: {
      items: items
        .map(normalizeServerRequest)
        .filter((item): item is ServerRequestItem => item !== null)
        .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0)),
    },
  })),
  upsertServerRequest: (request) => set((state) => {
    const normalized = normalizeServerRequest(request);
    if (!normalized) {
      return state;
    }

    const nextItems = [...state.approvals.items];
    const index = nextItems.findIndex((item) => item.requestId === normalized.requestId);
    if (index >= 0) {
      nextItems[index] = {
        ...nextItems[index],
        ...normalized,
      };
    } else {
      nextItems.push(normalized);
    }
    nextItems.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));

    return {
      approvals: {
        items: nextItems,
      },
    };
  }),
  removeServerRequest: (requestId) => set((state) => ({
    approvals: {
      items: state.approvals.items.filter((item) => item.requestId !== requestId),
    },
  })),
  resetServerRequests: () => set({
    approvals: {
      items: [],
    },
  }),
  setTurnStarted: (threadId, turnId, startedAt) => set((state) => ({
    turns: {
      activeBySessionId: {
        ...state.turns.activeBySessionId,
        [threadId]: {
          active: true,
          turnId,
          startedAt,
        },
      },
    },
  })),
  setTurnCompleted: (threadId, turnId) => set((state) => ({
    turns: {
      activeBySessionId: {
        ...state.turns.activeBySessionId,
        [threadId]: {
          active: false,
          turnId,
        },
      },
    },
  })),
  setTokenUsage: (threadId, usage) => set((state) => ({
    tokenUsage: {
      bySessionId: {
        ...state.tokenUsage.bySessionId,
        [threadId]: usage,
      },
    },
  })),
  appendTimelineEntry: (threadId, entry) => set((state) => ({
    timeline: {
      entriesBySessionId: {
        ...state.timeline.entriesBySessionId,
        [threadId]: [...(state.timeline.entriesBySessionId[threadId] || []), entry],
      },
    },
  })),
  appendAssistantDelta: (threadId, itemId, delta) => set((state) => {
    const entries = [...(state.timeline.entriesBySessionId[threadId] || [])];
    const index = entries.findIndex((entry) => entry.id === itemId);
    if (index >= 0) {
      entries[index] = {
        ...entries[index],
        role: 'assistant',
        type: 'message',
        text: `${entries[index].text || ''}${delta}`,
      };
    } else {
      entries.push({
        id: itemId,
        type: 'message',
        role: 'assistant',
        text: delta,
      });
    }

    return {
      timeline: {
        entriesBySessionId: {
          ...state.timeline.entriesBySessionId,
          [threadId]: entries,
        },
      },
    };
  }),
  setThreadSync: (threadId, message) => set((state) => ({
    timeline: {
      entriesBySessionId: {
        ...state.timeline.entriesBySessionId,
        [threadId]: Array.isArray(message.turns)
          ? message.turns.flatMap((turn: any, index) => {
            const turnId = String(turn?.id || `${threadId}-${index}`);
            const entries: TimelineEntry[] = [];
            const userText = extractTurnText(turn);
            if (userText) {
              entries.push({
                id: `${turnId}-user`,
                type: 'message',
                role: 'user',
                text: userText,
              });
            }
            if (typeof turn?.output === 'string' && turn.output.trim()) {
              entries.push({
                id: `${turnId}-assistant`,
                type: 'message',
                role: 'assistant',
                text: turn.output.trim(),
              });
            }
            return entries.length ? entries : [{
              id: turnId,
              type: 'turn',
              role: 'system',
              text: 'Empty turn',
            }];
          })
          : [],
      },
    },
    tokenUsage: {
      bySessionId: {
        ...state.tokenUsage.bySessionId,
        [threadId]: message.tokenUsage ?? null,
      },
    },
  })),
}));

export function mapServerMessageToStore(message: ServerMessage) {
  const store = useAppStore.getState();

  if (message.type === 'state') {
    store.setSessions(Array.isArray(message.tabs) ? message.tabs.map(normalizeTab) : []);
    store.replaceServerRequests(Array.isArray(message.serverRequests) ? message.serverRequests : []);
    return;
  }

  if (message.type === 'server_request_required' || message.type === 'server_request_updated') {
    store.upsertServerRequest(message.request);
    return;
  }

  if (message.type === 'server_request_resolved') {
    store.removeServerRequest(message.requestId);
    return;
  }

  if (message.type === 'server_request_reset') {
    store.resetServerRequests();
    return;
  }

  if (message.type === 'tab_updated' && message.tab) {
    store.upsertSession(normalizeTab(message.tab));
    return;
  }

  if (message.type === 'tab_created' && message.tab) {
    store.upsertSession(normalizeTab(message.tab));
    store.setActiveSession(message.threadId);
    return;
  }

  if (message.type === 'tab_removed') {
    store.removeSession(message.threadId);
    return;
  }

  if (message.type === 'thread_sync') {
    store.setThreadSync(message.threadId, message);
    return;
  }

  if (message.type === 'turn_started') {
    store.setTurnStarted(message.threadId, message.turnId, message.startedAt);
    return;
  }

  if (message.type === 'turn_completed') {
    store.setTurnCompleted(message.threadId, message.turnId);
    return;
  }

  if (message.type === 'token_usage') {
    store.setTokenUsage(message.threadId, message.usage);
    return;
  }

  if (message.type === 'agent_delta') {
    store.appendAssistantDelta(
      message.threadId,
      message.itemId || `${message.threadId}-assistant-live`,
      message.delta || '',
    );
    return;
  }

  if (message.type === 'item_completed') {
    const item = message.item as Record<string, unknown> | undefined;
    if (item?.type === 'agentMessage') {
      const itemId = typeof item.id === 'string'
        ? item.id
        : `${message.threadId}-assistant-final`;
      const text = typeof item.text === 'string'
        ? item.text
        : typeof item.output === 'string'
          ? item.output
          : '';
      if (text.trim()) {
        store.appendAssistantDelta(message.threadId, itemId, text.trim());
      }
    }
  }
}
