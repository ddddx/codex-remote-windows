import type { ClientMessage } from '@codex-remote/protocol';
import type { FastifyInstance } from 'fastify';
import { broadcastMessage, ensureCodexReady } from '../../ws/bridge.js';

type CommandSendMessage = Extract<ClientMessage, { type: 'command_send' }>;
type GoalStatus = 'active' | 'paused' | 'budgetLimited' | 'complete';

type ParsedCommand = {
  name: string;
  args: string;
};

const GOAL_STATUS_ALIASES: Record<string, GoalStatus> = {
  active: 'active',
  resume: 'active',
  resumed: 'active',
  pause: 'paused',
  paused: 'paused',
  complete: 'complete',
  completed: 'complete',
  done: 'complete',
  limited: 'budgetLimited',
  budgetLimited: 'budgetLimited',
  'budget-limited': 'budgetLimited',
};

function splitCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('!')) {
    return {
      name: 'shell',
      args: trimmed.slice(1).trim(),
    };
  }
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const body = trimmed.slice(1).trim();
  const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(body);
  if (!match) {
    return null;
  }
  return {
    name: match[1].toLowerCase(),
    args: (match[2] || '').trim(),
  };
}

function parseGoalBudget(args: string): { args: string; tokenBudget?: number | null } {
  let nextArgs = args;
  let tokenBudget: number | null | undefined;
  nextArgs = nextArgs.replace(/(?:^|\s)--(?:token-)?budget(?:=|\s+)(\d+)/i, (match, value: string) => {
    tokenBudget = Number.parseInt(value, 10);
    return match.startsWith(' ') ? ' ' : '';
  }).trim();
  nextArgs = nextArgs.replace(/(?:^|\s)--no-budget\b/i, (match) => {
    tokenBudget = null;
    return match.startsWith(' ') ? ' ' : '';
  }).trim();
  return { args: nextArgs, tokenBudget };
}

function buildGoalSetParams(args: string): { objective?: string; status?: GoalStatus; tokenBudget?: number | null } | null {
  const parsedBudget = parseGoalBudget(args);
  const words = parsedBudget.args.split(/\s+/).filter(Boolean);
  const first = words[0]?.toLowerCase() || '';
  const status = GOAL_STATUS_ALIASES[first];
  const objective = status ? words.slice(1).join(' ').trim() : parsedBudget.args.trim();
  const result: { objective?: string; status?: GoalStatus; tokenBudget?: number | null } = {};
  if (objective) {
    result.objective = objective;
  }
  if (status) {
    result.status = status;
  }
  if (parsedBudget.tokenBudget !== undefined) {
    result.tokenBudget = parsedBudget.tokenBudget;
  }
  return result.objective || result.status || result.tokenBudget !== undefined ? result : null;
}

function summarizeGoal(goal: unknown): string {
  const source = goal && typeof goal === 'object' ? goal as Record<string, unknown> : null;
  if (!source) {
    return '当前没有目标。';
  }
  const objective = typeof source.objective === 'string' ? source.objective : '';
  const status = typeof source.status === 'string' ? source.status : '';
  const tokenBudget = typeof source.tokenBudget === 'number' ? `，预算 ${source.tokenBudget} tokens` : '';
  return `目标：${objective || '未命名'}${status ? ` (${status})` : ''}${tokenBudget}`;
}

function notifyCommandResult(app: FastifyInstance, threadId: string, text: string, status: 'completed' | 'failed' = 'completed'): void {
  broadcastMessage(app, {
    type: 'thread_event',
    threadId,
    method: 'web/slashCommand',
    params: { message: text, status },
    message: text,
    status,
    createdAt: Date.now(),
  });
}

export type CommandService = ReturnType<typeof createCommandService>;

export function createCommandService(app: FastifyInstance) {
  return {
    async runCommand(message: CommandSendMessage): Promise<void> {
      await ensureCodexReady(app);
      const parsed = splitCommand(message.text);
      if (!parsed) {
        throw new Error('未识别的命令。');
      }

      if (parsed.name === 'shell') {
        if (!parsed.args) {
          throw new Error('Shell 命令不能为空。');
        }
        await app.codexClient.runThreadShellCommand(message.threadId, parsed.args);
        return;
      }

      if (parsed.name === 'goal') {
        const subcommand = parsed.args.split(/\s+/)[0]?.toLowerCase() || '';
        if (!parsed.args || subcommand === 'show' || subcommand === 'status') {
          const result = await app.codexClient.getThreadGoal(message.threadId) as { goal?: unknown };
          notifyCommandResult(app, message.threadId, summarizeGoal(result.goal));
          return;
        }
        if (subcommand === 'clear' || subcommand === 'reset') {
          await app.codexClient.clearThreadGoal(message.threadId);
          notifyCommandResult(app, message.threadId, '目标已清除。');
          return;
        }
        const params = buildGoalSetParams(parsed.args);
        if (!params) {
          throw new Error('请输入目标内容，或使用 /goal clear、/goal pause、/goal resume、/goal complete。');
        }
        const result = await app.codexClient.setThreadGoal(message.threadId, params) as { goal?: unknown };
        notifyCommandResult(app, message.threadId, summarizeGoal(result.goal));
        return;
      }

      if (parsed.name === 'compact') {
        await app.codexClient.compactThread(message.threadId);
        notifyCommandResult(app, message.threadId, '已开始压缩上下文。');
        return;
      }

      if (parsed.name === 'stop' || parsed.name === 'clean') {
        await app.codexClient.stopBackgroundTerminals(message.threadId);
        notifyCommandResult(app, message.threadId, '已停止后台终端。');
        return;
      }

      if (parsed.name === 'rename') {
        if (!parsed.args) {
          throw new Error('请输入新的会话名称。');
        }
        await app.codexClient.setThreadName(message.threadId, parsed.args);
        notifyCommandResult(app, message.threadId, `会话已重命名为：${parsed.args}`);
        return;
      }

      throw new Error(`/${parsed.name} 目前还不能在 Web 前端执行。`);
    },
  };
}
