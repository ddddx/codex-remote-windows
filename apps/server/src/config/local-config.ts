import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../runtime-paths.js';

export const CONFIG_FILE_NAME = 'config.local.json';

export const DEFAULT_CONFIG = Object.freeze({
  PORT: 18637,
  CODEX_CMD: 'codex.cmd',
  CODEX_APP_SERVER_WS: 'ws://127.0.0.1:4792',
});

function resolveConfigPath(): string {
  return path.join(repoRoot, CONFIG_FILE_NAME);
}

function generateWsToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function createDefaultConfig() {
  return {
    ...DEFAULT_CONFIG,
    WS_TOKEN: generateWsToken(),
  };
}

export function ensureLocalConfig(): {
  configPath: string;
  config: Record<string, unknown>;
} | null {
  const configPath = resolveConfigPath();
  if (fs.existsSync(configPath)) {
    return null;
  }

  const config = createDefaultConfig();
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { configPath, config };
}

export function readLocalConfig(): Record<string, unknown> {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, 'utf8').trim();
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to parse ${configPath}: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid config file ${configPath}: root value must be an object`);
  }

  return parsed as Record<string, unknown>;
}

export function applyLocalConfig(): {
  config: Record<string, unknown>;
  created: {
    configPath: string;
    config: Record<string, unknown>;
  } | null;
} {
  const created = ensureLocalConfig();
  const config = readLocalConfig();

  for (const [key, value] of Object.entries(config)) {
    if (value == null || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = String(value);
  }

  return { config, created };
}
