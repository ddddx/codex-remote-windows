import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const lifecycleLogPath = path.join(repoRoot, '.server-lifecycle.log');
const defaultPort = 18637;

export function parsePort(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function appendLifecycleLog(kind, details = {}) {
  try {
    const payload = [
      `time=${new Date().toISOString()}`,
      `kind=${kind}`,
      `pid=${process.pid}`,
      `details=${JSON.stringify(details)}`,
      '',
    ].join('\n');
    fs.appendFileSync(lifecycleLogPath, payload, 'utf8');
  } catch {
    // Port cleanup must not fail because diagnostic logging failed.
  }
}

function readLocalConfigPort() {
  const configPath = path.join(repoRoot, 'config.local.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsePort(parsed.PORT) : null;
  } catch {
    return null;
  }
}

export function resolveTargetPort(argv = process.argv, env = process.env) {
  const explicitPort = argv[2];
  if (explicitPort !== undefined) {
    const parsed = parsePort(explicitPort);
    if (!parsed) {
      throw new Error(`Invalid port: ${explicitPort}`);
    }
    return parsed;
  }

  return parsePort(env.PORT) || readLocalConfigPort() || defaultPort;
}

export function checkPortState(targetPort) {
  if (process.platform === 'win32') {
    return checkWindowsPortState(targetPort);
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error) {
        resolve(error.code === 'EADDRINUSE' ? 'in-use' : 'unknown');
        return;
      }
      reject(error);
    });

    server.once('listening', () => {
      server.close(() => resolve('free'));
    });

    server.listen(targetPort, '0.0.0.0');
  });
}

function checkWindowsPortState(targetPort) {
  try {
    const output = childProcess.execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$conn = Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        'if ($conn) { Write-Output "in-use" } else { Write-Output "free" }',
      ],
      { encoding: 'utf8' },
    ).trim();
    return Promise.resolve(output === 'in-use' ? 'in-use' : 'free');
  } catch {
    return Promise.resolve('unknown');
  }
}

export async function freeWindowsPort(targetPort) {
  const state = await checkPortState(targetPort);
  if (state === 'free') {
    console.log(`PORT ${targetPort} already free`);
    return;
  }
  if (process.platform !== 'win32') {
    throw new Error(`Port ${targetPort} is in use`);
  }

  const output = childProcess.execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$conn = Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; Start-Sleep -Milliseconds 400; Write-Output "STOPPED $($conn.OwningProcess)" }`,
    ],
    { encoding: 'utf8' },
  );

  const nextState = await checkPortState(targetPort);
  if (nextState !== 'free') {
    throw new Error(`Failed to free port ${targetPort}`);
  }

  process.stdout.write(output || `FREED ${targetPort}\n`);
  appendLifecycleLog('free-port:stopped', {
    port: targetPort,
    output: output.trim(),
  });
}

async function main() {
  const port = resolveTargetPort();
  await freeWindowsPort(port);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    appendLifecycleLog('free-port:error', { message });
    console.error(message);
    process.exit(1);
  });
}
