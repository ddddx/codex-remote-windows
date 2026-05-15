import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import { URL } from 'node:url';
import { terminateProcessTree } from './process-termination.js';

type AppServerSupervisorOptions = {
  codexCmd?: string;
  codexHome?: string | null;
  wsUrl?: string | null;
  cwd?: string;
  connectTimeoutMs?: number;
};

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveLoopbackAddress(hostname: string): string {
  if (!hostname || hostname === '::' || hostname === '[::]') {
    return '127.0.0.1';
  }
  if (hostname === '0.0.0.0') {
    return '127.0.0.1';
  }
  return hostname;
}

function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  const targetHost = resolveLoopbackAddress(host);

  return new Promise((resolve, reject) => {
    function tryConnect() {
      const socket = new net.Socket();

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        if ((Date.now() - startedAt) >= timeoutMs) {
          reject(new Error(`timeout waiting for app-server on ${targetHost}:${port}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });

      socket.connect(port, targetHost);
    }

    tryConnect();
  });
}

function buildReadyEndpointUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.hostname = resolveLoopbackAddress(parsed.hostname || '127.0.0.1');
  parsed.pathname = '/readyz';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

async function checkReadyEndpoint(readyUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(readyUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function detectAppServerStatus(host: string, port: number, readyUrl: string, timeoutMs: number): Promise<'ready' | 'unreachable' | 'occupied'> {
  try {
    await waitForPort(host, port, timeoutMs);
  } catch {
    return 'unreachable';
  }

  return await checkReadyEndpoint(readyUrl, timeoutMs) ? 'ready' : 'occupied';
}

async function waitForAppServerReady(host: string, port: number, readyUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    if (await detectAppServerStatus(host, port, readyUrl, 500) === 'ready') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`timeout waiting for Codex app-server readiness at ${readyUrl}`);
}

export class CodexAppServerSupervisor {
  readonly codexCmd: string;
  readonly codexHome: string | null;
  readonly wsUrl: string | null;
  readonly cwd: string;
  readonly connectTimeoutMs: number;
  proc: ChildProcess | null;
  managed: boolean;
  startPromise: Promise<void> | null;

  constructor(options: AppServerSupervisorOptions = {}) {
    this.codexCmd = options.codexCmd || process.env.CODEX_CMD || 'codex.cmd';
    this.codexHome = options.codexHome || process.env.CODEX_HOME || null;
    this.wsUrl = options.wsUrl || process.env.CODEX_APP_SERVER_WS || null;
    this.cwd = options.cwd || process.cwd();
    this.connectTimeoutMs = parsePositiveInteger(options.connectTimeoutMs || process.env.CODEX_CONNECT_TIMEOUT, 10000);
    this.proc = null;
    this.managed = false;
    this.startPromise = null;
  }

  get enabled(): boolean {
    return Boolean(this.wsUrl);
  }

  async ensureStarted(): Promise<void> {
    if (!this.wsUrl) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.ensureStartedInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async ensureStartedInternal(): Promise<void> {
    if (!this.wsUrl) {
      return;
    }

    const parsed = new URL(this.wsUrl);
    const port = Number.parseInt(parsed.port || (parsed.protocol === 'wss:' ? '443' : '80'), 10);
    const host = parsed.hostname || '127.0.0.1';
    const targetHost = resolveLoopbackAddress(host);
    const readyUrl = buildReadyEndpointUrl(this.wsUrl);

    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) {
      await waitForAppServerReady(host, port, readyUrl, this.connectTimeoutMs);
      this.managed = true;
      return;
    }

    const existingStatus = await detectAppServerStatus(host, port, readyUrl, 1200);
    if (existingStatus === 'ready') {
      this.managed = false;
      return;
    }
    if (existingStatus === 'occupied') {
      throw new Error(`port ${targetHost}:${port} is already in use by a non-Codex service; expected ready endpoint at ${readyUrl}`);
    }

    const env = { ...process.env };
    if (this.codexHome) {
      if (!fs.existsSync(this.codexHome)) {
        fs.mkdirSync(this.codexHome, { recursive: true });
      }
      env.CODEX_HOME = this.codexHome;
    }

    this.proc = spawn(
      this.codexCmd,
      ['app-server', '--listen', this.wsUrl],
      {
        cwd: this.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true,
      },
    );

    const proc = this.proc;
    const stderrBuffer: string[] = [];
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (!text) {
        return;
      }
      stderrBuffer.push(text);
      if (stderrBuffer.length > 8) {
        stderrBuffer.shift();
      }
    });
    proc.on('exit', () => {
      this.proc = null;
      this.managed = false;
    });

    try {
      await waitForAppServerReady(host, port, readyUrl, this.connectTimeoutMs);
    } catch (error) {
      const suffix = stderrBuffer.length ? `; app-server stderr: ${stderrBuffer.join(' | ')}` : '';
      throw new Error(`${(error as Error).message}${suffix}`);
    }
    this.managed = true;
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      proc.once('exit', finish);
      try {
        void terminateProcessTree(proc.pid).finally(finish);
      } catch {
        finish();
        return;
      }
    });

    this.proc = null;
    this.managed = false;
    this.startPromise = null;
  }
}
