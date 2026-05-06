const { spawn, fork } = require('child_process');
const path = require('path');
const net = require('net');
const { applyLocalConfig } = require('./src/localConfig');

applyLocalConfig();

const CODEX_CMD = process.env.CODEX_CMD || 'codex.cmd';
const APP_SERVER_WS = process.env.CODEX_APP_SERVER_WS || 'ws://127.0.0.1:4792';
const PORT = process.env.PORT || '8787';
const APP_SERVER_PORT = Number.parseInt(new URL(APP_SERVER_WS).port || '4792', 10);
const SHUTDOWN_TIMEOUT_MS = 10000;

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

appServer.stdout.on('data', d => process.stdout.write(`[appserver] ${d}`));
appServer.stderr.on('data', d => process.stderr.write(`[appserver] ${d}`));
appServer.on('exit', (code, signal) => {
  console.log(`[appserver] exited with code ${code}, signal ${signal || 'none'}`);
  handleChildExit('appserver', code);
});

function waitForPort(port, retries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function tryConnect() {
      if (shuttingDown) {
        reject(new Error('shutdown'));
        return;
      }

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
        PORT,
      },
    }
  );

  webServer.on('exit', (code, signal) => {
    console.log(`[web] exited with code ${code}, signal ${signal || 'none'}`);
    handleChildExit('web', code);
  });
}).catch((err) => {
  if (shuttingDown && err.message === 'shutdown') {
    return;
  }
  console.error('[appserver] failed to start:', err.message);
  exitCode = 1;
  void shutdown('startup_failure');
});

function handleChildExit(name, code) {
  if (name === 'web') {
    webServer = null;
  }

  if (shuttingDown) {
    if (!appServer.exitCode && appServer.killed) {
      // wait for actual exit event
    }
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
