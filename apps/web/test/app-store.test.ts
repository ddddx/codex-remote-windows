import test from 'node:test';
import assert from 'node:assert/strict';
import { mapServerMessageToStore, useAppStore } from '../src/store/appStore.js';
import { buildTimelineGroups } from '../src/features/timeline/model.js';

function resetStore() {
  useAppStore.setState({
    health: { status: 'idle', data: null, error: null },
    connection: { status: 'idle', error: null },
    auth: { token: '' },
    sessions: { items: [], activeSessionId: null },
    timeline: { entriesBySessionId: {} },
    approvals: { items: [] },
    notifications: { items: [] },
    turns: { activeBySessionId: {} },
    tokenUsage: { bySessionId: {} },
    workspace: {
      shortcuts: null,
      listing: null,
      selectedPath: '',
      status: 'idle',
      error: null,
    },
    composer: { attachmentsBySessionId: {} },
  } as any);
}

test('request_user_input requests are normalized and retained in approvals store', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'server_request_required',
    request: {
      requestId: 'req-1',
      threadId: 'thread-1',
      kind: 'user_input',
      questions: [
        {
          id: 'color',
          question: 'Choose a color',
          header: 'Color',
          options: [{ label: 'Blue' }, { label: 'Green' }],
        },
      ],
      status: 'pending',
      createdAt: 1,
    },
  } as any);

  const state = useAppStore.getState();
  assert.equal(state.approvals.items.length, 1);
  assert.equal(state.approvals.items[0]?.kind, 'user_input');
  assert.equal(state.approvals.items[0]?.questions?.[0]?.id, 'color');
});

test('file change approval requests retain structured changes for diff rendering', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'server_request_required',
    request: {
      requestId: 'req-file-1',
      threadId: 'thread-1',
      kind: 'file_change_approval',
      patch: '*** Begin Patch\n*** Update File: apps/web/src/app/App.tsx\n+line\n*** End Patch',
      changes: [{ path: 'apps/web/src/app/App.tsx', kind: 'update', addedLines: 1, deletedLines: 0 }],
      status: 'pending',
      createdAt: 1,
    },
  } as any);

  const state = useAppStore.getState();
  assert.equal(state.approvals.items.length, 1);
  assert.equal(state.approvals.items[0]?.changes?.[0]?.path, 'apps/web/src/app/App.tsx');
  assert.equal(state.approvals.items[0]?.changes?.[0]?.addedLines, 1);
});

test('plan delta builds streaming plan timeline entry', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'plan_delta',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'plan-1',
    delta: 'Step 1',
  } as any);

  mapServerMessageToStore({
    type: 'plan_delta',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'plan-1',
    delta: ' -> done',
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-1'] || [];
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.type, 'plan');
  assert.equal(entries[0]?.text, 'Step 1 -> done');
  assert.equal(entries[0]?.status, 'running');
});

test('mcp progress and file change delta update rich timeline entries', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'mcp_tool_progress',
    threadId: 'thread-2',
    turnId: 'turn-2',
    itemId: 'mcp-1',
    message: 'Searching docs',
  } as any);

  mapServerMessageToStore({
    type: 'item_delta',
    threadId: 'thread-2',
    turnId: 'turn-2',
    itemId: 'file-1',
    method: 'item/fileChange/patchUpdated',
    patch: '*** Begin Patch\n*** End Patch',
    changes: [{ path: 'apps/web/src/app/App.tsx', kind: 'update', addedLines: 5, deletedLines: 2 }],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-2'] || [];
  assert.equal(entries.length, 2);
  const mcpEntry = entries.find((entry) => entry.id === 'mcp-1');
  const fileEntry = entries.find((entry) => entry.id === 'file-1');
  assert.deepEqual(mcpEntry?.meta, ['Searching docs']);
  assert.equal(fileEntry?.patch, '*** Begin Patch\n*** End Patch');
  assert.equal(fileEntry?.changes?.[0]?.path, 'apps/web/src/app/App.tsx');
  assert.equal(fileEntry?.changes?.[0]?.addedLines, 5);
  assert.equal(fileEntry?.changes?.[0]?.deletedLines, 2);
});

