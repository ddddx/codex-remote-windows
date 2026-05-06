const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');
const path = require('node:path');

const { applyLocalConfig } = require('./src/localConfig');

applyLocalConfig();

const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const APP_SERVER_WS = process.env.CODEX_APP_SERVER_WS || 'ws://127.0.0.1:4792';
const APP_SERVER_PORT = Number.parseInt(new URL(APP_SERVER_WS).port || '4792', 10);
const ports = Array.from(new Set([APP_SERVER_PORT, PORT].filter(Number.isFinite)));

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

function startAll() {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'start-all.js')],
    {
      stdio: 'inherit',
      windowsHide: false,
      env: process.env,
    }
  );

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

console.log(`[restart] cleaning existing listeners on ports: ${ports.join(', ')}`);
killProcessesOnPorts(ports);
console.log('[restart] starting Codex Remote...');
startAll();
