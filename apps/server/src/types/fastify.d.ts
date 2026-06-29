import type { ServerConfig } from '../config/env.js';
import type { AppServices } from '../application/services/index.js';
import type { RuntimeState } from '../state/runtime-state.js';
import type { CodexAppServerSupervisor } from '../platform/app-server-supervisor.js';
import type { CodexWindowManager } from '../platform/window-manager.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { v2 } from '@codex-remote/codex-app-server-types';
import type {
  AppStateRepository,
  PendingRequestRepository,
  SessionRepository,
  ThreadPreferenceRepository,
  TimelineEventRepository,
  UploadRepository,
  WindowBindingRepository,
} from '@codex-remote/domain';

type WorkspaceManagerLike = {
  getShortcuts: () => {
    projectRoot: string;
    desktopPath: string;
    lastUsedPath: string;
    preferredPath: string;
    roots: string[];
  };
  listDirectory: (path?: string) => {
    path: string;
    parentPath: string;
    entries: Array<{ name: string; path: string }>;
  };
  createDirectory: (parentPath: string, folderName: string) => string;
  resolveWorkspacePath: (inputPath?: string) => string;
};

type CodexClientLike = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setWsUrl: (wsUrl: string | null) => void;
  listThreads: (limit?: number) => Promise<Array<Record<string, unknown>>>;
  startThread: (options?: {
    name?: string | null;
    cwd?: string | null;
    model?: string | null;
    effort?: string | null;
    approvalPolicy?: string | null;
    sandbox?: string | null;
  }) => Promise<Record<string, unknown>>;
  resumeThread: (
    threadId: string,
    options?: {
      excludeTurns?: boolean;
      model?: string | null;
      effort?: string | null;
      approvalPolicy?: string | null;
      sandbox?: string | null;
      cwd?: string | null;
    },
  ) => Promise<Record<string, unknown>>;
  updateThreadSettings: (
    threadId: string,
    options?: {
      model?: string | null;
      effort?: string | null;
      approvalPolicy?: string | null;
      sandbox?: string | null;
      cwd?: string | null;
    },
  ) => Promise<Record<string, unknown>>;
  startTurn: (
    threadId: string,
    text: string,
    options?: {
      attachments?: Array<{ path: string; name?: string }>;
      model?: string | null;
      effort?: string | null;
      approvalPolicy?: string | null;
      sandboxPolicy?: v2.SandboxPolicy | null;
    },
  ) => Promise<Record<string, unknown>>;
  runThreadShellCommand: (
    threadId: string,
    command: string,
  ) => Promise<unknown>;
  compactThread: (threadId: string) => Promise<unknown>;
  stopBackgroundTerminals: (threadId: string) => Promise<unknown>;
  listBackgroundTerminals: (
    threadId: string,
    options?: { cursor?: string | null; limit?: number | null },
  ) => Promise<unknown>;
  listAllBackgroundTerminals: (
    threadId: string,
    limit?: number,
  ) => Promise<Array<Record<string, unknown>>>;
  terminateBackgroundTerminal: (
    threadId: string,
    processId: string,
  ) => Promise<unknown>;
  deleteThread: (threadId: string) => Promise<unknown>;
  setThreadName: (threadId: string, name: string) => Promise<unknown>;
  setThreadGoal: (
    threadId: string,
    params: {
      objective?: string;
      status?: 'active' | 'paused' | 'budgetLimited' | 'complete';
      tokenBudget?: number | null;
    },
  ) => Promise<unknown>;
  getThreadGoal: (threadId: string) => Promise<unknown>;
  clearThreadGoal: (threadId: string) => Promise<unknown>;
  listModels: (options?: {
    includeHidden?: boolean;
    limit?: number;
  }) => Promise<Array<Record<string, unknown>>>;
  readConfig: (options?: {
    cwd?: string;
  }) => Promise<{ config?: Record<string, unknown> }>;
  readWorkspaceMessages: () => Promise<unknown>;
  consumeRateLimitResetCredit: (idempotencyKey: string) => Promise<unknown>;
  readExternalAgentImportHistories: () => Promise<unknown>;
  respond: (id: string | number, result?: unknown) => void;
  respondError: (id: string | number, error: unknown) => void;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
};

type WindowAttachmentServiceLike = {
  refreshTabWindowStatus: (
    threadId: string,
    options?: {
      allowDiscovery?: boolean;
      allowLaunch?: boolean;
      broadcastUpdate?: boolean;
      touchUpdatedAt?: boolean;
    },
  ) => Promise<unknown>;
  refreshAllTabsWindowStatus: () => Promise<void>;
  openWindowForThread: (threadId: string) => Promise<unknown>;
  closeWindowForThread: (threadId: string) => Promise<unknown>;
};

declare module 'fastify' {
  interface FastifyInstance {
    config: ServerConfig;
    runtimeState: RuntimeState;
    sqlite: DatabaseSync;
    repositories: {
      sessions: SessionRepository;
      pendingRequests: PendingRequestRepository;
      threadPreferences: ThreadPreferenceRepository;
      uploads: UploadRepository;
      windowBindings: WindowBindingRepository;
      appState: AppStateRepository;
      timelineEvents: TimelineEventRepository;
    };
    verifyRequestToken: (request: FastifyRequest) => boolean;
    authorizeCookieSession: (
      cookieHeader: string | undefined,
    ) => { sessionId: string } | null;
    requireAuth: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    workspaceManager: WorkspaceManagerLike;
    codexClient: CodexClientLike;
    appServerSupervisor: CodexAppServerSupervisor;
    windowManager: CodexWindowManager;
    windowAttachments: WindowAttachmentServiceLike;
    services: AppServices;
  }

  interface FastifyRequest {
    authSessionId?: string;
  }
}
