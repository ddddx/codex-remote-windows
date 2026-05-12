import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
import { terminateProcessTree } from './process-termination.js';

type StartThreadOptions = {
  name?: string | null;
  cwd?: string | null;
  model?: string | null;
  approvalPolicy?: string | null;
  sandbox?: string | null;
};

type StartTurnOptions = {
  attachments?: Array<{ path: string; name?: string }>;
  model?: string | null;
  effort?: string | null;
  approvalPolicy?: string | null;
  sandboxPolicy?: { mode: string } | null;
};

type CodexClientOptions = {
  codexCmd?: string;
  codexHome?: string | null;
  cwd?: string;
  wsUrl?: string | null;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
};

export class CodexAppServerClient extends EventEmitter {
  readonly codexCmd: string;
  readonly codexHome: string | null;
  readonly defaultCwd: string;
  readonly wsUrl: string | null;
  readonly requestTimeoutMs: number;
  readonly connectTimeoutMs: number;
  proc: ReturnType<typeof spawn> | null;
  ws: WebSocket | null;
  nextId: number;
  pending: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    method: string;
  }>;
  buffer: string;
  started: boolean;

  constructor(options: CodexClientOptions = {}) {
    super();
    this.codexCmd = options.codexCmd || process.env.CODEX_CMD || 'codex.cmd';
    this.codexHome = options.codexHome || process.env.CODEX_HOME || null;
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
  }

  async start() {
    if (this.started) {
      return;
    }

    if (this.codexHome && !fs.existsSync(this.codexHome)) {
      fs.mkdirSync(this.codexHome, { recursive: true });
    }

    if (this.wsUrl) {
      await this.startWebSocket();
    } else {
      await this.startStdio();
    }

    await this.initialize();
    this.started = true;
  }

  async stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.proc) {
      await terminateProcessTree(this.proc.pid);
      this.proc = null;
    }

    this.started = false;
  }

  async request(method: string, params: Record<string, unknown> = {}) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }

    const id = String(this.nextId++);
    const payload = { id, method, params };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request timeout for ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeout, method });
    });

    this.send(payload);
    return promise;
  }

  respond(id: string | number, result: unknown = {}) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.send({ id, result });
  }

  respondError(id: string | number, error: unknown) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.send({ id, error });
  }

  notify(method: string, params: Record<string, unknown> = {}) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.send({ method, params });
  }

  async listThreads(limit = 100) {
    const result = await this.request('thread/list', { limit, archived: false }) as { data?: Array<Record<string, unknown>> };
    return result.data || [];
  }

  async startThread({ name, cwd, model, approvalPolicy, sandbox }: StartThreadOptions = {}) {
    const workingCwd = cwd || this.defaultCwd;
    const result = await this.request('thread/start', {
      model: model || null,
      approvalPolicy: approvalPolicy || null,
      sandbox: sandbox || null,
      cwd: workingCwd,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    }) as { thread: Record<string, unknown> };

    const thread = result.thread;
    thread.cwd = thread.cwd || workingCwd;
    if (name) {
      await this.request('thread/name/set', { threadId: thread.id, name });
      thread.name = name;
    }
    return thread;
  }

  async resumeThread(threadId: string, options: { excludeTurns?: boolean } = {}) {
    const result = await this.request('thread/resume', {
      threadId,
      excludeTurns: options.excludeTurns === true,
    }) as { thread: Record<string, unknown> };
    return result.thread;
  }

  async startTurn(threadId: string, text: string, options: StartTurnOptions = {}) {
    const input: Array<Record<string, unknown>> = [];
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
      effort: options.effort || null,
      approvalPolicy: options.approvalPolicy || null,
      sandboxPolicy: options.sandboxPolicy || null,
      input,
    }) as { turn: Record<string, unknown> };
    return result.turn;
  }

  async listModels({ includeHidden = false, limit = 200 } = {}) {
    const data: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;

    do {
      const result = await this.request('model/list', {
        includeHidden,
        limit,
        cursor,
      }) as { data?: Array<Record<string, unknown>>; nextCursor?: string | null };
      const page = Array.isArray(result.data) ? result.data : [];
      data.push(...page);
      cursor = result.nextCursor || null;
    } while (cursor);

    return data;
  }

  async readConfig({ cwd }: { cwd?: string } = {}) {
    return this.request('config/read', {
      includeLayers: false,
      cwd: cwd || null,
    }) as Promise<{ config?: Record<string, unknown> }>;
  }

  private async startStdio() {
    const env = { ...process.env };
    if (this.codexHome) {
      env.CODEX_HOME = this.codexHome;
    }

    this.proc = spawn(
      this.codexCmd,
      ['app-server', '--listen', 'stdio://'],
      {
        cwd: this.defaultCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true,
      },
    );

    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on('data', (chunk: string) => this.onTextData(chunk));

    this.proc.stderr?.setEncoding('utf8');
    this.proc.stderr?.on('data', (line: string) => {
      this.emit('log', line.trim());
    });

    this.proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.started = false;
      const err = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
      for (const { reject } of this.pending.values()) {
        reject(err);
      }
      this.pending.clear();
      this.emit('exit', { code, signal });
    });
  }

  private async startWebSocket() {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl!);
      this.ws = ws;

      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`connect timeout: ${this.wsUrl}`));
      }, this.connectTimeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });

      ws.on('message', (data: string | Buffer | ArrayBuffer | Buffer[]) => {
        this.onTextData(data.toString('utf8'));
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });

      ws.on('close', () => {
        this.started = false;
        for (const { reject } of this.pending.values()) {
          reject(new Error('codex app-server websocket closed'));
        }
        this.pending.clear();
        this.emit('exit', { code: null, signal: 'ws-closed' });
      });
    });
  }

  private async initialize() {
    await this.request('initialize', {
      clientInfo: {
        name: 'codex-remote-tabs',
        title: 'Codex Remote Tabs',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
      version: '0.1.0',
    });

    this.notify('initialized', {});
  }

  private send(payload: Record<string, unknown>) {
    const line = JSON.stringify(payload);

    if (this.ws) {
      this.ws.send(line);
      return;
    }

    this.proc?.stdin?.write(`${line}\n`);
  }

  private onTextData(chunk: string) {
    if (this.ws) {
      try {
        const msg = JSON.parse(chunk.trim()) as Record<string, any>;
        if (msg.method && Object.prototype.hasOwnProperty.call(msg, 'id')) {
          this.emit('server_request', msg);
        } else if (msg.method) {
          this.emit('notification', msg);
        } else if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
          const entry = this.pending.get(String(msg.id));
          if (entry) {
            clearTimeout(entry.timeout);
            this.pending.delete(String(msg.id));
            if (msg.error) {
              entry.reject(new Error(`${entry.method} failed: ${JSON.stringify(msg.error)}`));
            } else {
              entry.resolve(msg.result);
            }
          }
        }
      } catch (error) {
        this.emit('log', `ws parse error: ${(error as Error).message}`);
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

      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw);
      } catch {
        this.emit('log', `non-json output: ${raw}`);
        continue;
      }

      if (msg.method && Object.prototype.hasOwnProperty.call(msg, 'id')) {
        this.emit('server_request', msg);
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
        const entry = this.pending.get(String(msg.id));
        if (!entry) {
          continue;
        }

        clearTimeout(entry.timeout);
        this.pending.delete(String(msg.id));

        if (msg.error) {
          entry.reject(new Error(`${entry.method} failed: ${JSON.stringify(msg.error)}`));
        } else {
          entry.resolve(msg.result);
        }
        continue;
      }

      if (msg.method) {
        this.emit('notification', msg);
      }
    }
  }
}

function parsePositiveInteger(value: unknown) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
