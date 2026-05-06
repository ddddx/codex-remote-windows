const { spawn } = require('child_process');
const { applyLocalConfig } = require('./src/localConfig');

applyLocalConfig();

const CODEX_CMD = process.env.CODEX_CMD || 'codex.cmd';
const APP_SERVER_WS = process.env.CODEX_APP_SERVER_WS || 'ws://127.0.0.1:4792';

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

appServer.stdout.on('data', d => process.stdout.write(d));
appServer.stderr.on('data', d => process.stderr.write(d));
appServer.on('exit', code => {
  console.log(`app-server exited with code ${code}`);
  if (shuttingDown) {
    process.exit(0);
    return;
  }
  process.exit(code || 1);
});

process.on('SIGINT', () => {
  shuttingDown = true;
  appServer.kill('SIGTERM');
});

process.on('SIGTERM', () => {
  shuttingDown = true;
  appServer.kill('SIGTERM');
});
