const { spawn, spawnSync, fork } = require('node:child_process');
const fs = require('node:fs');
const { URL } = require('node:url');
const path = require('node:path');
const net = require('node:net');

const { applyLocalConfig } = require('./src/localConfig');

applyLocalConfig();

const MODE = (process.argv[2] || 'restart').trim().toLowerCase();
const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const APP_SERVER_WS = process.env.CODEX_APP_SERVER_WS || 'ws://127.0.0.1:4792';
const APP_SERVER_PORT = Number.parseInt(new URL(APP_SERVER_WS).port || '4792', 10);
const ports = Array.from(new Set([APP_SERVER_PORT, PORT].filter(Number.isFinite)));
const CODEX_CMD = process.env.CODEX_CMD || 'codex.cmd';
const SHUTDOWN_TIMEOUT_MS = 10000;
const RESTART_BASE_DELAY_MS = parsePositiveIntegerEnv(process.env.RESTART_BASE_DELAY_MS, 1000);
const RESTART_MAX_DELAY_MS = Math.max(
  RESTART_BASE_DELAY_MS,
  parsePositiveIntegerEnv(process.env.RESTART_MAX_DELAY_MS, 30000)
);
const RESTART_RESET_WINDOW_MS = parsePositiveIntegerEnv(process.env.RESTART_RESET_WINDOW_MS, 60000);
const LOG_DIR = path.join(process.cwd(), '.codex-remote-logs');
const SESSION_TAG = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `${SESSION_TAG}-${MODE}.log`);

fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function timestamp() {
  return new Date().toISOString();
}

function stringifyLogPart(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parsePositiveIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function writeLog(scope, ...parts) {
  const text = parts.map((part) => stringifyLogPart(part)).join(' ');
  logStream.write(`[${timestamp()}] [${scope}] ${text}\n`);
}

function relayChunk(targetStream, scope, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  targetStream.write(`[${scope}] ${text}`);
  const normalized = text.endsWith('\n') ? text : `${text}\n`;
  for (const line of normalized.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    writeLog(scope, line);
  }
}

function attachChildLogging(child, scope) {
  child.stdout?.on('data', (chunk) => relayChunk(process.stdout, scope, chunk));
  child.stderr?.on('data', (chunk) => relayChunk(process.stderr, scope, chunk));
  child.on('error', (error) => {
    console.error(`[${scope}] process error: ${error.stack || error.message}`);
    writeLog(scope, `process error: ${error.stack || error.message}`);
  });
  child.on('close', (code, signal) => {
    writeLog(scope, `close code=${code} signal=${signal || 'none'}`);
  });
}

writeLog('startup', `mode=${MODE}`);
writeLog('startup', `log file=${LOG_FILE}`);
writeLog('startup', `ports=${ports.join(', ')}`);
writeLog('startup', `codex_cmd=${CODEX_CMD}`);
writeLog('startup', `app_server_ws=${APP_SERVER_WS}`);

process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaught exception:', error);
  writeLog('fatal', `uncaught exception: ${error.stack || error.message}`);
  logStream.end();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection:', reason);
  writeLog('fatal', `unhandled rejection: ${stringifyLogPart(reason)}`);
});

function killProcessesOnPorts(targetPorts) {
  if (!targetPorts.length) {
    return;
  }

  const script = `
$ports = @(${targetPorts.join(',')})
for ($round = 0; $round -lt 5; $round++) {
  $killedAny = $false
  foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
      continue
    }

    $targetPids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($targetPid in $targetPids) {
      try {
        taskkill /PID $targetPid /T /F | Out-Null
        Write-Output ("[stop] killed pid {0} on port {1}" -f $targetPid, $port)
        $killedAny = $true
      } catch {
        Write-Output ("[stop] failed to kill pid {0} on port {1}: {2}" -f $targetPid, $port, $_.Exception.Message)
      }
    }
  }

  if (-not $killedAny) {
    break
  }

  Start-Sleep -Milliseconds 600
}
`.trim();

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      stdio: 'inherit',
      windowsHide: true,
    }
  );

  if (result.error) {
    throw result.error;
  }
}

function waitForPort(port, retries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function tryConnect() {
      const sock = new net.Socket();
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        attempts += 1;
        if (attempts >= retries) {
          reject(new Error('timeout'));
          return;
        }
        setTimeout(tryConnect, 1000);
      });
      sock.connect(port, '127.0.0.1');
    }

    tryConnect();
  });
}

