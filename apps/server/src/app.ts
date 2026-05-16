import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteDatabase, createSqliteRepositories } from '@codex-remote/adapters';
import type { ServerConfig } from './config/env.js';
import { createWindowAttachmentService } from './application/services/window-attachment.js';
import { createAppServices } from './application/services/index.js';
import { CodexAppServerSupervisor } from './platform/app-server-supervisor.js';
import { CodexAppServerClient } from './platform/codex-client.js';
import { CodexWindowManager } from './platform/window-manager.js';
import { WorkspaceManager } from './platform/workspace-manager.js';
import { buildRequireAuth, buildTokenVerifier } from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';
import { repoRoot } from './runtime-paths.js';
import { createRuntimeState } from './state/runtime-state.js';
import { registerWsGateway } from './ws/gateway.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDistRoot = path.resolve(serverRoot, '../web/dist');

export async function createApp(config: ServerConfig) {
  const app = Fastify({
    logger: true,
  });
  const sqlite = createSqliteDatabase({
    filePath: path.resolve(repoRoot, config.sqliteFile),
  });
  const repositories = createSqliteRepositories(sqlite);

  app.decorate('config', config);
  app.decorate('runtimeState', createRuntimeState());
  app.decorate('sqlite', sqlite);
  app.decorate('repositories', repositories);
  app.decorate('workspaceManager', new WorkspaceManager({
    app,
    projectRoot: repoRoot,
  }));
  app.decorate('appServerSupervisor', new CodexAppServerSupervisor({
    cwd: repoRoot,
  }));
  app.decorate('codexClient', new CodexAppServerClient({
    cwd: repoRoot,
  }));
  app.decorate('windowManager', new CodexWindowManager());
  app.decorate('windowAttachments', null as any);
  app.decorate('services', createAppServices(app));
  app.windowAttachments = createWindowAttachmentService(app, app.windowManager) as any;
  app.runtimeState.repositories = repositories as any;
  app.addHook('onClose', async () => {
    try {
      await app.codexClient.stop();
    } catch {
      // Tests may replace the client, or it may already be stopped.
    }
    try {
      await app.appServerSupervisor.stop();
    } catch {
      // The supervisor may never have started during lightweight tests.
    }
    try {
      app.sqlite.close();
    } catch {
      // The database may already be closed by a test or shutdown path.
    }
  });

  await app.register(websocket);
  await app.register(fastifyStatic, {
    root: webDistRoot,
    prefix: '/',
  });

  const verifyRequestToken = buildTokenVerifier(() => app.config.wsToken);
  const authorizeCookieSession = (cookieHeader: string | undefined) => app.services.auth.authorizeCookie(cookieHeader);
  const requireAuth = buildRequireAuth(authorizeCookieSession);

  app.decorate('verifyRequestToken', verifyRequestToken);
  app.decorate('authorizeCookieSession', authorizeCookieSession);
  app.decorate('requireAuth', requireAuth);

  await registerRoutes(app);
  await registerWsGateway(app);

  return app;
}