test('file change output deltas are accumulated into patch text for diff rendering', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'item_delta',
    threadId: 'thread-file-output',
    turnId: 'turn-file-output',
    itemId: 'file-output-1',
    method: 'item/fileChange/outputDelta',
    delta: '*** Begin Patch\n*** Update File: src/a.ts\n+line 1\n',
    startedAt: 1,
  } as any);

  mapServerMessageToStore({
    type: 'item_delta',
    threadId: 'thread-file-output',
    turnId: 'turn-file-output',
    itemId: 'file-output-1',
    method: 'item/fileChange/outputDelta',
    delta: '-line 2\n*** End Patch',
    startedAt: 2,
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-file-output'] || [];
  const fileEntry = entries.find((entry) => entry.id === 'file-output-1');
  assert.equal(
    fileEntry?.patch,
    '*** Begin Patch\n*** Update File: src/a.ts\n+line 1\n-line 2\n*** End Patch',
  );
});

test('item started and completed map command entries without duplicating ids', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'item_started',
    threadId: 'thread-3',
    turnId: 'turn-3',
    item: {
      id: 'cmd-1',
      type: 'commandExecution',
      command: 'npm test',
      cwd: 'C:\\workspace',
      status: 'running',
    },
  } as any);

  mapServerMessageToStore({
    type: 'item_completed',
    threadId: 'thread-3',
    turnId: 'turn-3',
    item: {
      id: 'cmd-1',
      type: 'commandExecution',
      command: 'npm test',
      cwd: 'C:\\workspace',
      status: 'completed',
      output: 'all green',
    },
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-3'] || [];
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, 'cmd-1');
  assert.equal(entries[0]?.status, 'completed');
  assert.equal(entries[0]?.text, 'npm test');
});

test('thread sync restores plan diff supplemental and notice entries', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-restore',
    turns: [],
    tokenUsage: null,
    turnPlans: [{
      turnId: 'turn-a',
      explanation: 'Why',
      plan: [{ step: 'Refactor', status: 'completed' }],
      updatedAt: 1,
    }],
    turnDiffs: [{
      turnId: 'turn-a',
      diff: '*** Begin Patch\n*** End Patch',
      updatedAt: 1,
    }],
    supplementalItems: [{
      id: 'hook-a',
      type: 'hookEvent',
      phase: 'completed',
      status: 'completed',
    }],
    globalSupplementalItems: [{
      id: 'notice-a',
      type: '_warning',
      noticeKind: 'warning',
      text: 'Recovered warning',
      createdAt: 1,
    }],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-restore'] || [];
  assert.equal(entries.length, 3);
  assert.ok(entries.some((entry) => entry.type === 'turn_plan'));
  assert.ok(entries.some((entry) => entry.type === 'turn_diff'));
  assert.ok(entries.some((entry) => entry.type === 'hook'));
});

test('reasoning, turn updates and notices are normalized into timeline semantics', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'item_delta',
    threadId: 'thread-live',
    turnId: 'turn-live',
    itemId: 'reasoning-1',
    method: 'item/reasoning/textDelta',
    delta: 'Thinking',
  } as any);

  mapServerMessageToStore({
    type: 'turn_plan_updated',
    threadId: 'thread-live',
    turnId: 'turn-live',
    explanation: 'Do work',
    plan: [{ step: 'Inspect', status: 'completed' }, { step: 'Patch', status: 'in_progress' }],
  } as any);

  mapServerMessageToStore({
    type: 'turn_diff_updated',
    threadId: 'thread-live',
    turnId: 'turn-live',
    diff: '*** Begin Patch\n*** End Patch',
  } as any);

  mapServerMessageToStore({
    type: 'warning',
    threadId: 'thread-live',
    noticeId: 'warn-1',
    noticeKind: 'warning',
    message: 'Watch out',
    createdAt: 10,
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-live'] || [];
  const notifications = useAppStore.getState().notifications.items;
  assert.ok(entries.some((entry) => entry.type === 'reasoning' && entry.text === 'Thinking'));
  assert.ok(entries.some((entry) => entry.type === 'turn_plan' && entry.turnId === 'turn-live'));
  assert.ok(entries.some((entry) => entry.type === 'turn_diff' && entry.patch === '*** Begin Patch\n*** End Patch'));
  assert.ok(notifications.some((entry) => entry.message === 'Watch out' && entry.level === 'warning'));
});

