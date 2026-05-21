import type { ServerRequestItem, TimelineEntry } from '../store/appStore.js';

export type TokenUsageDisplay = {
  percentUsed: number | null;
  percentRemaining: number | null;
  usedTokens: number | null;
  remainingTokens: number | null;
  contextWindow: number | null;
  label: string;
  detail: string;
};

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

export function buildTokenUsageDisplay(value: unknown): TokenUsageDisplay {
  const directNumber = readNumericTokenValue(value);
  if (directNumber !== null) {
    return {
      percentUsed: null,
      percentRemaining: null,
      usedTokens: null,
      remainingTokens: null,
      contextWindow: null,
      label: '总量',
      detail: `总 ${directNumber}`,
    };
  }
  if (!value || typeof value !== 'object') {
    return {
      percentUsed: null,
      percentRemaining: null,
      usedTokens: null,
      remainingTokens: null,
      contextWindow: null,
      label: '上下文',
      detail: '未统计',
    };
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
    const percentUsed = clampPercentage(Math.round((resolvedLastTotal / resolvedWindow) * 100));
    const percentRemaining = clampPercentage(100 - percentUsed);
    const remainingTokens = Math.max(resolvedWindow - resolvedLastTotal, 0);
    return {
      percentUsed,
      percentRemaining,
      usedTokens: resolvedLastTotal,
      remainingTokens,
      contextWindow: resolvedWindow,
      label: '上下文余量',
      detail: `剩余 ${percentRemaining}% · ${remainingTokens} / ${resolvedWindow} tokens`,
    };
  }

  const resolvedTotal = readNumericTokenValue(total) ?? readNumericTokenValue(nestedTotal);
  if (resolvedTotal !== null) {
    return {
      percentUsed: null,
      percentRemaining: null,
      usedTokens: null,
      remainingTokens: null,
      contextWindow: null,
      label: '总量',
      detail: `总 ${resolvedTotal}`,
    };
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

  return {
    percentUsed: null,
    percentRemaining: null,
    usedTokens: null,
    remainingTokens: null,
    contextWindow: null,
    label: '总量',
    detail: parts.length ? parts.join(' / ') : '未统计',
  };
}

export function formatTokenUsageValue(value: unknown): string {
  const display = buildTokenUsageDisplay(value);
  if (display.percentUsed !== null) {
    return `${display.percentUsed}%`;
  }
  return display.detail;
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

export function formatApprovalMethodLabel(method: string | undefined, fallbackKind?: string): string {
  if (!method) {
    return formatApprovalKind(fallbackKind);
  }
  if (method === 'item/tool/requestUserInput') {
    return '用户输入';
  }
  if (method === 'item/tool/call') {
    return '动态工具';
  }
  if (method === 'mcpServer/elicitation/request') {
    return 'MCP 请求';
  }
  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
    return '命令审批';
  }
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    return '文件变更审批';
  }
  if (method === 'item/permissions/requestApproval') {
    return '权限审批';
  }
  if (method === 'account/chatgptAuthTokens/refresh') {
    return '账户刷新';
  }
  return fallbackKind || method;
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
  if (entry.type === 'collab_tool') {
    return '协作代理';
  }
  if (entry.type === 'web_search') {
    return '网页搜索';
  }
  if (entry.type === 'image_view') {
    return '查看图片';
  }
  if (entry.type === 'image_generation') {
    return '图片生成';
  }
  if (entry.type === 'review_mode') {
    return 'Review 模式';
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
  if (entry.type === 'thread_event') {
    return '线程事件';
  }
  return entry.type || '事件';
}

export function buildApprovalSummary(request: {
  method?: string;
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
  return formatApprovalMethodLabel(request.method, request.kind) || '待处理审批';
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
  return { decision };
}

export function getMcpSchemaProperties(
  request: Pick<ServerRequestItem, 'requestedSchema' | 'responseSchema'>,
): Record<string, Record<string, unknown>> {
  const schema = request.requestedSchema ?? request.responseSchema;
  if (!schema || typeof schema !== 'object') {
    return {};
  }
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return {};
  }
  return properties as Record<string, Record<string, unknown>>;
}

export function isUserInputApproval(request: { method?: string; kind?: string }): boolean {
  return request.method === 'item/tool/requestUserInput' || request.kind === 'user_input';
}

export function isDynamicToolApproval(request: { method?: string; kind?: string }): boolean {
  return request.method === 'item/tool/call' || request.kind === 'dynamic_tool_call';
}

export function isMcpElicitationApproval(request: { method?: string; kind?: string }): boolean {
  return request.method === 'mcpServer/elicitation/request' || request.kind === 'mcp_server_elicitation';
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

export function formatNotificationTitle(method: string, params: Record<string, unknown>): string {
  if (method === 'mcpServer/startupStatus/updated') {
    return 'MCP 服务状态';
  }
  if (method === 'mcpServer/oauthLogin/completed') {
    return 'MCP OAuth';
  }
  if (method === 'account/rateLimits/updated') {
    return '额度更新';
  }
  if (method === 'account/updated') {
    return '账户更新';
  }
  if (method === 'account/login/completed') {
    return '账户登录';
  }
  if (method === 'guardianWarning') {
    return 'Guardian 警告';
  }
  if (method === 'deprecationNotice') {
    return '弃用通知';
  }
  if (method === 'configWarning') {
    return '配置警告';
  }
  if (method === 'windows/worldWritableWarning') {
    return 'Windows 安全警告';
  }
  if (method === 'windowsSandbox/setupCompleted') {
    return 'Windows Sandbox';
  }
  if (method === 'remoteControl/status/changed') {
    return '远程控制状态';
  }
  if (method === 'skills/changed') {
    return '技能已更新';
  }
  if (method === 'app/list/updated') {
    return '应用列表更新';
  }
  if (method === 'externalAgentConfig/import/completed') {
    return '外部代理配置导入完成';
  }
  if (method === 'fs/changed') {
    return '文件系统更新';
  }
  if (method === 'fuzzyFileSearch/sessionUpdated') {
    return '模糊搜索更新';
  }
  if (method === 'fuzzyFileSearch/sessionCompleted') {
    return '模糊搜索完成';
  }
  return typeof params.summary === 'string' && params.summary.trim()
    ? params.summary
    : method;
}

export function formatNotificationMessage(method: string, params: Record<string, unknown>): string {
  if (method === 'mcpServer/startupStatus/updated') {
    const name = typeof params.name === 'string' ? params.name : 'MCP';
    const status = typeof params.status === 'string' ? params.status : 'unknown';
    const error = typeof params.error === 'string' && params.error.trim() ? ` · ${params.error}` : '';
    return `${name} · ${status}${error}`;
  }
  if (method === 'mcpServer/oauthLogin/completed') {
    const name = typeof params.name === 'string' ? params.name : 'MCP';
    const success = params.success === true;
    const error = typeof params.error === 'string' && params.error.trim() ? ` · ${params.error}` : '';
    return `${name} · ${success ? '登录成功' : '登录失败'}${error}`;
  }
  if (method === 'account/rateLimits/updated') {
    const rateLimits = params.rateLimits && typeof params.rateLimits === 'object'
      ? params.rateLimits as Record<string, unknown>
      : null;
    const limitName = typeof rateLimits?.limitName === 'string' ? rateLimits.limitName : '';
    const planType = typeof rateLimits?.planType === 'string' ? rateLimits.planType : '';
    const reachedType = typeof rateLimits?.rateLimitReachedType === 'string' ? rateLimits.rateLimitReachedType : '';
    return [limitName, planType, reachedType].filter(Boolean).join(' · ') || '账户额度状态已更新';
  }
  if (method === 'account/updated') {
    const authMode = typeof params.authMode === 'string' ? params.authMode : '';
    const planType = typeof params.planType === 'string' ? params.planType : '';
    return [authMode, planType].filter(Boolean).join(' · ') || '账户信息已更新';
  }
  if (method === 'account/login/completed') {
    const success = params.success === true;
    const error = typeof params.error === 'string' && params.error.trim() ? ` · ${params.error}` : '';
    return `${success ? '登录成功' : '登录失败'}${error}`;
  }
  if (method === 'guardianWarning') {
    return typeof params.message === 'string' ? params.message : 'Guardian 发出警告';
  }
  if (method === 'deprecationNotice') {
    const summary = typeof params.summary === 'string' ? params.summary : '';
    const details = typeof params.details === 'string' ? params.details : '';
    return [summary, details].filter(Boolean).join(' · ') || '存在即将弃用的能力';
  }
  if (method === 'configWarning') {
    const summary = typeof params.summary === 'string' ? params.summary : '';
    const details = typeof params.details === 'string' ? params.details : '';
    const path = typeof params.path === 'string' ? params.path : '';
    return [summary, details, path].filter(Boolean).join(' · ') || '配置存在警告';
  }
  if (method === 'windows/worldWritableWarning') {
    const samplePaths = Array.isArray(params.samplePaths)
      ? params.samplePaths.filter((value): value is string => typeof value === 'string')
      : [];
    const extraCount = typeof params.extraCount === 'number' ? params.extraCount : 0;
    const failedScan = params.failedScan === true ? ' · 扫描未完成' : '';
    const extraLabel = extraCount > 0 ? ` · 另有 ${extraCount} 项` : '';
    return `${samplePaths.slice(0, 2).join(' · ') || '检测到 world-writable 路径'}${extraLabel}${failedScan}`;
  }
  if (method === 'windowsSandbox/setupCompleted') {
    const mode = typeof params.mode === 'string' ? params.mode : '';
    const success = params.success === true;
    const error = typeof params.error === 'string' && params.error.trim() ? ` · ${params.error}` : '';
    return `${mode || 'sandbox'} · ${success ? '设置完成' : '设置失败'}${error}`;
  }
  if (method === 'remoteControl/status/changed') {
    const status = typeof params.status === 'string' ? params.status : '';
    const environmentId = typeof params.environmentId === 'string' ? params.environmentId : '';
    return [status, environmentId].filter(Boolean).join(' · ') || '远程控制状态已更新';
  }
  if (method === 'skills/changed') {
    return '可用技能列表已刷新';
  }
  if (method === 'app/list/updated') {
    const data = Array.isArray(params.data) ? params.data : [];
    return `共 ${data.length} 个应用`;
  }
  if (method === 'externalAgentConfig/import/completed') {
    return '外部代理配置已导入';
  }
  if (method === 'fs/changed') {
    const watchId = typeof params.watchId === 'string' ? params.watchId : '';
    const changedPaths = Array.isArray(params.changedPaths)
      ? params.changedPaths.filter((value): value is string => typeof value === 'string')
      : [];
    return [watchId, ...changedPaths.slice(0, 2)].filter(Boolean).join(' · ') || '文件系统事件';
  }
  if (method === 'fuzzyFileSearch/sessionUpdated') {
    const query = typeof params.query === 'string' ? params.query : '';
    const files = Array.isArray(params.files) ? params.files : [];
    return [query, `${files.length} 个结果`].filter(Boolean).join(' · ') || '模糊搜索结果已更新';
  }
  if (method === 'fuzzyFileSearch/sessionCompleted') {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    return sessionId ? `${sessionId} 已完成` : '模糊搜索已完成';
  }
  return summarizeUnknownObject(params, 4) || '收到系统通知';
}

export function getNotificationLevel(method: string, params: Record<string, unknown>): 'info' | 'warning' | 'error' {
  if (
    method === 'guardianWarning'
    || method === 'configWarning'
    || method === 'deprecationNotice'
    || method === 'windows/worldWritableWarning'
  ) {
    return 'warning';
  }
  if (
    method === 'mcpServer/startupStatus/updated'
    || method === 'mcpServer/oauthLogin/completed'
    || method === 'windowsSandbox/setupCompleted'
  ) {
    if (params.success === false || params.status === 'failed' || typeof params.error === 'string') {
      return 'error';
    }
  }
  if (method === 'account/login/completed' && params.success === false) {
    return 'error';
  }
  if (method === 'remoteControl/status/changed' && params.status === 'errored') {
    return 'error';
  }
  return 'info';
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
