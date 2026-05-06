const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const WebSocket = require('ws');

class CodexAppServerClient extends EventEmitter {
  constructor(options = {}) {
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
      await this.#startWebSocket();
    } else {
      await this.#startStdio();
    }

    await this.#initialize();
    this.started = true;
  }

  async stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }

    this.started = false;
  }

  async request(method, params = {}) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }

    const id = String(this.nextId++);
    const payload = { id, method, params };

    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request timeout for ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeout, method });
    });

    this.#send(payload);
    return promise;
  }

  respond(id, result = {}) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.#send({ id, result });
  }

  respondError(id, error) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.#send({ id, error });
  }

  notify(method, params = {}) {
    if (!this.proc && !this.ws) {
      throw new Error('codex app-server is not running');
    }
    this.#send({ method, params });
  }

  async listThreads(limit = 100) {
    const result = await this.request('thread/list', { limit, archived: false });
    return result.data || [];
  }

  async startThread({ name } = {}) {
    const result = await this.request('thread/start', {
      cwd: this.defaultCwd,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });

    const thread = result.thread;
    if (name) {
      await this.request('thread/name/set', { threadId: thread.id, name });
      thread.name = name;
    }
    return thread;
  }

  async archiveThread(threadId) {
    await this.request('thread/archive', { threadId });
  }

  async readThread(threadId) {
    const result = await this.request('thread/read', { threadId, includeTurns: true });
    return result.thread;
  }

  async resumeThread(threadId, options = {}) {
    const result = await this.request('thread/resume', {
      threadId,
      excludeTurns: options.excludeTurns === true,
    });
    return result.thread;
  }

  async startTurn(threadId, text) {
    const result = await this.request('turn/start', {
      threadId,
      input: [
        {
          type: 'text',
          text,
          text_elements: [],
        },
      ],
    });
    return result.turn;
  }

  async #startStdio() {
    const env = { ...process.env };
    if (this.codexHome) {
      env.CODEX_HOME = this.codexHome;
    }

    this.proc = spawn(
      'cmd.exe',
      ['/d', '/s', '/c', `"${this.codexCmd}" app-server --listen stdio://`],
      {
        cwd: this.defaultCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.#onTextData(chunk));

    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (line) => {
      this.emit('log', line.trim());
    });

    this.proc.on('exit', (code, signal) => {
      this.started = false;
      const err = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
      for (const { reject } of this.pending.values()) {
        reject(err);
      }
      this.pending.clear();
      this.emit('exit', { code, signal });
    });
  }

  async #startWebSocket() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`connect timeout: ${this.wsUrl}`));
      }, this.connectTimeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });

      ws.on('message', (data) => {
        this.#onTextData(data.toString('utf8'));
      });

      ws.on('error', (err) => {
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

  async #initialize() {
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

  #send(payload) {
    const line = JSON.stringify(payload);

    if (this.ws) {
      this.ws.send(line);
      return;
    }

    this.proc.stdin.write(`${line}\n`);
  }

  #onTextData(chunk) {
    // For WebSocket mode, each message is complete
    if (this.ws) {
      try {
        const msg = JSON.parse(chunk.trim());
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
      } catch (e) {
        this.emit('log', `ws parse error: ${e.message}`);
      }
      return;
    }

    // Stdio mode: newline-delimited
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

      let msg;
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

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

module.exports = { CodexAppServerClient };