test('turn diff updates merge into the existing file change entry for the same turn', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'item_delta',
    threadId: 'thread-file-merge',
    turnId: 'turn-file-merge',
    itemId: 'file-merge-1',
    method: 'item/fileChange/patchUpdated',
    patch: '*** Begin Patch\n*** Update File: src/a.ts\n+draft\n*** End Patch',
    changes: [{ path: 'src/a.ts', kind: 'update', addedLines: 1, deletedLines: 0 }],
    startedAt: 1,
  } as any);

  mapServerMessageToStore({
    type: 'turn_diff_updated',
    threadId: 'thread-file-merge',
    turnId: 'turn-file-merge',
    diff: '*** Begin Patch\n*** Update File: src/a.ts\n+final\n*** End Patch',
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-file-merge'] || [];
  assert.equal(entries.filter((entry) => entry.turnId === 'turn-file-merge').length, 1);
  assert.equal(entries[0]?.type, 'file_change');
  assert.equal(entries[0]?.patch, '*** Begin Patch\n*** Update File: src/a.ts\n+final\n*** End Patch');
});

test('file change completion without patch preserves previously streamed diff content', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'item_delta',
    threadId: 'thread-file-complete-keep',
    turnId: 'turn-file-complete-keep',
    itemId: 'file-keep-1',
    method: 'item/fileChange/patchUpdated',
    patch: '*** Begin Patch\n*** Update File: src/keep.ts\n+live diff\n*** End Patch',
    changes: [{ path: 'src/keep.ts', kind: 'update', addedLines: 1, deletedLines: 0 }],
    startedAt: 1,
  } as any);

  mapServerMessageToStore({
    type: 'item_completed',
    threadId: 'thread-file-complete-keep',
    turnId: 'turn-file-complete-keep',
    item: {
      id: 'file-keep-1',
      type: 'fileChange',
      status: 'completed',
      changes: [{ path: 'src/keep.ts', kind: 'update', addedLines: 1, deletedLines: 0 }],
    },
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-file-complete-keep'] || [];
  const fileEntry = entries.find((entry) => entry.id === 'file-keep-1');
  assert.equal(fileEntry?.status, 'completed');
  assert.equal(fileEntry?.patch, '*** Begin Patch\n*** Update File: src/keep.ts\n+live diff\n*** End Patch');
});

test('thread sync restores file change diff from structured output fields', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-structured-file-diff',
    turns: [{
      id: 'turn-structured-file-diff',
      createdAt: 1,
      items: [
        {
          id: 'file-structured-1',
          type: 'fileChange',
          status: 'completed',
          output: [
            { type: 'output_text', text: '*** Begin Patch\n*** Update File: src/structured.ts\n+restored\n*** End Patch' },
          ],
          changes: [{ path: 'src/structured.ts', kind: 'update', addedLines: 1, deletedLines: 0 }],
        },
      ],
    }],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-structured-file-diff'] || [];
  const fileEntry = entries.find((entry) => entry.id === 'file-structured-1');
  assert.equal(fileEntry?.patch, '*** Begin Patch\n*** Update File: src/structured.ts\n+restored\n*** End Patch');
});

test('thread sync preserves per-change diffs when file change item has no top-level patch', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-change-level-diff',
    turns: [{
      id: 'turn-change-level-diff',
      createdAt: 1,
      items: [
        {
          id: 'file-change-level-1',
          type: 'fileChange',
          status: 'completed',
          changes: [{
            path: 'src/change-level.ts',
            kind: 'update',
            diff: '@@ -1 +1 @@\n-old\n+new',
          }],
        },
      ],
    }],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-change-level-diff'] || [];
  const fileEntry = entries.find((entry) => entry.id === 'file-change-level-1');
  assert.equal(fileEntry?.patch, undefined);
  assert.equal((fileEntry?.changes?.[0] as any)?.diff, '@@ -1 +1 @@\n-old\n+new');
});

