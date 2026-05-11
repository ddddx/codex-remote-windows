import fs from 'node:fs';
import path from 'node:path';
import { createSqliteDatabase, createSqliteRepositories, importLegacyState } from '../packages/adapters/src/index.js';

type CliOptions = {
  sqliteFile: string;
  appStatePath: string;
  windowMapPath: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sqliteFile: '.codex-remote.sqlite',
    appStatePath: '.codex-remote-state.json',
    windowMapPath: '.window-map.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === '--sqlite-file' && next) {
      options.sqliteFile = next;
      index += 1;
      continue;
    }
    if (current === '--app-state' && next) {
      options.appStatePath = next;
      index += 1;
      continue;
    }
    if (current === '--window-map' && next) {
      options.windowMapPath = next;
      index += 1;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const resolvedSqlite = path.resolve(process.cwd(), options.sqliteFile);
  const resolvedAppState = path.resolve(process.cwd(), options.appStatePath);
  const resolvedWindowMap = path.resolve(process.cwd(), options.windowMapPath);

  const database = createSqliteDatabase({
    filePath: resolvedSqlite,
  });

  importLegacyState(database, {
    appStatePath: resolvedAppState,
    windowMapPath: resolvedWindowMap,
  });

  const repositories = createSqliteRepositories(database);
  const threadPreferencesCount = Number(database.prepare('SELECT COUNT(*) AS count FROM thread_preferences').get().count || 0);
  const appStateKeys = ['lastWorkspacePath'].filter((key) => repositories.appState.getAppState(key));
  const summary = {
    sqliteFile: resolvedSqlite,
    appStateExists: fs.existsSync(resolvedAppState),
    windowMapExists: fs.existsSync(resolvedWindowMap),
    imported: {
      appStateKeys,
      threadPreferences: threadPreferencesCount,
      windowBindings: repositories.windowBindings.listWindowBindings().length,
      sessions: repositories.sessions.listSessions().length,
      pendingRequests: repositories.pendingRequests.listPendingRequests().length,
      uploads: repositories.uploads.listUploads().length,
    },
  };

  database.close();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