function runAppServerOnly() {
  let shuttingDown = false;
  const appServer = spawn(
    'cmd.exe',
    ['/c', CODEX_CMD, 'app-server', '--listen', APP_SERVER_WS],
    {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  attachChildLogging(appServer, 'appserver');
  appServer.on('exit', (code) => {
    console.log(`app-server exited with code ${code}`);
    writeLog('appserver', `exit code=${code}`);
    process.exit(shuttingDown ? 0 : (code || 1));
  });

  process.on('SIGINT', () => {
    shuttingDown = true;
    appServer.kill('SIGTERM');
  });

  process.on('SIGTERM', () => {
    shuttingDown = true;
    appServer.kill('SIGTERM');
  });
}

function runWebOnly() {
  process.env.CODEX_APP_SERVER_WS = APP_SERVER_WS;
  process.env.PORT = String(PORT);
  require('./src/server.js');
}

function runCombined() {
  let shuttingDown = false;
  let exitCode = 0;
  let appServer = null;
  let webServer = null;
  let activeCycle = 0;
  let restartTimer = null;
  let pendingRestartKind = '';
  let restartAttempt = 0;
  let lastRestartAt = 0;

  function stopChild(child, name) {
    if (!child) {
      return;
    }
    const alreadyExited = child.exitCode !== null || child.signalCode !== null;
    if (alreadyExited) {
      return;
    }

    try {
      child.kill('SIGTERM');
    } catch (error) {
      console.error(`[${name}] failed to stop gracefully: ${error.message}`);
    }
  }

  function isChildRunning(child) {
    return !!child && child.exitCode === null && child.signalCode === null;
  }

  function stopActiveChildren() {
    stopChild(webServer, 'web');
    stopChild(appServer, 'appserver');
  }

  function computeRestartDelay() {
    const now = Date.now();
    if ((now - lastRestartAt) > RESTART_RESET_WINDOW_MS) {
      restartAttempt = 0;
    }
    restartAttempt += 1;
    lastRestartAt = now;
    return Math.min(
      RESTART_BASE_DELAY_MS * Math.pow(2, Math.max(0, restartAttempt - 1)),
      RESTART_MAX_DELAY_MS
    );
  }

  function getRestartPriority(kind) {
    return kind === 'stack' ? 2 : 1;
  }

  function startWebServer(cycleId, reason) {
    if (shuttingDown || activeCycle !== cycleId || !isChildRunning(appServer)) {
      return;
    }

    console.log(`[web] starting (${reason})`);
    writeLog('web', `starting cycle=${cycleId} reason=${reason}`);
    const nextWebServer = fork(
      path.join(__dirname, 'src', 'server.js'),
      [],
      {
        env: {
          ...process.env,
          CODEX_APP_SERVER_WS: APP_SERVER_WS,
          PORT: String(PORT),
        },
        silent: true,
      }
    );
    webServer = nextWebServer;

    attachChildLogging(nextWebServer, 'web');
    nextWebServer.on('exit', (code, signal) => {
      console.log(`[web] exited with code ${code}, signal ${signal || 'none'}`);
      writeLog('web', `exit code=${code} signal=${signal || 'none'}`);
      if (activeCycle !== cycleId || webServer !== nextWebServer) {
        writeLog('supervisor', `ignore stale web exit cycle=${cycleId}`);
        return;
      }

      webServer = null;
      if (shuttingDown) {
        maybeExit();
        return;
      }
      scheduleRestart('web', 'web_exit', code);
    });
    nextWebServer.on('disconnect', () => {
      writeLog('web', 'ipc disconnected');
    });
  }

  function scheduleRestart(kind, reason, code) {
    if (shuttingDown) {
      return;
    }
    if (restartTimer) {
      if (getRestartPriority(kind) <= getRestartPriority(pendingRestartKind)) {
        writeLog('supervisor', `restart already scheduled kind=${pendingRestartKind}, ignore kind=${kind} reason=${reason}`);
        return;
      }

      clearTimeout(restartTimer);
      restartTimer = null;
      writeLog('supervisor', `restart upgraded from kind=${pendingRestartKind} to kind=${kind} reason=${reason}`);
    }

    pendingRestartKind = kind;
    exitCode = code || 1;
    const delay = computeRestartDelay();
    console.error(`[supervisor] ${reason}; restarting ${kind} in ${delay}ms`);
    writeLog('supervisor', `restart scheduled kind=${kind} reason=${reason} delay_ms=${delay} attempt=${restartAttempt}`);
    if (kind === 'web') {
      stopChild(webServer, 'web');
    } else {
      stopActiveChildren();
    }

    restartTimer = setTimeout(() => {
      const restartKind = pendingRestartKind;
      restartTimer = null;
      pendingRestartKind = '';
      if (shuttingDown) {
        return;
      }

      if (restartKind === 'web') {
        startWebServer(activeCycle, `restart:${reason}`);
        return;
      }

      startCycle(`restart:${reason}`);
    }, delay);
  }

  function maybeExit() {
    const appExited = !isChildRunning(appServer);
    const webExited = !isChildRunning(webServer);
    if (appExited && webExited) {
      process.exit(exitCode);
    }
  }

  function startCycle(reason) {
    if (shuttingDown) {
      return;
    }

    const cycleId = activeCycle + 1;
    activeCycle = cycleId;
    console.log(`[supervisor] starting services (${reason})`);
    writeLog('supervisor', `starting cycle=${cycleId} reason=${reason}`);

    const nextAppServer = spawn(
      'cmd.exe',
      ['/c', CODEX_CMD, 'app-server', '--listen', APP_SERVER_WS],
      {
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    appServer = nextAppServer;

    attachChildLogging(nextAppServer, 'appserver');
    nextAppServer.on('exit', (code, signal) => {
      console.log(`[appserver] exited with code ${code}, signal ${signal || 'none'}`);
      writeLog('appserver', `exit code=${code} signal=${signal || 'none'}`);
      if (activeCycle !== cycleId || appServer !== nextAppServer) {
        writeLog('supervisor', `ignore stale appserver exit cycle=${cycleId}`);
        return;
      }

      appServer = null;
      if (shuttingDown) {
        maybeExit();
        return;
      }
      scheduleRestart('stack', 'appserver_exit', code);
    });

    waitForPort(APP_SERVER_PORT, 30).then(() => {
      if (shuttingDown || activeCycle !== cycleId || !isChildRunning(nextAppServer)) {
        return;
      }

      console.log(`[appserver] ready on ${APP_SERVER_PORT}`);
      writeLog('appserver', `ready on ${APP_SERVER_PORT}`);
      startWebServer(cycleId, 'appserver_ready');
    }).catch((error) => {
      if (shuttingDown || activeCycle !== cycleId || !isChildRunning(nextAppServer)) {
        return;
      }
      console.error('[appserver] failed to start:', error.message);
      writeLog('appserver', `failed to start: ${error.stack || error.message}`);
      scheduleRestart('stack', 'startup_failure', 1);
    });
  }

  async function shutdown(reason) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    writeLog('shutdown', `reason=${reason}`);
    if (reason === 'SIGINT' || reason === 'SIGTERM') {
      exitCode = 0;
    }

    console.log(`[shutdown] stopping processes (${reason})`);
    stopActiveChildren();

    setTimeout(() => {
      const appExited = !isChildRunning(appServer);
      const webExited = !isChildRunning(webServer);
      if (!appExited || !webExited) {
        console.error('[shutdown] forcing exit after timeout');
        writeLog('shutdown', 'forcing exit after timeout');
        process.exit(exitCode || 1);
      }
    }, SHUTDOWN_TIMEOUT_MS).unref();

    maybeExit();
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  startCycle('initial');
}

function printUsageAndExit() {
  console.error('Usage: node restart-codex-remote.js [start|restart|stop|appserver|web]');
  process.exit(1);
}

if (MODE === 'stop') {
  console.log(`[stop] cleaning existing listeners on ports: ${ports.join(', ')}`);
  writeLog('stop', `cleaning existing listeners on ports: ${ports.join(', ')}`);
  killProcessesOnPorts(ports);
  process.exit(0);
}

if (MODE === 'restart') {
  console.log(`[restart] cleaning existing listeners on ports: ${ports.join(', ')}`);
  killProcessesOnPorts(ports);
  console.log('[restart] starting Codex Remote...');
  runCombined();
} else if (MODE === 'start') {
  console.log('[start] starting Codex Remote...');
  runCombined();
} else if (MODE === 'appserver') {
  runAppServerOnly();
} else if (MODE === 'web') {
  runWebOnly();
} else {
  printUsageAndExit();
}
