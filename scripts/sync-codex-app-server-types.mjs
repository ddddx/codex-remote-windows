import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(repoRoot, 'packages', 'codex-app-server-types');
const generatedRoot = path.join(packageRoot, 'src', 'generated');
const versionFile = path.join(packageRoot, 'src', 'version.ts');
const codexCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex';

function quoteWindowsArg(value) {
  const normalized = String(value);
  if (!normalized || /[\s"]/u.test(normalized)) {
    return `"${normalized.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, '$&$&')}"`;
  }
  return normalized;
}

function runCodex(args, options = {}) {
  if (process.platform === 'win32') {
    const command = [codexCommand, ...args].map(quoteWindowsArg).join(' ');
    return execSync(command, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: options.stdio ?? 'pipe',
    });
  }
  return execFileSync(codexCommand, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
}

function walk(directory) {
  const entries = readdirSync(directory);
  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!fullPath.endsWith('.ts')) {
      continue;
    }
    const source = readFileSync(fullPath, 'utf8');
    let updated = source.replace(
      /from "((?:\.\.\/|\.\/)[^".]+)"/g,
      'from "$1.js"',
    );
    updated = updated.replace(
      /from "((?:\.\.\/|\.\/)v2)\.js"/g,
      'from "$1/index.js"',
    );
    writeFileSync(fullPath, updated, 'utf8');
  }
}

rmSync(generatedRoot, { recursive: true, force: true });
mkdirSync(generatedRoot, { recursive: true });

const cliVersion = runCodex(['--version']).trim();

runCodex(['app-server', 'generate-ts', '--experimental', '--out', generatedRoot], {
  stdio: 'inherit',
});

walk(generatedRoot);

writeFileSync(
  versionFile,
  `export const CODEX_APP_SERVER_TYPES_VERSION = {\n  cliVersion: ${JSON.stringify(cliVersion)},\n} as const;\n`,
  'utf8',
);
