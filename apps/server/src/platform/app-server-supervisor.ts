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

export class CodexAppServerSupervisor {
  readonly codexCmd: string;
  readonly codexHome: string | null;
  readonly wsUrl: string | null;
  readonly cwd: string;
  readonly connectTimeoutMs: number;
  proc: ChildProcess | null;
  managed: boolean;

  constructor(options: AppServerSupervisorOptions = {}) {
    this.codexCmd = options.codexCmd || process.env.CODEX_CMD || 'codex.cmd';
    this.codexHome = options.codexHome || process.env.CODEX_HOME || null;
    this.wsUrl = options.wsUrl || process.env.CODEX_APP_SERVER_WS || null;
    this.cwd = options.cwd || process.cwd();
    this.connectTimeoutMs = parsePositiveInteger(options.connectTimeoutMs || process.env.CODEX_CONNECT_TIMEOUT, 10000);
    this.proc = null;
    this.managed = false;
  }

  get enabled(): boolean {
    return Boolean(this.wsUrl);
  }

  async ensureStarted(): Promise<void> {
    if (!this.wsUrl) {
      return;
    }

    const parsed = new URL(this.wsUrl);
    const port = Number.parseInt(parsed.port || (parsed.protocol === 'wss:' ? '443' : '80'), 10);
    const host = parsed.hostname || '127.0.0.1';

    try {
      await waitForPort(host, port, 1200);
      this.managed = false;
      return;
    } catch {
      // Continue and try to start a managed app-server.
    }

    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) {
      await waitForPort(host, port, this.connectTimeoutMs);
      this.managed = true;
      return;
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
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', () => {});
    proc.on('exit', () => {
      this.proc = null;
      this.managed = false;
    });

    await waitForPort(host, port, this.connectTimeoutMs);
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
  }
}
