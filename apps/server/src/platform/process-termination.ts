import { execFile } from 'node:child_process';

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}\n${stderr || ''}`.trim()));
          return;
        }
        resolve();
      },
    );
  });
}

export async function terminateProcessTree(pid: number | undefined | null): Promise<void> {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `taskkill /PID ${pid} /T /F | Out-Null`,
    ].join('; ');
    await runPowerShell(script);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Ignore forced-kill errors.
      }
      resolve();
    }, 3000).unref();
  });
}