test('duplicate file change entries with the same path are preserved in store for UI-side dedupe', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'item_delta',
    threadId: 'thread-file-duplicate-preview',
    turnId: 'turn-file-duplicate-preview',
    itemId: 'file-duplicate-preview-1',
    method: 'item/fileChange/patchUpdated',
    patch: '*** Begin Patch\n*** Update File: src/dup.ts\n+draft\n*** End Patch',
    changes: [{ path: 'src/dup.ts', kind: 'update', addedLines: 1, deletedLines: 0 }],
    startedAt: 1,
  } as any);

  mapServerMessageToStore({
    type: 'item_completed',
    threadId: 'thread-file-duplicate-preview',
    turnId: 'turn-file-duplicate-preview',
    item: {
      id: 'file-duplicate-preview-1',
      type: 'fileChange',
      status: 'completed',
      changes: [{ path: 'src/dup.ts', kind: 'update', addedLines: 2, deletedLines: 1 }],
    },
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-file-duplicate-preview'] || [];
  const fileEntry = entries.find((entry) => entry.id === 'file-duplicate-preview-1');
  assert.equal(fileEntry?.changes?.length, 1);
  assert.equal(fileEntry?.changes?.[0]?.path, 'src/dup.ts');
});

test('thread sync merges turn diff into restored file change entry for the same turn', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-sync-file-merge',
    turns: [{
      id: 'turn-sync-file-merge',
      createdAt: 1,
      items: [
        {
          id: 'file-sync-1',
          type: 'fileChange',
          changes: [{ path: 'src/b.ts', kind: 'update', addedLines: 1, deletedLines: 1 }],
        },
      ],
    }],
    turnDiffs: [{
      turnId: 'turn-sync-file-merge',
      diff: '*** Begin Patch\n*** Update File: src/b.ts\n+patched\n*** End Patch',
      updatedAt: 2,
    }],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-sync-file-merge'] || [];
  const turnEntries = entries.filter((entry) => entry.turnId === 'turn-sync-file-merge');
  assert.equal(turnEntries.length, 1);
  assert.equal(turnEntries[0]?.type, 'file_change');
  assert.equal(turnEntries[0]?.patch, '*** Begin Patch\n*** Update File: src/b.ts\n+patched\n*** End Patch');
});

test('timeline groups combine turn entries and inline approvals', () => {
  const groups = buildTimelineGroups([
    {
      id: 'turn-1-user',
      type: 'message',
      role: 'user',
      turnId: 'turn-1',
      text: 'hello',
      createdAt: 1,
    },
    {
      id: 'turn-1-plan',
      type: 'turn_plan',
      role: 'assistant',
      turnId: 'turn-1',
      text: 'plan',
      status: 'running',
      createdAt: 2,
    },
  ], [
    {
      requestId: 'req-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      kind: 'command_approval',
      status: 'pending',
      command: 'npm test',
      createdAt: 3,
    },
  ], {
    active: true,
    turnId: 'turn-1',
    startedAt: 1,
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.turnId, 'turn-1');
  assert.equal(groups[0]?.entries.length, 2);
  assert.equal(groups[0]?.approvals.length, 1);
  assert.equal(groups[0]?.status, 'running');
});

test('thread sync keeps visible user and assistant messages when a turn also contains tool items', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-mixed',
    turns: [{
      id: 'turn-mixed',
      createdAt: 1,
      updatedAt: 2,
      input: [{ type: 'text', text: '用户提问' }],
      output: '助手回复',
      items: [
        {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'npm test',
          status: 'completed',
          createdAt: 1.2,
        },
      ],
    }],
    tokenUsage: null,
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-mixed'] || [];
  assert.ok(entries.some((entry) => entry.role === 'user' && entry.text === '用户提问'));
  assert.ok(entries.some((entry) => entry.role === 'assistant' && entry.text === '助手回复'));
  assert.ok(entries.some((entry) => entry.type === 'command' && entry.text === 'npm test'));
});

test('thread sync does not synthesize user text from assistant items and restores context compaction', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-context',
    turns: [{
      id: 'turn-context',
      createdAt: 1,
      items: [
        {
          id: 'assistant-1',
          type: 'agentMessage',
          text: '只有助手消息',
        },
        {
          id: 'compact-1',
          type: 'contextCompaction',
        },
      ],
    }],
    tokenUsage: null,
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-context'] || [];
  assert.equal(entries.filter((entry) => entry.role === 'user').length, 0);
  assert.ok(entries.some((entry) => entry.id === 'assistant-1' && entry.role === 'assistant'));
  assert.ok(entries.some((entry) => entry.id === 'compact-1' && entry.type === 'context_compaction'));
});

