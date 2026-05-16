import { execFile } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoPath } from '../runtime-paths.js';

type ProcessRecord = {
  pid: number;
  parentPid: number | null;
  name: string;
  commandLine: string;
};

type ResumeWindowRecord = {
  threadId: string;
  pid: number;
  processName: string;
  matchedPid: number;
  matchedProcessName: string;
  commandLine: string;
};

export type WindowDiscoverySnapshot = {
  alivePids: Set<number>;
  resumeWindowsByThread: Map<string, ResumeWindowRecord>;
};

const THREAD_ID_REGEX = /^[0-9a-f]{8,12}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THREAD_ID_MATCHER = /\bresume\b\s+"?([0-9a-f]{8,12}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"?/ig;
const CONTROL_SHELL_PROCESS_NAMES = new Set(['cmd.exe']);
const UNSAFE_WINDOW_PROCESS_NAMES = new Set(['powershell.exe', 'pwsh.exe']);

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

function normalizeProcessRecord(record: any): ProcessRecord | null {
  const pid = Number.parseInt(record?.ProcessId, 10);
  const parentPid = Number.parseInt(record?.ParentProcessId, 10);
  const name = String(record?.Name || '').trim();
  const commandLine = String(record?.CommandLine || '').trim();
  if (!Number.isFinite(pid) || pid <= 0 || !name || !commandLine) {
    return null;
  }
  return {
    pid,
    parentPid: Number.isFinite(parentPid) && parentPid > 0 ? parentPid : null,
    name,
    commandLine,
  };
}

function extractThreadIdsFromCommandLine(commandLine: string): string[] {
  const normalized = String(commandLine || '');
  if (!normalized) {
    return [];
  }
  const threadIds: string[] = [];
  const seen = new Set<string>();
  THREAD_ID_MATCHER.lastIndex = 0;
  let match = THREAD_ID_MATCHER.exec(normalized);
  while (match) {
    const threadId = String(match[1] || '').trim();
    if (THREAD_ID_REGEX.test(threadId) && !seen.has(threadId)) {
      seen.add(threadId);
      threadIds.push(threadId);
    }
    match = THREAD_ID_MATCHER.exec(normalized);
  }
  return threadIds;
}

function normalizeProcessName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function isControlShellProcess(name: string): boolean {
  return CONTROL_SHELL_PROCESS_NAMES.has(normalizeProcessName(name));
}

function isUnsafeWindowProcess(name: string): boolean {
  return UNSAFE_WINDOW_PROCESS_NAMES.has(normalizeProcessName(name));
}

function getProcessPriority(name: string): number {
  const normalized = normalizeProcessName(name);
  if (normalized === 'cmd.exe') {
    return 400;
  }
  if (normalized === 'powershell.exe' || normalized === 'pwsh.exe') {
    return 350;
  }
  if (normalized === 'node.exe') {
    return 200;
  }
  if (normalized === 'codex.exe') {
    return 150;
  }
  return 100;
}

function resolveControlProcess(process: ProcessRecord, processMap: Map<number, ProcessRecord>): ProcessRecord {
  let current = process;
  let chosen = process;
  let depth = 0;
  while (depth < 4) {
    const parent = current.parentPid ? processMap.get(current.parentPid) : null;
    if (!parent || !isControlShellProcess(parent.name)) {
      break;
    }
    chosen = parent;
    current = parent;
    depth += 1;
  }
  return chosen;
}

function buildWindowCandidate(process: ProcessRecord, controlProcess: ProcessRecord) {
  const pid = controlProcess?.pid || process.pid;
  const processName = controlProcess?.name || process.name;
  return {
    pid,
    processName,
    score: getProcessPriority(processName) + (pid === process.pid ? 20 : 0),
  };
}

