import type { FastifyInstance } from 'fastify';
import type { CodexOptionsResponse } from '@codex-remote/protocol';
import { ensureCodexReady } from '../ws/bridge.js';

export async function registerCodexRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/codex/options', { preHandler: app.requireAuth }, async (request): Promise<CodexOptionsResponse> => {
    return app.services.codexOptions.listOptions(request.query as { cwd?: string });
  });

  app.delete('/api/codex/threads/:threadId', { preHandler: app.requireAuth }, async (request) => {
    await ensureCodexReady(app);
    const { threadId } = request.params as { threadId: string };
    return app.codexClient.deleteThread(threadId);
  });

  app.get('/api/codex/threads/:threadId/background-terminals', { preHandler: app.requireAuth }, async (request) => {
    await ensureCodexReady(app);
    const { threadId } = request.params as { threadId: string };
    const query = request.query as { cursor?: string; limit?: string | number };
    const rawLimit = typeof query.limit === 'number' ? query.limit : Number.parseInt(String(query.limit || ''), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 100)
      : null;
    return app.codexClient.listBackgroundTerminals(threadId, {
      cursor: query.cursor || null,
      limit,
    });
  });

  app.post('/api/codex/threads/:threadId/background-terminals/:processId/terminate', { preHandler: app.requireAuth }, async (request) => {
    await ensureCodexReady(app);
    const { threadId, processId } = request.params as { threadId: string; processId: string };
    return app.codexClient.terminateBackgroundTerminal(threadId, processId);
  });

  app.get('/api/codex/workspace-messages', { preHandler: app.requireAuth }, async () => {
    await ensureCodexReady(app);
    return app.codexClient.readWorkspaceMessages();
  });

  app.post('/api/codex/rate-limit-reset-credit/consume', { preHandler: app.requireAuth }, async (request, reply) => {
    await ensureCodexReady(app);
    const body = request.body as { idempotencyKey?: string };
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!idempotencyKey) {
      return reply.code(400).send({
        code: 'BAD_REQUEST',
        message: 'idempotencyKey is required',
      });
    }
    return app.codexClient.consumeRateLimitResetCredit(idempotencyKey);
  });

  app.get('/api/codex/external-agent-import-histories', { preHandler: app.requireAuth }, async () => {
    await ensureCodexReady(app);
    return app.codexClient.readExternalAgentImportHistories();
  });
}