test('thread sync restores assistant message text from structured agentMessage content', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-structured-assistant',
    turns: [{
      id: 'turn-structured-assistant',
      createdAt: 1,
      items: [
        {
          id: 'assistant-structured',
          type: 'agentMessage',
          content: [
            { type: 'output_text', text: '结构化助手回复' },
          ],
        },
      ],
    }],
    tokenUsage: null,
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-structured-assistant'] || [];
  assert.ok(entries.some((entry) => entry.id === 'assistant-structured' && entry.text === '结构化助手回复'));
});

test('thread sync restores assistant fallback text from structured turn output', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-structured-output',
    turns: [{
      id: 'turn-structured-output',
      createdAt: 1,
      updatedAt: 2,
      input: [{ type: 'input_text', text: '用户问题' }],
      output: [
        { type: 'output_text', text: '结构化输出回复' },
      ],
    }],
    tokenUsage: null,
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-structured-output'] || [];
  assert.ok(entries.some((entry) => entry.role === 'assistant' && entry.text === '结构化输出回复'));
  assert.ok(entries.some((entry) => entry.role === 'user' && entry.text === '用户问题'));
});

test('thread sync restores user message text from direct userMessage text fields', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-direct-user-text',
    turns: [{
      id: 'turn-direct-user-text',
      createdAt: 1,
      items: [
        {
          id: 'user-direct',
          type: 'userMessage',
          text: '直接用户消息',
        },
        {
          id: 'assistant-direct',
          type: 'agentMessage',
          text: '助手回复',
        },
      ],
    }],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-direct-user-text'] || [];
  assert.ok(entries.some((entry) => entry.id === 'user-direct' && entry.role === 'user' && entry.text === '直接用户消息'));
});

test('thread sync preserves within-turn item order when items have no timestamps', () => {
  resetStore();
  const baseTime = 1_700_000_000_000;

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-order',
    turns: [{
      id: 'turn-order',
      createdAt: baseTime,
      updatedAt: baseTime + 999,
      items: [
        {
          id: 'user-1',
          type: 'userMessage',
          content: [{ type: 'input_text', text: '第一条用户消息' }],
        },
        {
          id: 'assistant-1',
          type: 'agentMessage',
          text: '第一条助手消息',
        },
        {
          id: 'change-1',
          type: 'fileChange',
          changes: [{ path: 'apps/web/src/app/App.tsx', kind: 'update', addedLines: 3, deletedLines: 1 }],
        },
        {
          id: 'assistant-2',
          type: 'agentMessage',
          text: '第二条助手消息',
        },
      ],
    }],
  } as any);

  const entries = (useAppStore.getState().timeline.entriesBySessionId['thread-order'] || [])
    .filter((entry) => entry.turnId === 'turn-order');
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['user-1', 'assistant-1', 'change-1', 'assistant-2'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.createdAt),
    [baseTime, baseTime + 1, baseTime + 2, baseTime + 3],
  );
});

test('thread sync reuses stable item ids and drops duplicate optimistic user entries after reconnect', () => {
  resetStore();

  useAppStore.getState().appendTimelineEntry('thread-reconnect', {
    id: 'local-user:web-1',
    type: 'message',
    role: 'user',
    turnId: 'thread-reconnect:pending-turn',
    text: 'push',
    createdAt: 10,
  });

  mapServerMessageToStore({
    type: 'item_completed',
    threadId: 'thread-reconnect',
    turnId: 'turn-reconnect',
    item: {
      id: 'assistant-rt-1',
      type: 'agentMessage',
      text: '准备推送',
      createdAt: 11,
    },
  } as any);

  mapServerMessageToStore({
    type: 'item_completed',
    threadId: 'thread-reconnect',
    turnId: 'turn-reconnect',
    item: {
      id: 'cmd-rt-1',
      type: 'commandExecution',
      command: 'git push origin main',
      status: 'completed',
      createdAt: 12,
    },
  } as any);

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-reconnect',
    turns: [{
      id: 'turn-reconnect',
      createdAt: 10,
      updatedAt: 13,
      items: [
        {
          id: 'user-rt-1',
          type: 'userMessage',
          content: [{ type: 'input_text', text: 'push' }],
          createdAt: 10,
        },
        {
          id: 'assistant-rt-1',
          type: 'agentMessage',
          text: '准备推送',
          createdAt: 11,
        },
        {
          id: 'cmd-rt-1',
          type: 'commandExecution',
          command: 'git push origin main',
          status: 'completed',
          createdAt: 12,
        },
      ],
    }],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-reconnect'] || [];
  assert.equal(entries.filter((entry) => entry.role === 'user' && entry.text === 'push').length, 1);
  assert.equal(entries.filter((entry) => entry.id === 'assistant-rt-1').length, 1);
  assert.equal(entries.filter((entry) => entry.id === 'cmd-rt-1').length, 1);
});

