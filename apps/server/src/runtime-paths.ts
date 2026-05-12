import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(moduleDir, '../../..');

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(repoRoot, ...segments);
}
