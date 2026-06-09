import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovalDecisionResponse,
  buildTokenUsageDisplay,
  formatApprovalMethodLabel,
  formatNotificationMessage,
  formatNotificationTitle,
  formatTokenUsageValue,
  formatWorkspaceLabel,
  getNotificationLevel,
  getMcpSchemaProperties,
  isDynamicToolApproval,
  isMcpElicitationApproval,
  isUserInputApproval,
} from '../src/app/view-helpers.js';

test('buildApprovalDecisionResponse preserves structured approval decisions', () => {
  const decision = {
    acceptWithExecpolicyAmendment: {
      add: ['RemoteSigned'],
    },
  };

  assert.deepEqual(buildApprovalDecisionResponse(decision as any), { decision });
});

test('buildApprovalDecisionResponse wraps string decisions for codex requests', () => {
  assert.deepEqual(buildApprovalDecisionResponse('accept'), { decision: 'accept' });
});

test('approval method helpers prefer official server request methods', () => {
  assert.equal(formatApprovalMethodLabel('item/tool/requestUserInput'), '用户输入');
  assert.equal(formatApprovalMethodLabel('item/tool/call'), '动态工具');
  assert.equal(formatApprovalMethodLabel('mcpServer/elicitation/request'), 'MCP 请求');
  assert.equal(isUserInputApproval({ method: 'item/tool/requestUserInput' }), true);
  assert.equal(isDynamicToolApproval({ method: 'item/tool/call' }), true);
  assert.equal(isMcpElicitationApproval({ method: 'mcpServer/elicitation/request' }), true);
});

test('getMcpSchemaProperties prefers requestedSchema over legacy responseSchema', () => {
  assert.deepEqual(getMcpSchemaProperties({
    requestedSchema: {
      properties: {
        apiKey: { title: 'API Key', type: 'string' },
      },
    },
    responseSchema: {
      properties: {
        ignored: { title: 'Ignored', type: 'string' },
      },
    },
  } as any), {
    apiKey: { title: 'API Key', type: 'string' },
  });
});

test('formatTokenUsageValue renders context percentage when context window is available', () => {
  assert.equal(formatTokenUsageValue({
    total: { totalTokens: 24782992 },
    last: { totalTokens: 181771 },
    modelContextWindow: 258400,
  }), '70%');
});

test('formatTokenUsageValue falls back to total tokens and makes empty state explicit', () => {
  assert.equal(formatTokenUsageValue({ totalTokens: 77 }), '总 77');
  assert.equal(formatTokenUsageValue(null), '未统计');
});

test('formatTokenUsageValue normalizes nested and string token values', () => {
  assert.equal(formatTokenUsageValue({
    usage: {
      last: { total_tokens: '90' },
      model_context_window: '120',
    },
  }), '75%');
  assert.equal(formatTokenUsageValue({ usage: { prompt_tokens: '21', completion_tokens: '12' } }), '输入 21 / 输出 12');
});

test('buildTokenUsageDisplay exposes remaining context for ring rendering', () => {
  assert.deepEqual(buildTokenUsageDisplay({
    usage: {
      last: { total_tokens: '30' },
      model_context_window: '120',
    },
  }), {
    percentUsed: 25,
    percentRemaining: 75,
    usedTokens: 30,
    remainingTokens: 90,
    contextWindow: 120,
    label: '上下文余量',
    detail: '剩余 75% · 90 / 120 tokens',
  });
});

test('formatWorkspaceLabel keeps only the folder name for sidebar display', () => {
  assert.equal(formatWorkspaceLabel('C:\\Users\\Administrator\\Desktop\\cc-workspace'), 'cc-workspace');
  assert.equal(formatWorkspaceLabel('/srv/projects/avatar/'), 'avatar');
  assert.equal(formatWorkspaceLabel('C:'), 'C:');
  assert.equal(formatWorkspaceLabel(''), '未设置工作区');
});

test('notification helpers format key official notifications', () => {
  assert.equal(
    formatNotificationTitle('mcpServer/startupStatus/updated', { name: 'docs', status: 'ready', error: null }),
    'MCP 服务状态',
  );
  assert.equal(
    formatNotificationMessage('mcpServer/startupStatus/updated', { name: 'docs', status: 'ready', error: null }),
    'docs · ready',
  );
  assert.equal(
    getNotificationLevel('mcpServer/startupStatus/updated', { name: 'docs', status: 'failed', error: 'boom' }),
    'error',
  );
  assert.equal(
    formatNotificationTitle('guardianWarning', { threadId: 'thread-1', message: 'Need review' }),
    'Guardian 警告',
  );
  assert.equal(
    formatNotificationMessage('guardianWarning', { threadId: 'thread-1', message: 'Need review' }),
    'Need review',
  );
  assert.equal(
    getNotificationLevel('guardianWarning', { threadId: 'thread-1', message: 'Need review' }),
    'warning',
  );
  assert.equal(
    formatNotificationMessage('account/rateLimits/updated', {
      rateLimits: {
        limitName: 'GPT-5',
        planType: 'plus',
        rateLimitReachedType: 'soft',
      },
    }),
    'GPT-5 · plus · soft',
  );
  assert.equal(
    formatNotificationTitle('thread/settings/updated', {
      threadId: 'thread-1',
      threadSettings: { model: 'gpt-5.5', effort: 'high', cwd: 'C:\\workspace' },
    }),
    '会话参数已更新',
  );
  assert.equal(
    formatNotificationMessage('thread/settings/updated', {
      threadId: 'thread-1',
      threadSettings: { model: 'gpt-5.5', effort: 'high', cwd: 'C:\\workspace' },
    }),
    'gpt-5.5 · high · C:\\workspace',
  );
  assert.equal(
    formatNotificationTitle('turn/moderationMetadata', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      metadata: { category: 'safety', outcome: 'allow', action: 'none' },
    }),
    '内容审查元数据',
  );
  assert.equal(
    formatNotificationMessage('turn/moderationMetadata', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      metadata: { category: 'safety', outcome: 'allow', action: 'none' },
    }),
    'safety · allow · none',
  );
});