test('real-time item started uses server event time so command stays after pending user prompt', () => {
  resetStore();
  const userTime = 1_700_000_000_100;
  const commandTime = 1_700_000_000_101;

  useAppStore.getState().appendTimelineEntry('thread-live-order', {
    id: 'local-user:web-live-order',
    type: 'message',
    role: 'user',
    turnId: 'thread-live-order:pending-turn',
    text: 'run tests',
    createdAt: userTime,
  });

  mapServerMessageToStore({
    type: 'item_started',
    threadId: 'thread-live-order',
    turnId: 'turn-live-order',
    startedAt: commandTime,
    item: {
      id: 'cmd-live-order',
      type: 'commandExecution',
      command: 'npm test',
      status: 'running',
    },
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-live-order'] || [];
  const renderOrder = [...entries].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
  assert.deepEqual(
    renderOrder.map((entry) => entry.id),
    ['local-user:web-live-order', 'cmd-live-order'],
  );
  assert.equal(entries.find((entry) => entry.id === 'cmd-live-order')?.createdAt, commandTime);
});

test('state and thread sync preserve usable token usage for active session header', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'state',
    tabs: [{
      threadId: 'thread-usage',
      name: 'Usage Session',
      cwd: 'C:\\workspace',
      status: 'idle',
      tokenUsage: { totalTokens: 77 },
    }],
    serverRequests: [],
    globalSupplementalItems: [],
  } as any);

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-usage',
    turns: [],
  } as any);

  const usage = useAppStore.getState().tokenUsage.bySessionId['thread-usage'] as any;
  assert.equal(usage?.totalTokens, 77);
});

test('thread sync clears stale active turn state when the turn has already settled', () => {
  resetStore();

  useAppStore.getState().setTurnStarted('thread-stale', 'turn-stale', 1_700_000_000_000);
  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-stale',
    turns: [{
      id: 'turn-stale',
      createdAt: 1_700_000_000_000,
      items: [
        {
          id: 'user-stale',
          type: 'userMessage',
          content: [{ type: 'input_text', text: '用户问题' }],
        },
        {
          id: 'assistant-stale',
          type: 'agentMessage',
          text: '已经完成的回复',
        },
      ],
    }],
  } as any);

  const turnState = useAppStore.getState().turns.activeBySessionId['thread-stale'];
  assert.equal(turnState?.active, false);
  assert.equal(turnState?.turnId, 'turn-stale');
});

test('state leaves active session empty when no session has been chosen', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'state',
    tabs: [{
      threadId: 'thread-first',
      name: 'First',
      cwd: 'C:\\workspace',
      status: 'idle',
    }],
    serverRequests: [],
    globalSupplementalItems: [],
  } as any);

  assert.equal(useAppStore.getState().sessions.activeSessionId, null);
});

test('tab updates do not auto-select a session during bootstrap', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'tab_updated',
    tab: {
      threadId: 'thread-bootstrap',
      name: 'Bootstrap Thread',
      cwd: 'C:\\workspace',
      status: 'idle',
      windowStatus: 'attached',
    },
  } as any);

  assert.equal(useAppStore.getState().sessions.activeSessionId, null);
});

test('tab updates can refresh token usage independently of thread sync payload', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'tab_updated',
    tab: {
      threadId: 'thread-usage-2',
      name: 'Usage Session 2',
      cwd: 'C:\\workspace',
      status: 'idle',
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    },
  } as any);

  const usage = useAppStore.getState().tokenUsage.bySessionId['thread-usage-2'] as any;
  assert.equal(usage?.inputTokens, 12);
  assert.equal(usage?.outputTokens, 5);
});

