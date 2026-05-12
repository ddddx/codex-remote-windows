import type { CodexOptionsResponse } from '@codex-remote/protocol';
import { codexOptionsQuerySchema } from '@codex-remote/protocol';
import type { FastifyInstance } from 'fastify';
import { repoRoot } from '../../runtime-paths.js';
import { ensureCodexReady } from '../../ws/bridge.js';

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export type CodexOptionsService = ReturnType<typeof createCodexOptionsService>;

export function createCodexOptionsService(app: FastifyInstance) {
  return {
    async listOptions(input: { cwd?: string }): Promise<CodexOptionsResponse> {
      await ensureCodexReady(app);

      const query = codexOptionsQuerySchema.parse(input);
      const [models, configResponse] = await Promise.all([
        app.codexClient.listModels({ includeHidden: false }),
        app.codexClient.readConfig({ cwd: query.cwd || repoRoot }),
      ]);

      const config = configResponse?.config || {};

      return {
        models: models.map((model) => ({
          id: normalizeOptionalString(model.id || model.model),
          model: normalizeOptionalString(model.model || model.id),
          displayName: normalizeOptionalString(model.displayName || model.model || model.id),
          description: normalizeOptionalString(model.description),
          isDefault: model.isDefault === true,
          defaultReasoningEffort: normalizeOptionalString(model.defaultReasoningEffort),
          supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
            ? model.supportedReasoningEfforts
              .map((entry) => {
                if (typeof entry === 'string') {
                  return entry;
                }
                if (entry && typeof entry === 'object') {
                  const objectEntry = entry as Record<string, unknown>;
                  return normalizeOptionalString(objectEntry.reasoningEffort || objectEntry.value);
                }
                return '';
              })
              .filter(Boolean)
            : [],
        })),
        defaults: {
          model: normalizeOptionalString(config.model),
          reasoningEffort: normalizeOptionalString(config.model_reasoning_effort),
          approvalPolicy: normalizeOptionalString(config.approval_policy),
          sandboxMode: normalizeOptionalString(config.sandbox_mode),
        },
      };
    },
  };
}
