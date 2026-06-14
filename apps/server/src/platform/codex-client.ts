import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import type {
  ClientNotification,
  ClientRequest,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
  ReasoningEffort,
  RequestId,
  ServerNotification,
  ServerRequest,
  v2,
} from '@codex-remote/codex-app-server-types';
import { terminateProcessTree } from './process-termination.js';

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const SANDBOX_MODES = new Set<v2.SandboxMode>([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

const STRING_APPROVAL_POLICIES = new Set<Extract<v2.AskForApproval, string>>([
  'untrusted',
  'on-failure',
  'on-request',
  'never',
]);

const INITIAL_TURNS_PAGE_LIMIT = 100;

type RequestResponseMap = {
  initialize: InitializeResponse;
  'thread/list': v2.ThreadListResponse;
  'thread/start': v2.ThreadStartResponse;
  'thread/resume': v2.ThreadResumeResponse;
  'thread/settings/update': v2.ThreadSettingsUpdateResponse;
  'turn/start': v2.TurnStartResponse;
  'thread/shellCommand': v2.ThreadShellCommandResponse;
  'thread/compact/start': v2.ThreadCompactStartResponse;
  'thread/backgroundTerminals/clean': v2.ThreadBackgroundTerminalsCleanResponse;
  'thread/name/set': v2.ThreadSetNameResponse;
  'thread/goal/set': v2.ThreadGoalSetResponse;
  'thread/goal/get': v2.ThreadGoalGetResponse;
  'thread/goal/clear': v2.ThreadGoalClearResponse;
  'model/list': v2.ModelListResponse;
  'config/read': v2.ConfigReadResponse;
};

type AskForApproval = v2.AskForApproval;
type ConfigReadResponse = v2.ConfigReadResponse;
type Model = v2.Model;
type SandboxMode = v2.SandboxMode;
type SandboxPolicy = v2.SandboxPolicy;
type Thread = v2.Thread;
type ThreadBackgroundTerminalsCleanResponse = v2.ThreadBackgroundTerminalsCleanResponse;
type ThreadCompactStartResponse = v2.ThreadCompactStartResponse;
type ThreadGoalClearResponse = v2.ThreadGoalClearResponse;
type ThreadGoalGetResponse = v2.ThreadGoalGetResponse;
type ThreadGoalSetResponse = v2.ThreadGoalSetResponse;
type ThreadGoalStatus = v2.ThreadGoalStatus;
type ThreadResumeResponse = v2.ThreadResumeResponse;
type ThreadSetNameResponse = v2.ThreadSetNameResponse;
type ThreadShellCommandResponse = v2.ThreadShellCommandResponse;
type ThreadStartResponse = v2.ThreadStartResponse;
type Turn = v2.Turn;
type UserInput = v2.UserInput;

type SupportedRequestMethod = keyof RequestResponseMap;
type RequestParams<M extends SupportedRequestMethod> =
  M extends 'thread/start'
    ? Omit<Extract<ClientRequest, { method: M }>['params'], 'persistExtendedHistory'>
    : M extends 'thread/resume'
      ? Omit<Extract<ClientRequest, { method: M }>['params'], 'persistExtendedHistory'>
      : Extract<ClientRequest, { method: M }>['params'];
type RequestResult<M extends SupportedRequestMethod> = RequestResponseMap[M];
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  method: SupportedRequestMethod;
};

export type StartThreadOptions = {
  name?: string | null;
  cwd?: string | null;
  model?: string | null;
  effort?: string | null;
  approvalPolicy?: string | null;
  sandbox?: string | null;
};

export type StartTurnOptions = {
  attachments?: Array<{ path: string; name?: string }>;
  model?: string | null;
  effort?: string | null;
  approvalPolicy?: string | null;
  sandboxPolicy?: SandboxPolicy | null;
};

export type ThreadOptions = {
  model?: string | null;
  effort?: string | null;
  approvalPolicy?: string | null;
  sandbox?: string | null;
  cwd?: string | null;
};

export type ThreadSettingsSnapshot = {
  cwd?: string;
  model?: string;
  approvalPolicy?: string;
  approvalPolicyRaw?: v2.AskForApproval | null;
  reasoningEffort?: ReasoningEffort | null;
  sandboxMode?: v2.SandboxMode;
  sandboxPolicy?: v2.SandboxPolicy | null;
};

export type CodexClientNotification = ServerNotification;
export type CodexClientServerRequest = ServerRequest;
export type CodexClientExitEvent = {
  code: number | null;
  signal: string | null;
};

export type RuntimeThread = Thread & {
  model?: string;
  serviceTier?: string | null;
  approvalPolicy?: string;
  approvalPolicyRaw?: v2.AskForApproval | null;
  reasoningEffort?: ReasoningEffort | null;
  sandboxMode?: v2.SandboxMode;
  sandboxPolicy?: v2.SandboxPolicy;
};

type CodexClientOptions = {
  codexCmd?: string;
  cwd?: string;
  wsUrl?: string | null;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
};

type ResponseEnvelope = {
  id: RequestId;
  result?: unknown;
  error?: unknown;
};

export class CodexAppServerClient extends EventEmitter {
  readonly codexCmd: string;
  readonly defaultCwd: string;
  wsUrl: string | null;
  readonly requestTimeoutMs: number;
  readonly connectTimeoutMs: number;
  proc: ReturnType<typeof spawn> | null;
  ws: WebSocket | null;
  nextId: number;
  pending: Map<string, PendingRequest>;
  buffer: string;
  started: boolean;
  lastTransportEvent: string;
  startPromise: Promise<void> | null;

  constructor(options: CodexClientOptions = {}) {
    super();
    this.codexCmd = options.codexCmd || process.env.CODEX_CMD || 'codex.cmd';
    this.defaultCwd = options.cwd || process.cwd();
    this.wsUrl = options.wsUrl || process.env.CODEX_APP_SERVER_WS || null;
    this.requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs)
      || parsePositiveInteger(process.env.CODEX_REQUEST_TIMEOUT)
      || 120000;
    this.connectTimeoutMs = parsePositiveInteger(options.connectTimeoutMs)
      || parsePositiveInteger(process.env.CODEX_CONNECT_TIMEOUT)
      || 10000;
    this.proc = null;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.started = false;
    this.lastTransportEvent = 'created';
    this.startPromise = null;
  }

  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = (async () => {
      if (this.wsUrl) {
        await this.startWebSocket();
      } else {
        await this.startStdio();
      }

      await this.initialize();
      this.started = true;
    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  setWsUrl(wsUrl: string | null): void {
    if (this.started && this.wsUrl !== wsUrl) {
      throw new Error('cannot change codex app-server websocket after client start');
    }
    this.wsUrl = wsUrl;
  }

  async stop(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.proc) {
      await terminateProcessTree(this.proc.pid);
      this.proc = null;
    }

    this.started = false;
    this.startPromise = null;
  }

  async request<M extends SupportedRequestMethod>(
    method: M,
    params: RequestParams<M>,
  ): Promise<RequestResult<M>> {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }

    const id: RequestId = String(this.nextId++);
    const payload = { id, method, params };

    const promise = new Promise<RequestResult<M>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(this.buildRequestTimeoutMessage(method)));
      }, this.requestTimeoutMs);

      this.pending.set(String(id), {
        resolve: (value) => resolve(value as RequestResult<M>),
        reject,
        timeout,
        method,
      });
    });

    this.send(payload);
    return promise;
  }

  respond(id: RequestId, result: unknown = {}): void {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.send({ id, result });
  }

  respondError(id: RequestId, error: unknown): void {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.send({ id, error });
  }

  notify(method: ClientNotification['method']): void {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.send({ method });
  }

  async listThreads(limit = 100): Promise<Thread[]> {
    const data: Thread[] = [];
    let cursor: string | null = null;

    do {
      const pageLimit = Math.max(1, Math.min(limit - data.length, 100));
      const result: v2.ThreadListResponse = await this.request('thread/list', {
        archived: false,
        limit: pageLimit,
        cursor,
      });
      data.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor && data.length < limit);

    return data.slice(0, limit);
  }

  async startThread(options: StartThreadOptions = {}): Promise<RuntimeThread> {
    const workingCwd = options.cwd || this.defaultCwd;
    const result = await this.request('thread/start', {
      model: options.model || null,
      approvalPolicy: normalizeApprovalPolicy(options.approvalPolicy),
      sandbox: normalizeSandboxMode(options.sandbox),
      config: buildReasoningConfig(options.effort),
      cwd: workingCwd,
      experimentalRawEvents: false,
    });

    const thread = projectRuntimeThread(result.thread, result);
    thread.cwd = thread.cwd || workingCwd;
    if (options.name) {
      await this.request('thread/name/set', { threadId: thread.id, name: options.name });
      thread.name = options.name;
    }
    return thread;
  }

  async resumeThread(
    threadId: string,
    options: { excludeTurns?: boolean } & ThreadOptions = {},
  ): Promise<RuntimeThread> {
    const result = await this.request('thread/resume', {
      threadId,
      excludeTurns: options.excludeTurns === true,
      ...(options.excludeTurns === true
        ? {}
        : {
            initialTurnsPage: {
              limit: INITIAL_TURNS_PAGE_LIMIT,
              sortDirection: 'desc',
              itemsView: 'full',
            },
          }),
      model: options.model || null,
      approvalPolicy: normalizeApprovalPolicy(options.approvalPolicy),
      sandbox: normalizeSandboxMode(options.sandbox),
      cwd: options.cwd || null,
      config: buildReasoningConfig(options.effort),
    });
    return projectRuntimeThread(result.thread, result);
  }

  async updateThreadSettings(
    threadId: string,
    options: ThreadOptions = {},
  ): Promise<ThreadSettingsSnapshot> {
    const sandboxPolicy = buildSandboxPolicy(options.sandbox, options.cwd);
    await this.request('thread/settings/update', {
      threadId,
      cwd: options.cwd || null,
      approvalPolicy: normalizeApprovalPolicy(options.approvalPolicy),
      sandboxPolicy,
      model: options.model || null,
      effort: normalizeReasoningEffort(options.effort),
    });

    return projectThreadSettings({
      cwd: options.cwd || undefined,
      approvalPolicy: normalizeApprovalPolicy(options.approvalPolicy),
      sandboxPolicy,
      model: options.model || undefined,
      effort: normalizeReasoningEffort(options.effort),
    });
  }

  async startTurn(threadId: string, text: string, options: StartTurnOptions = {}): Promise<Turn> {
    const input: TurnStartParamsInput = [];
    if (typeof text === 'string' && text.trim()) {
      input.push({
        type: 'text',
        text: text.trim(),
        text_elements: [],
      });
    }

    for (const attachment of Array.isArray(options.attachments) ? options.attachments : []) {
      if (!attachment?.path) {
        continue;
      }
      input.push({
        type: 'localImage',
        path: attachment.path,
      });
    }

    if (!input.length) {
      throw new Error('turn input required');
    }

    const result = await this.request('turn/start', {
      threadId,
      model: options.model || null,
      effort: normalizeReasoningEffort(options.effort),
      approvalPolicy: normalizeApprovalPolicy(options.approvalPolicy),
      sandboxPolicy: options.sandboxPolicy || null,
      input,
    });
    return result.turn;
  }

  async runThreadShellCommand(threadId: string, command: string): Promise<ThreadShellCommandResponse> {
    return this.request('thread/shellCommand', {
      threadId,
      command,
    });
  }

  async compactThread(threadId: string): Promise<ThreadCompactStartResponse> {
    return this.request('thread/compact/start', { threadId });
  }

  async stopBackgroundTerminals(threadId: string): Promise<ThreadBackgroundTerminalsCleanResponse> {
    return this.request('thread/backgroundTerminals/clean', { threadId });
  }

  async setThreadName(threadId: string, name: string): Promise<ThreadSetNameResponse> {
    return this.request('thread/name/set', { threadId, name });
  }

  async setThreadGoal(
    threadId: string,
    params: {
      objective?: string;
      status?: ThreadGoalStatus;
      tokenBudget?: number | null;
    },
  ): Promise<ThreadGoalSetResponse> {
    return this.request('thread/goal/set', {
      threadId,
      objective: params.objective ?? null,
      status: params.status ?? null,
      tokenBudget: params.tokenBudget ?? null,
    });
  }

  async getThreadGoal(threadId: string): Promise<ThreadGoalGetResponse> {
    return this.request('thread/goal/get', { threadId });
  }

  async clearThreadGoal(threadId: string): Promise<ThreadGoalClearResponse> {
    return this.request('thread/goal/clear', { threadId });
  }

  async listModels({ includeHidden = false, limit = 200 } = {}): Promise<Model[]> {
    const data: Model[] = [];
    let cursor: string | null = null;

    do {
      const pageLimit = Math.max(1, Math.min(limit - data.length, 200));
      const result: v2.ModelListResponse = await this.request('model/list', {
        includeHidden,
        limit: pageLimit,
        cursor,
      });
      data.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor && data.length < limit);

    return data.slice(0, limit);
  }

  async readConfig({ cwd }: { cwd?: string } = {}): Promise<ConfigReadResponse> {
    return this.request('config/read', {
      includeLayers: false,
      cwd: cwd || null,
    });
  }

  private async startStdio(): Promise<void> {
    this.proc = spawn(
      this.codexCmd,
      ['app-server', '--listen', 'stdio://'],
      {
        cwd: this.defaultCwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true,
      },
    );

    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on('data', (chunk: string) => {
      this.lastTransportEvent = `stdio stdout ${chunk.length} chars`;
      this.onTextData(chunk);
    });

    this.proc.stderr?.setEncoding('utf8');
    this.proc.stderr?.on('data', (line: string) => {
      this.lastTransportEvent = `stdio stderr ${line.trim().slice(0, 120)}`;
      this.emit('log', line.trim());
    });

    this.proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.lastTransportEvent = `stdio exit code=${code} signal=${signal}`;
      this.started = false;
      this.startPromise = null;
      const err = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
      for (const { reject } of this.pending.values()) {
        reject(err);
      }
      this.pending.clear();
      this.emit('exit', { code, signal });
    });
  }

  private async startWebSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl!);
      this.ws = ws;
      this.lastTransportEvent = `ws connecting ${this.wsUrl}`;

      const timer = setTimeout(() => {
        this.lastTransportEvent = `ws connect timeout ${this.wsUrl}`;
        ws.terminate();
        reject(new Error(`connect timeout: ${this.wsUrl}`));
      }, this.connectTimeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        this.lastTransportEvent = `ws open ${this.wsUrl}`;
        resolve();
      });

      ws.on('message', (data: string | Buffer | ArrayBuffer | Buffer[]) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part as ArrayBuffer))).toString('utf8')
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : typeof data === 'string'
              ? data
              : Buffer.from(data).toString('utf8');
        this.lastTransportEvent = `ws message ${text.slice(0, 120)}`;
        this.onTextData(text);
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        this.lastTransportEvent = `ws error ${err.message}`;
        reject(err);
      });

      ws.on('close', () => {
        this.lastTransportEvent = `ws close state=${formatWebSocketState(ws.readyState)}`;
        this.started = false;
        this.startPromise = null;
        for (const { reject } of this.pending.values()) {
          reject(new Error('codex app-server websocket closed'));
        }
        this.pending.clear();
        this.emit('exit', { code: null, signal: 'ws-closed' });
      });
    });
  }

  private async initialize(): Promise<void> {
    const capabilities: InitializeCapabilities = {
      experimentalApi: true,
      requestAttestation: true,
    };
    const params: InitializeParams = {
      clientInfo: {
        name: 'codex-remote-windows',
        title: 'codex-remote-windows',
        version: '0.1.0',
      },
      capabilities,
    };

    await this.request('initialize', params);
    this.notify('initialized');
  }

  private buildRequestTimeoutMessage(method: SupportedRequestMethod): string {
    const wsState = this.ws ? formatWebSocketState(this.ws.readyState) : 'not-connected';
    const transport = this.ws ? `wsUrl=${this.wsUrl} wsState=${wsState}` : `stdio pid=${this.proc?.pid ?? 'none'}`;
    return `request timeout for ${method}; ${transport}; lastTransportEvent=${this.lastTransportEvent}`;
  }

  private send(payload: object): void {
    const line = JSON.stringify(payload);
    this.lastTransportEvent = `send ${line.slice(0, 160)}`;

    if (this.ws) {
      this.ws.send(line);
      return;
    }

    this.proc?.stdin?.write(`${line}\n`);
  }

  private onTextData(chunk: string): void {
    if (this.ws) {
      const rawMessages = chunk.includes('\n')
        ? chunk.split('\n').map((part) => part.trim()).filter(Boolean)
        : [chunk.trim()].filter(Boolean);

      for (const raw of rawMessages) {
        this.handleRawMessage(raw, 'ws');
      }
      return;
    }

    this.buffer += chunk;

    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) {
        break;
      }

      const raw = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!raw) {
        continue;
      }

      this.handleRawMessage(raw, 'stdio');
    }
  }

  private handleRawMessage(raw: string, transport: 'ws' | 'stdio'): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.emit('log', `${transport} parse error: ${(error as Error).message}; raw=${raw.slice(0, 240)}`);
      return;
    }

    this.handleMessage(parsed);
  }

  private handleMessage(message: unknown): void {
    if (isServerRequestMessage(message)) {
      this.emit('server_request', message);
      return;
    }

    if (isResponseEnvelope(message)) {
      const entry = this.pending.get(String(message.id));
      if (!entry) {
        return;
      }

      clearTimeout(entry.timeout);
      this.pending.delete(String(message.id));

      if (Object.prototype.hasOwnProperty.call(message, 'error') && message.error !== undefined && message.error !== null) {
        entry.reject(new Error(`${entry.method} failed: ${JSON.stringify(message.error)}`));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    if (isServerNotificationMessage(message)) {
      this.emit('notification', message);
    }
  }
}

type TurnStartParamsInput = Array<Extract<UserInput, { type: 'text' | 'localImage' }>>;

function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return isObject(value)
    && Object.prototype.hasOwnProperty.call(value, 'id')
    && !Object.prototype.hasOwnProperty.call(value, 'method');
}