test('tab updates synchronize composer permission prefs for the session', () => {
  resetStore();

  useAppStore.getState().setComposerPrefs('thread-prefs-sync', {
    model: 'old-model',
    reasoningEffort: 'low',
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
  });

  mapServerMessageToStore({
    type: 'tab_updated',
    tab: {
      threadId: 'thread-prefs-sync',
      name: 'Prefs Sync',
      cwd: 'C:\\workspace',
      status: 'idle',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
    },
  } as any);

  const prefs = useAppStore.getState().composer.prefsBySessionId['thread-prefs-sync'];
  assert.equal(prefs?.model, 'gpt-5.5');
  assert.equal(prefs?.reasoningEffort, 'high');
  assert.equal(prefs?.approvalPolicy, 'on-request');
  assert.equal(prefs?.sandboxMode, 'workspace-write');
});

test('state payload tabs initialize composer permission prefs by session', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'state',
    tabs: [{
      threadId: 'thread-state-prefs',
      name: 'State Prefs',
      cwd: 'C:\\workspace',
      approvalPolicy: 'on-request',
      sandboxMode: 'danger-full-access',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    }],
    serverRequests: [],
    globalSupplementalItems: [],
  } as any);

  const prefs = useAppStore.getState().composer.prefsBySessionId['thread-state-prefs'];
  assert.equal(prefs?.model, 'gpt-5.4');
  assert.equal(prefs?.reasoningEffort, 'medium');
  assert.equal(prefs?.approvalPolicy, 'on-request');
  assert.equal(prefs?.sandboxMode, 'danger-full-access');
});

test('nested token usage payloads are normalized for header display', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'token_usage',
    threadId: 'thread-usage-3',
    usage: {
      usage: {
        total_tokens: 33,
        prompt_tokens: 21,
        completion_tokens: 12,
      },
    },
  } as any);

  const usage = useAppStore.getState().tokenUsage.bySessionId['thread-usage-3'] as any;
  assert.equal(usage?.totalTokens, 33);
  assert.equal(usage?.inputTokens, 21);
  assert.equal(usage?.outputTokens, 12);
});

test('pending local user message is promoted when real turn output arrives after turn_started', () => {
  resetStore();

  useAppStore.getState().appendTimelineEntry('thread-promote', {
    id: 'local-user-1',
    type: 'message',
    role: 'user',
    turnId: 'thread-promote:pending-turn',
    text: 'hello',
    createdAt: 10,
  });

  mapServerMessageToStore({
    type: 'turn_started',
    threadId: 'thread-promote',
    turnId: 'turn-real',
    startedAt: 11,
  } as any);

  mapServerMessageToStore({
    type: 'agent_delta',
    threadId: 'thread-promote',
    turnId: 'turn-real',
    itemId: 'assistant-live-1',
    delta: 'world',
    startedAt: 12,
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-promote'] || [];
  const userEntry = entries.find((entry) => entry.id === 'local-user-1');
  const assistantEntry = entries.find((entry) => entry.id === 'assistant-live-1');
  assert.equal(userEntry?.turnId, 'turn-real');
  assert.equal(assistantEntry?.turnId, 'turn-real');
});

test('turn_send error removes optimistic local user entry and raises notification', () => {
  resetStore();

  useAppStore.getState().appendTimelineEntry('thread-send-error', {
    id: 'local-user:web-123',
    type: 'message',
    role: 'user',
    turnId: 'thread-send-error:pending-turn',
    text: 'hello',
    createdAt: 1,
  });

  mapServerMessageToStore({
    type: 'error',
    op: 'turn_send',
    threadId: 'thread-send-error',
    clientMessageId: 'web-123',
    message: 'start turn failed',
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-send-error'] || [];
  const notifications = useAppStore.getState().notifications.items;
  assert.ok(!entries.some((entry) => entry.id === 'local-user:web-123'));
  assert.ok(entries.some((entry) => entry.type === 'notice' && entry.text === 'start turn failed'));
  assert.ok(notifications.some((item) => item.id === 'send-error:web-123'));
});