function selectResumeWindows(processes: ProcessRecord[]): ResumeWindowRecord[] {
  const processMap = new Map(processes.map((process) => [process.pid, process]));
  const windowsByThread = new Map<string, ResumeWindowRecord & { score: number }>();
  for (const process of processes) {
    const threadIds = extractThreadIdsFromCommandLine(process.commandLine);
    if (!threadIds.length) {
      continue;
    }
    const controlProcess = resolveControlProcess(process, processMap);
    const candidate = buildWindowCandidate(process, controlProcess);
    if (isUnsafeWindowProcess(candidate.processName)) {
      continue;
    }
    for (const threadId of threadIds) {
      const existing = windowsByThread.get(threadId);
      if (!existing || candidate.score > existing.score) {
        windowsByThread.set(threadId, {
          threadId,
          pid: candidate.pid,
          processName: candidate.processName,
          matchedPid: process.pid,
          matchedProcessName: process.name,
          commandLine: process.commandLine,
          score: candidate.score,
        });
      }
    }
  }
  return Array.from(windowsByThread.values()).map(({ score, ...windowRecord }) => windowRecord);
}

function buildWindowDiscoverySnapshot(processes: ProcessRecord[]): WindowDiscoverySnapshot {
  const resumeWindows = selectResumeWindows(processes);
  return {
    alivePids: new Set(processes.map((process) => process.pid)),
    resumeWindowsByThread: new Map(resumeWindows.map((windowRecord) => [windowRecord.threadId, windowRecord])),
  };
}

function assertThreadId(threadId: string): void {
  if (!THREAD_ID_REGEX.test(threadId || '')) {
    throw new Error('invalid threadId: expected UUID');
  }
}

