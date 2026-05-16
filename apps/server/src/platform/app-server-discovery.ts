import { execFile } from 'node:child_process';
import net from 'node:net';
import { URL } from 'node:url';

export type DiscoveredAppServer = {
  pid: number;
  parentPid: number | null;
  processName: string;
  commandLine: string;
  wsUrl: string;
};

type ProcessRecord = {
  ProcessId?: number | string;
  ParentProcessId?: number | string;
  Name?: string;
  CommandLine?: string;
};

const LISTEN_WS_MATCHER = /\bapp-server\b[\s\S]*?--listen\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i;

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}\n${stderr || ''}`.trim()));
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function normalizeWsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return null;
    }
    if (!parsed.hostname || !parsed.port) {
      return null;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function extractAppServerWsUrl(commandLine: string): string | null {
  const match = LISTEN_WS_MATCHER.exec(String(commandLine || ''));
  if (!match) {
    return null;
  }
  return normalizeWsUrl(match[1] || match[2] || match[3] || '');
}

function isOfficialCodexProcess(commandLine: string): boolean {
  const normalized = String(commandLine || '').toLowerCase().replace(/\//g, '\\');
  return normalized.includes('\\@openai\\codex\\')
    || normalized.includes('\\@openai\\codex-')
    || normalized.includes('\\openai.chatgpt-');
}

function normalizeProcess(record: ProcessRecord): DiscoveredAppServer | null {
  const pid = Number.parseInt(String(record.ProcessId || ''), 10);
  const parentPid = Number.parseInt(String(record.ParentProcessId || ''), 10);
  const processName = String(record.Name || '').trim();
  const commandLine = String(record.CommandLine || '').trim();
  const wsUrl = extractAppServerWsUrl(commandLine);
  if (!Number.isFinite(pid) || pid <= 0 || !processName || !commandLine || !wsUrl) {
    return null;
  }
  if (!isOfficialCodexProcess(commandLine)) {
    return null;
  }
  return {
    pid,
    parentPid: Number.isFinite(parentPid) && parentPid > 0 ? parentPid : null,
    processName,
    commandLine,
    wsUrl,
  };
}

function buildReadyEndpointUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.hostname = parsed.hostname || '127.0.0.1';
  parsed.pathname = '/readyz';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

async function isReady(wsUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch(buildReadyEndpointUrl(wsUrl), {
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

function scoreDiscovery(candidate: DiscoveredAppServer, avoidWsUrls: Set<string>): number {
  let score = 0;
  if (!avoidWsUrls.has(candidate.wsUrl)) {
    score += 1000;
  }
  if (!candidate.wsUrl.endsWith(':34792')) {
    score += 100;
  }
  if (candidate.processName.toLowerCase() === 'node.exe') {
    score += 20;
  }
  return score;
}

export async function listOfficialAppServers(): Promise<DiscoveredAppServer[]> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'app-server' -and $_.CommandLine -match '--listen' } | Select-Object ProcessId, ParentProcessId, Name, CommandLine",
    '$procs | ConvertTo-Json -Compress',
  ].join('; ');
  const output = await runPowerShell(script);
  if (!output) {
    return [];
  }
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map(normalizeProcess).filter((value): value is DiscoveredAppServer => Boolean(value));
}

export async function findPreferredOfficialAppServer(avoidWsUrls: string[] = []): Promise<DiscoveredAppServer | null> {
  const avoid = new Set(avoidWsUrls.map((url) => normalizeWsUrl(url)).filter((url): url is string => Boolean(url)));
  const candidates = await listOfficialAppServers();
  const readyCandidates: DiscoveredAppServer[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (avoid.has(candidate.wsUrl)) {
      continue;
    }
    if (seen.has(candidate.wsUrl)) {
      continue;
    }
    seen.add(candidate.wsUrl);
    if (await isReady(candidate.wsUrl)) {
      readyCandidates.push(candidate);
    }
  }
  readyCandidates.sort((left, right) => scoreDiscovery(right, avoid) - scoreDiscovery(left, avoid));
  return readyCandidates[0] || null;
}

export async function allocateLoopbackWsUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('failed to allocate app-server port')));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(`ws://127.0.0.1:${port}`);
      });
    });
    server.once('error', reject);
  });
}

export const __appServerDiscoveryTestUtils = {
  extractAppServerWsUrl,
};