function isServerRequestMessage(value: unknown): value is ServerRequest {
  return isObject(value)
    && typeof value.method === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'id');
}

function isServerNotificationMessage(value: unknown): value is ServerNotification {
  return isObject(value)
    && typeof value.method === 'string'
    && !Object.prototype.hasOwnProperty.call(value, 'id');
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object';
}

function formatWebSocketState(state: number | undefined): string {
  switch (state) {
    case WebSocket.CONNECTING:
      return 'CONNECTING';
    case WebSocket.OPEN:
      return 'OPEN';
    case WebSocket.CLOSING:
      return 'CLOSING';
    case WebSocket.CLOSED:
      return 'CLOSED';
    default:
      return String(state ?? 'unknown');
  }
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeReasoningEffort(value: string | null | undefined): ReasoningEffort | null {
  return value && REASONING_EFFORTS.has(value as ReasoningEffort)
    ? value as ReasoningEffort
    : null;
}

function normalizeSandboxMode(value: string | null | undefined): SandboxMode | null {
  return value && SANDBOX_MODES.has(value as SandboxMode)
    ? value as SandboxMode
    : null;
}

function normalizeApprovalPolicy(value: string | null | undefined): AskForApproval | null {
  return value && STRING_APPROVAL_POLICIES.has(value as Extract<AskForApproval, string>)
    ? value as Extract<AskForApproval, string>
    : null;
}

function buildReasoningConfig(effort: string | null | undefined): Record<string, ReasoningEffort> | null {
  const normalized = normalizeReasoningEffort(effort);
  return normalized ? { model_reasoning_effort: normalized } : null;
}

function projectRuntimeThread(
  thread: Thread,
  response: Pick<ThreadStartResponse | ThreadResumeResponse, 'model' | 'serviceTier' | 'approvalPolicy' | 'reasoningEffort' | 'cwd' | 'sandbox'>
    & { initialTurnsPage?: v2.TurnsPage | null },
): RuntimeThread {
  const initialTurns = Array.isArray(response.initialTurnsPage?.data)
    ? [...response.initialTurnsPage.data].reverse()
    : [];
  return {
    ...thread,
    turns: mergeInitialTurns(thread.turns, initialTurns),
    model: response.model,
    serviceTier: response.serviceTier,
    approvalPolicy: stringifyApprovalPolicy(response.approvalPolicy),
    approvalPolicyRaw: response.approvalPolicy,
    reasoningEffort: response.reasoningEffort,
    cwd: response.cwd || thread.cwd,
    sandboxMode: normalizeSandboxModeFromPolicy(response.sandbox) || undefined,
    sandboxPolicy: response.sandbox,
  };
}

function mergeInitialTurns(threadTurns: Turn[] | undefined, initialTurns: Turn[]): Turn[] {
  const currentTurns = Array.isArray(threadTurns) ? threadTurns : [];
  if (!initialTurns.length) {
    return currentTurns;
  }

  const merged = [...initialTurns];
  const indexById = new Map<string, number>();
  for (let index = 0; index < merged.length; index += 1) {
    const turnId = merged[index]?.id;
    if (typeof turnId === 'string' && turnId) {
      indexById.set(turnId, index);
    }
  }

  for (const turn of currentTurns) {
    const turnId = typeof turn?.id === 'string' ? turn.id : '';
    const existingIndex = turnId ? indexById.get(turnId) : undefined;
    if (existingIndex === undefined) {
      merged.push(turn);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      ...turn,
      items: Array.isArray(turn.items) && turn.items.length ? turn.items : existing.items,
    };
  }

  return merged;
}

function stringifyApprovalPolicy(value: AskForApproval | null | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'granular' in value) {
    return 'granular';
  }
  return undefined;
}