function writeJsonFileAtomic(targetPath: string, value: Record<string, number>) {
  const directory = path.dirname(targetPath);
  mkdirSync(directory, { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, targetPath);
}

function backupCorruptedJsonFile(filePath: string, error: Error, scope: string) {
  try {
    if (!existsSync(filePath)) {
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.broken-${stamp}`;
    renameSync(filePath, backupPath);
    console.log(`[${scope}] corrupted state file moved to ${backupPath}: ${error.message}`);
  } catch (backupError) {
    console.log(`[${scope}] failed to back up corrupted state file: ${(backupError as Error).message}`);
  }
}

export class CodexWindowManager {
  readonly codexCmd: string;
  appServerWs: string | null;
  readonly mapFile: string;
  map: Map<string, number>;

  constructor(options: { codexCmd?: string; appServerWs?: string; mapFile?: string } = {}) {
    this.codexCmd = options.codexCmd || process.env.CODEX_CMD || 'codex.cmd';
    this.appServerWs = options.appServerWs || process.env.CODEX_APP_SERVER_WS || null;
    this.mapFile = options.mapFile || process.env.WINDOW_MAP_FILE || resolveRepoPath('.window-map.json');
    this.map = new Map();
    this.load();
  }

  async openWindow(threadId: string): Promise<number> {
    assertThreadId(threadId);
    if (!this.appServerWs) {
      throw new Error('codex app-server websocket is not ready');
    }
    const escapedCmd = this.codexCmd.replace(/'/g, "''");
    const escapedWs = this.appServerWs.replace(/'/g, "''");
    const escapedThread = threadId.replace(/'/g, "''");
    const commandLine = `""${escapedCmd}" --remote ${escapedWs} resume ${escapedThread}"`;
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/s', '/c', '${commandLine}') -PassThru`,
      'Write-Output $proc.Id',
    ].join('; ');
    const output = await runPowerShell(script);
    const pid = Number.parseInt(output, 10);
    if (!Number.isFinite(pid)) {
      throw new Error(`failed to parse codex window pid from output: ${output}`);
    }
    this.map.set(threadId, pid);
    this.save();
    return pid;
  }

  setAppServerWs(appServerWs: string | null): void {
    this.appServerWs = appServerWs;
  }

  async closeWindow(threadId: string): Promise<void> {
    assertThreadId(threadId);
    const pid = this.map.get(threadId);
    if (!pid) {
      return;
    }
    let verifiedPid: number | null = null;
    try {
      verifiedPid = (await this.findResumeWindow(threadId))?.pid || null;
    } catch {
      verifiedPid = null;
    }
    if (!verifiedPid) {
      if (await this.isPidAlive(pid)) {
        console.log(`[window] refuse to terminate unverified pid ${pid} for thread ${threadId}`);
      }
      this.map.delete(threadId);
      this.save();
      return;
    }
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `taskkill /PID ${verifiedPid} /T /F | Out-Null`,
    ].join('; ');
    await runPowerShell(script);
    this.map.delete(threadId);
    this.save();
  }

  async isPidAlive(pid: number | string): Promise<boolean> {
    const numericPid = Number.parseInt(String(pid), 10);
    if (!Number.isFinite(numericPid) || numericPid <= 0) {
      return false;
    }
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$proc = Get-Process -Id ${numericPid}`,
      "if ($null -ne $proc) { Write-Output '1' } else { Write-Output '0' }",
    ].join('; ');
    const output = await runPowerShell(script);
    return output.trim() === '1';
  }

  async isPidAliveInSnapshot(pid: number | string, snapshot: WindowDiscoverySnapshot | null | undefined): Promise<boolean> {
    const numericPid = Number.parseInt(String(pid), 10);
    if (!Number.isFinite(numericPid) || numericPid <= 0) {
      return false;
    }
    if (snapshot) {
      return snapshot.alivePids.has(numericPid);
    }
    return this.isPidAlive(numericPid);
  }

  async listProcesses(): Promise<ProcessRecord[]> {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object ProcessId, ParentProcessId, Name, CommandLine",
      '$procs | ConvertTo-Json -Compress',
    ].join('; ');
    const output = await runPowerShell(script);
    if (!output) {
      return [];
    }
    const parsed = JSON.parse(output);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(normalizeProcessRecord).filter((value): value is ProcessRecord => Boolean(value));
  }

  async createDiscoverySnapshot(): Promise<WindowDiscoverySnapshot> {
    const processes = await this.listProcesses();
    return buildWindowDiscoverySnapshot(processes);
  }

  async listResumeWindows(snapshot?: WindowDiscoverySnapshot | null): Promise<ResumeWindowRecord[]> {
    if (snapshot) {
      return Array.from(snapshot.resumeWindowsByThread.values());
    }
    const processes = await this.listProcesses();
    return selectResumeWindows(processes);
  }

  async findResumeWindow(threadId: string, snapshot?: WindowDiscoverySnapshot | null): Promise<ResumeWindowRecord | null> {
    assertThreadId(threadId);
    if (snapshot) {
      return snapshot.resumeWindowsByThread.get(threadId) || null;
    }
    const windows = await this.listResumeWindows();
    return windows.find((entry) => entry.threadId === threadId) || null;
  }

  rememberPid(threadId: string, pid: number | string): number | null {
    assertThreadId(threadId);
    const numericPid = Number.parseInt(String(pid), 10);
    if (!Number.isFinite(numericPid) || numericPid <= 0) {
      this.clearPid(threadId);
      return null;
    }
    this.map.set(threadId, numericPid);
    this.save();
    return numericPid;
  }

  getPid(threadId: string): number | null {
    return this.map.get(threadId) || null;
  }

  clearPid(threadId: string): void {
    this.map.delete(threadId);
    this.save();
  }

  load(): void {
    try {
      if (!existsSync(this.mapFile)) {
        this.map.clear();
        return;
      }
      const raw = readFileSync(this.mapFile, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const nextMap = new Map<string, number>();
      for (const [threadId, pid] of Object.entries(parsed || {})) {
        if (!THREAD_ID_REGEX.test(threadId || '')) {
          continue;
        }
        const numericPid = Number.parseInt(String(pid), 10);
        if (Number.isFinite(numericPid) && numericPid > 0) {
          nextMap.set(threadId, numericPid);
        }
      }
      this.map = nextMap;
    } catch (error) {
      backupCorruptedJsonFile(this.mapFile, error as Error, 'window');
      this.map = new Map();
    }
  }

  save(): void {
    const payload: Record<string, number> = {};
    for (const [threadId, pid] of this.map.entries()) {
      const numericPid = Number.parseInt(String(pid), 10);
      if (Number.isFinite(numericPid) && numericPid > 0) {
        payload[threadId] = numericPid;
      }
    }
    writeJsonFileAtomic(this.mapFile, payload);
  }
}

export const __windowManagerTestUtils = {
  buildWindowDiscoverySnapshot,
  selectResumeWindows,
};
