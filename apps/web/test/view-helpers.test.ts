import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalDecisionResponse, formatTokenUsageValue } from '../src/app/view-helpers.js';

test('buildApprovalDecisionResponse preserves structured approval decisions', () => {
  const decision = {
    acceptWithExecpolicyAmendment: {
      add: ['RemoteSigned'],
    },
  };

  assert.deepEqual(buildApprovalDecisionResponse(decision as any), decision);
});

test('buildApprovalDecisionResponse wraps string decisions for codex requests', () => {
  assert.deepEqual(buildApprovalDecisionResponse('accept'), { decision: 'accept' });
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
