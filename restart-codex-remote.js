const { spawn, spawnSync, fork } = require('node:child_process');
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

  appServer.stdout.on('data', (chunk) => process.stdout.write(chunk));
  appServer.stderr.on('data', (chunk) => process.stderr.write(chunk));
  appServer.on('exit', (code) => {
    console.log(`app-server exited with code ${code}`);
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
  let webServer = null;

  const appServer = spawn(
    'cmd.exe',
    ['/c', CODEX_CMD, 'app-server', '--listen', APP_SERVER_WS],
    {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  appServer.stdout.on('data', (chunk) => process.stdout.write(`[appserver] ${chunk}`));
  appServer.stderr.on('data', (chunk) => process.stderr.write(`[appserver] ${chunk}`));
  appServer.on('exit', (code, signal) => {
    console.log(`[appserver] exited with code ${code}, signal ${signal || 'none'}`);
    handleChildExit('appserver', code);
  });

  waitForPort(APP_SERVER_PORT, 30).then(() => {
    if (shuttingDown) {
      return;
    }

    console.log(`[appserver] ready on ${APP_SERVER_PORT}`);
    webServer = fork(
      path.join(__dirname, 'src', 'server.js'),
      [],
      {
        env: {
          ...process.env,
          CODEX_APP_SERVER_WS: APP_SERVER_WS,
          PORT: String(PORT),
        },
      }
    );

    webServer.on('exit', (code, signal) => {
      console.log(`[web] exited with code ${code}, signal ${signal || 'none'}`);
      handleChildExit('web', code);
    });
  }).catch((error) => {
    if (shuttingDown && error.message === 'shutdown') {
      return;
    }
    console.error('[appserver] failed to start:', error.message);
    exitCode = 1;
    void shutdown('startup_failure');
  });

  function handleChildExit(name, code) {
    if (name === 'web') {
      webServer = null;
    }

    if (shuttingDown) {
      maybeExit();
      return;
    }

    exitCode = code || 1;
    void shutdown(`${name}_exit`);
  }

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

  function maybeExit() {
    const appExited = appServer.exitCode !== null || appServer.signalCode !== null;
    const webExited = !webServer || webServer.exitCode !== null || webServer.signalCode !== null;
    if (appExited && webExited) {
      process.exit(exitCode);
    }
  }

  async function shutdown(reason) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (reason === 'SIGINT' || reason === 'SIGTERM') {
      exitCode = 0;
    }

    console.log(`[shutdown] stopping processes (${reason})`);
    stopChild(webServer, 'web');
    stopChild(appServer, 'appserver');

    setTimeout(() => {
      const appExited = appServer.exitCode !== null || appServer.signalCode !== null;
      const webExited = !webServer || webServer.exitCode !== null || webServer.signalCode !== null;
      if (!appExited || !webExited) {
        console.error('[shutdown] forcing exit after timeout');
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
}

function printUsageAndExit() {
  console.error('Usage: node restart-codex-remote.js [start|restart|stop|appserver|web]');
  process.exit(1);
}

if (MODE === 'stop') {
  console.log(`[stop] cleaning existing listeners on ports: ${ports.join(', ')}`);
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
