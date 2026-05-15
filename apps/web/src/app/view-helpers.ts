import type { ServerRequestItem, TimelineEntry } from '../store/appStore.js';

export function buildSessionNameFromPrompt(text: string): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return '新会话';
  }
  return firstLine.slice(0, 40);
}

export function formatWorkspaceLabel(path: string | undefined): string {
  const value = typeof path === 'string' ? path.trim() : '';
  if (!value) {
    return '未设置工作区';
  }

  const normalized = value.replace(/[\\/]+$/, '');
  if (!normalized) {
    return value;
  }

  const segments = normalized.split(/[/\\]+/).filter(Boolean);
  if (!segments.length) {
    return normalized;
  }

  const lastSegment = segments[segments.length - 1];
  if (/^[a-zA-Z]:$/.test(normalized)) {
    return normalized;
  }
  return lastSegment || normalized;
}

function readNumericTokenValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampPercentage(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

export function formatTokenUsageValue(value: unknown): string {
  const directNumber = readNumericTokenValue(value);
  if (directNumber !== null) {
    return `总 ${directNumber}`;
  }
  if (!value || typeof value !== 'object') {
    return '未统计';
  }

  const usage = value as Record<string, unknown>;
  const total = usage.totalTokens ?? usage.total_tokens;
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens;
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens;
  const modelContextWindow = usage.modelContextWindow ?? usage.model_context_window;
  const last = usage.last && typeof usage.last === 'object' ? usage.last as Record<string, unknown> : null;
  const nested = usage.usage && typeof usage.usage === 'object' ? usage.usage as Record<string, unknown> : null;
  const nestedTotal = nested?.totalTokens ?? nested?.total_tokens;
  const nestedInput = nested?.inputTokens ?? nested?.input_tokens ?? nested?.promptTokens ?? nested?.prompt_tokens;
  const nestedOutput = nested?.outputTokens ?? nested?.output_tokens ?? nested?.completionTokens ?? nested?.completion_tokens;
  const nestedLast = nested?.last && typeof nested.last === 'object' ? nested.last as Record<string, unknown> : null;
  const nestedModelContextWindow = nested?.modelContextWindow ?? nested?.model_context_window;

  const lastTotal = last?.totalTokens ?? last?.total_tokens;
  const nestedLastTotal = nestedLast?.totalTokens ?? nestedLast?.total_tokens;
  const resolvedWindow = readNumericTokenValue(modelContextWindow) ?? readNumericTokenValue(nestedModelContextWindow);
  const resolvedLastTotal = readNumericTokenValue(lastTotal) ?? readNumericTokenValue(nestedLastTotal);

  if (resolvedWindow !== null && resolvedWindow > 0 && resolvedLastTotal !== null) {
    const percent = clampPercentage(Math.round((resolvedLastTotal / resolvedWindow) * 100));
    return `${percent}%`;
  }

  const resolvedTotal = readNumericTokenValue(total) ?? readNumericTokenValue(nestedTotal);
  if (resolvedTotal !== null) {
    return `总 ${resolvedTotal}`;
  }
  const resolvedInput = readNumericTokenValue(input) ?? readNumericTokenValue(nestedInput);
  const resolvedOutput = readNumericTokenValue(output) ?? readNumericTokenValue(nestedOutput);

  const parts = [
    resolvedInput !== null
      ? `输入 ${resolvedInput}`
      : '',
    resolvedOutput !== null
      ? `输出 ${resolvedOutput}`
      : '',
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : '未统计';
}

export function formatHealthStatus(status: string | undefined): string {
  if (status === 'ok') {
    return '正常';
  }
  if (status === 'error') {
    return '异常';
  }
  return status || '未知';
}

export function formatApprovalKind(kind: string | undefined): string {
  if (!kind) {
    return '审批';
  }
  if (kind === 'user_input') {
    return '用户输入';
  }
  if (kind === 'dynamic_tool_call') {
    return '动态工具';
  }
  if (kind === 'mcp_server_elicitation') {
    return 'MCP 请求';
  }
  if (kind === 'command') {
    return '命令审批';
  }
  return kind;
}

export function formatSessionStatus(status: string | undefined): string {
  if (!status) {
    return '空闲';
  }
  const normalized = status.trim().toLowerCase();
  if (normalized === 'running' || normalized === 'active' || normalized === 'in_progress' || normalized === 'inprogress') {
    return '运行中';
  }
  if (normalized === 'completed' || normalized === 'idle' || normalized === 'ready') {
    return '空闲';
  }
  if (normalized === 'pending') {
    return '待处理';
  }
  if (normalized === 'closed') {
    return '已关闭';
  }
  if (normalized === 'failed' || normalized === 'error' || normalized === 'systemerror') {
    return '异常';
  }
  if (normalized === 'cancelled' || normalized === 'aborted') {
    return '已中断';
  }
  return status;
}

export function formatWindowStatus(status: string | undefined): string {
  if (!status) {
    return '';
  }
  const normalized = status.trim().toLowerCase();
  if (normalized === 'attached') {
    return '窗口已打开';
  }
  if (normalized === 'detached') {
    return '窗口未打开';
  }
  return status;
}

export function describeTimelineType(entry: TimelineEntry): string {
  if (entry.type === 'message') {
    return entry.role === 'user' ? '用户消息' : entry.role === 'assistant' ? '助手消息' : '消息';
  }
  if (entry.type === 'reasoning') {
    return '思考';
  }
  if (entry.type === 'plan' || entry.type === 'turn_plan') {
    return '计划';
  }
  if (entry.type === 'command') {
    return '命令执行';
  }
  if (entry.type === 'file_change') {
    return '文件变更';
  }
  if (entry.type === 'mcp_tool') {
    return 'MCP 工具';
  }
  if (entry.type === 'dynamic_tool') {
    return '动态工具';
  }
  if (entry.type === 'web_search') {
    return '网页搜索';
  }
  if (entry.type === 'context_compaction') {
    return '上下文压缩';
  }
  if (entry.type === 'hook') {
    return '钩子';
  }
  if (entry.type === 'guardian_review') {
    return 'Guardian 审查';
  }
  if (entry.type === 'turn_diff') {
    return '轮次差异';
  }
  if (entry.type === 'notice') {
    return '通知';
  }
  if (entry.type === 'item_delta') {
    return '流式更新';
  }
  return entry.type || '事件';
}

export function buildApprovalSummary(request: {
  kind?: string;
  reason?: string;
  command?: string;
  tool?: string;
  namespace?: string;
  serverName?: string;
  message?: string;
  patch?: string;
  questions?: Array<{ question?: string; header?: string }>;
  url?: string;
}): string {
  if (request.reason) {
    return request.reason;
  }
  if (request.command) {
    return request.command;
  }
  if (request.message) {
    return request.message;
  }
  if (request.tool) {
    return request.namespace ? `工具：${request.namespace}.${request.tool}` : `工具：${request.tool}`;
  }
  if (request.serverName) {
    return `服务：${request.serverName}`;
  }
  if (request.url) {
    return request.url;
  }
  if (request.questions?.length) {
    return request.questions
      .map((entry) => entry.question || entry.header || '')
      .filter(Boolean)
      .join('\n');
  }
  if (request.patch) {
    return request.patch.slice(0, 240);
  }
  return request.kind || '待处理审批';
}

export function getDecisionLabel(decision: string | Record<string, unknown>): string {
  if (typeof decision === 'string') {
    if (decision === 'accept' || decision === 'approved') {
      return '批准';
    }
    if (decision === 'acceptForSession' || decision === 'approved_for_session') {
      return '本会话内批准';
    }
    if (decision === 'decline' || decision === 'denied') {
      return '拒绝';
    }
    if (decision === 'cancel') {
      return '取消';
    }
    return decision;
  }

  if (decision && typeof decision === 'object') {
    if ('acceptWithExecpolicyAmendment' in decision) {
      return '按策略批准';
    }
    if ('acceptWithNetworkPolicyAmendments' in decision) {
      return '批准网络权限';
    }
  }

  return '提交';
}

export function buildApprovalDecisionResponse(decision: string | Record<string, unknown>): unknown {
  if (typeof decision === 'string') {
    return { decision };
  }
  if (!decision || typeof decision !== 'object') {
    return { decision };
  }
  return decision;
}

export function summarizeTimelineEntry(entry: TimelineEntry): string {
  if (entry.text?.trim()) {
    return entry.text;
  }
  if (entry.patch?.trim()) {
    return entry.patch;
  }
  if (entry.meta?.length) {
    return entry.meta.join('\n');
  }
  return '没有详情';
}

export function formatTimelineLabel(entry: TimelineEntry): string {
  if (entry.title) {
    return entry.title;
  }
  if (entry.role) {
    if (entry.role === 'user') {
      return '用户';
    }
    if (entry.role === 'assistant') {
      return '助手';
    }
    if (entry.role === 'system') {
      return '系统';
    }
    return entry.role;
  }
  return entry.type;
}

export function summarizeUnknownObject(value: unknown, max = 3): string {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const objectValue = value as Record<string, unknown>;
  const preferredKeys = [
    'title',
    'label',
    'name',
    'command',
    'tool',
    'server',
    'namespace',
    'query',
    'url',
    'path',
    'phase',
    'status',
    'message',
    'text',
  ];

  const parts: string[] = [];

  for (const key of preferredKeys) {
    const raw = objectValue[key];
    if (typeof raw === 'string' && raw.trim()) {
      parts.push(`${key}: ${raw.trim()}`);
    } else if (typeof raw === 'number' || typeof raw === 'boolean') {
      parts.push(`${key}: ${String(raw)}`);
    }
    if (parts.length >= max) {
      break;
    }
  }

  if (!parts.length) {
    const keys = Object.keys(objectValue).slice(0, max);
    if (!keys.length) {
      return '';
    }
    return `字段: ${keys.join(', ')}`;
  }

  return parts.join(' · ');
}

export function buildUserInputResponse(
  request: ServerRequestItem,
  formState: Record<string, string>,
): { answers: Record<string, { answers: string[] }> } {
  const answers: Record<string, { answers: string[] }> = {};

  for (const question of request.questions || []) {
    const questionId = question.id || '';
    if (!questionId) {
      continue;
    }
    const value = (formState[questionId] || '').trim();
    if (!value) {
      continue;
    }
    answers[questionId] = {
      answers: [value],
    };
  }

  return { answers };
}

export function normalizeSchemaFieldValue(value: string, schema: Record<string, unknown> | null): unknown {
  const type = typeof schema?.type === 'string' ? schema.type : 'string';
  const trimmed = value.trim();
  if (!trimmed) {
    if (type === 'number' || type === 'integer') {
      return null;
    }
    return '';
  }
  if (type === 'number') {
    const next = Number(trimmed);
    return Number.isFinite(next) ? next : null;
  }
  if (type === 'integer') {
    const next = Number.parseInt(trimmed, 10);
    return Number.isFinite(next) ? next : null;
  }
  if (type === 'boolean') {
    return trimmed === 'true';
  }
  return trimmed;
}