function normalizeSandboxModeFromPolicy(value: SandboxPolicy | SandboxMode | string | null | undefined): SandboxMode | '' {
  if (typeof value === 'string' && SANDBOX_MODES.has(value as SandboxMode)) {
    return value as SandboxMode;
  }
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return '';
  }

  switch (value.type) {
    case 'dangerFullAccess':
      return 'danger-full-access';
    case 'readOnly':
      return 'read-only';
    case 'workspaceWrite':
      return 'workspace-write';
    default:
      return '';
  }
}

function buildSandboxPolicy(
  sandboxMode: string | null | undefined,
  cwd: string | null | undefined,
): SandboxPolicy | null {
  const normalized = normalizeSandboxMode(sandboxMode);
  if (!normalized) {
    return null;
  }
  if (normalized === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }
  if (normalized === 'read-only') {
    return { type: 'readOnly', networkAccess: false };
  }
  return {
    type: 'workspaceWrite',
    writableRoots: cwd ? [cwd] : [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

export function projectThreadSettings(
  settings: Pick<v2.ThreadSettings, 'cwd' | 'approvalPolicy' | 'sandboxPolicy' | 'model' | 'effort'>
  | {
    cwd?: string | null;
    approvalPolicy?: v2.AskForApproval | null;
    sandboxPolicy?: v2.SandboxPolicy | null;
    model?: string | null;
    effort?: ReasoningEffort | null;
  },
): ThreadSettingsSnapshot {
  return {
    cwd: typeof settings.cwd === 'string' ? settings.cwd : undefined,
    model: typeof settings.model === 'string' ? settings.model : undefined,
    approvalPolicy: stringifyApprovalPolicy(settings.approvalPolicy),
    approvalPolicyRaw: settings.approvalPolicy ?? null,
    reasoningEffort: settings.effort ?? null,
    sandboxMode: normalizeSandboxModeFromPolicy(settings.sandboxPolicy) || undefined,
    sandboxPolicy: settings.sandboxPolicy ?? null,
  };
}
