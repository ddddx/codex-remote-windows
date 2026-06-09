import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { applyLocalConfig } from './config/local-config.js';
import { resolveRepoPath } from './runtime-paths.js';
import fs from 'node:fs';

function formatUnknown(value: unknown): string {
  return value instanceof Error ? (value.stack || value.message) : String(value);
}

function appendDiagnosticLog(fileName: string, kind: string, details: unknown): void {
  try {
    const payload = [
      `time=${new Date().toISOString()}`,
      `kind=${kind}`,
      `pid=${process.pid}`,
      formatUnknown(details),
      '',
    ].join('\n');
    fs.appendFileSync(resolveRepoPath(fileName), payload, 'utf8');
  } catch {
    // Avoid recursive diagnostic logging failures.
  }
}

function appendCrashLog(kind: string, error: unknown): void {
  appendDiagnosticLog('.server-crash.log', kind, error);
}

function appendLifecycleLog(kind: string, details: Record<string, unknown> = {}): void {
  appendDiagnosticLog('.server-lifecycle.log', kind, JSON.stringify(details));
}

let diagnosticsRegistered = false;

function registerProcessDiagnostics(): void {
  if (diagnosticsRegistered) {
    return;
  }
  diagnosticsRegistered = true;

  process.on('beforeExit', (code) => {
    appendLifecycleLog('beforeExit', { code });
  });
  process.on('exit', (code) => {
    appendLifecycleLog('exit', { code });
  });
  process.on('uncaughtExceptionMonitor', (error) => {
    appendCrashLog('uncaughtException', error);
  });
  process.on('unhandledRejection', (reason) => {
    appendCrashLog('unhandledRejection', reason);
  });
}

registerProcessDiagnostics();

async function main(): Promise<void> {
  applyLocalConfig();
  const config = loadConfig();
  appendLifecycleLog('starting', {
    host: config.host,
    port: config.port,
    nodeEnv: config.nodeEnv,
  });
  const app = await createApp(config);
  let windowStatusTimer: NodeJS.Timeout | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async (reason: string) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      appendLifecycleLog('shutdown:start', { reason });
      app.runtimeState.isShuttingDown = true;
      if (windowStatusTimer) {
        clearInterval(windowStatusTimer);
        windowStatusTimer = null;
      }
      try {
        if (app.runtimeState.codexStarted) {
          await app.codexClient.stop();
        }
        await app.appServerSupervisor.stop();
        await app.close();
        appendLifecycleLog('shutdown:complete', { reason });
        process.exit(0);
      } catch (error) {
        appendCrashLog(`shutdown:${reason}`, error);
        appendLifecycleLog('shutdown:error', {
          reason,
          message: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    })();
    return shutdownPromise;
  };

  process.on('SIGINT', () => {
    appendLifecycleLog('signal', { signal: 'SIGINT' });
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    appendLifecycleLog('signal', { signal: 'SIGTERM' });
    void shutdown('SIGTERM');
  });

  await app.listen({
    host: config.host,
    port: config.port,
  });
  appendLifecycleLog('listening', {
    host: config.host,
    port: config.port,
  });

  await app.windowAttachments.refreshAllTabsWindowStatus().catch(() => {});
  windowStatusTimer = setInterval(() => {
    void app.windowAttachments.refreshAllTabsWindowStatus().catch(() => {});
  }, 15000);
  windowStatusTimer.unref?.();
}

void main().catch((error) => {
  appendCrashLog('main', error);
  appendLifecycleLog('main:error', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
