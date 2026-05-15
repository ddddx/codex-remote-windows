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
  assert.ok(entries.some((entry) => entry.id === 'turn-context:assistant-1' && entry.role === 'assistant'));
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
  assert.ok(entries.some((entry) => entry.id === 'turn-structured-assistant:assistant-structured' && entry.text === '结构化助手回复'));
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
    ['turn-order:user-1', 'turn-order:assistant-1', 'change-1', 'turn-order:assistant-2'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.createdAt),
    [baseTime, baseTime + 1, baseTime + 2, baseTime + 3],
  );
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

test('thread sync merges cached realtime timeline events after refresh', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-refresh',
    turns: [{
      id: 'turn-1',
      createdAt: 1,
      input: [{ type: 'text', text: '旧消息' }],
    }],
    tokenUsage: { totalTokens: 22 },
    timelineEvents: [
      {
        type: 'turn_started',
        threadId: 'thread-refresh',
        turnId: 'turn-2',
        startedAt: 2,
      },
      {
        type: 'agent_delta',
        threadId: 'thread-refresh',
        turnId: 'turn-2',
        itemId: 'assistant-live-2',
        delta: '新回复片段',
        startedAt: 3,
      },
      {
        type: 'item_delta',
        threadId: 'thread-refresh',
        turnId: 'turn-2',
        itemId: 'file-2',
        method: 'item/fileChange/patchUpdated',
        patch: '*** Begin Patch\n*** Update File: a.txt\n+line\n*** End Patch',
        changes: [{ path: 'a.txt', kind: 'update', addedLines: 1, deletedLines: 0 }],
        startedAt: 4,
      },
      {
        type: 'warning',
        threadId: 'thread-refresh',
        message: '审批还在等待',
        noticeId: 'warn-refresh',
        createdAt: 5,
      },
    ],
  } as any);

  const entries = useAppStore.getState().timeline.entriesBySessionId['thread-refresh'] || [];
  assert.ok(entries.some((entry) => entry.role === 'user' && entry.text === '旧消息'));
  assert.ok(entries.some((entry) => entry.id === 'assistant-live-2' && entry.text === '新回复片段'));
  assert.ok(entries.some((entry) => entry.id === 'file-2' && entry.patch?.includes('*** Update File: a.txt')));
  assert.ok(entries.some((entry) => entry.id === 'notice:warn-refresh' && entry.text === '审批还在等待'));
});

test('thread sync can restore token usage from timeline events when top-level usage is null', () => {
  resetStore();

  mapServerMessageToStore({
    type: 'thread_sync',
    threadId: 'thread-usage-from-events',
    turns: [],
    tokenUsage: null,
    timelineEvents: [
      {
        type: 'token_usage',
        threadId: 'thread-usage-from-events',
        usage: {
          total: {
            totalTokens: 101,
            inputTokens: 77,
            outputTokens: 24,
          },
          last: {
            totalTokens: 9,
            inputTokens: 4,
            outputTokens: 5,
          },
        },
      },
    ],
  } as any);

  const usage = useAppStore.getState().tokenUsage.bySessionId['thread-usage-from-events'] as any;
  assert.equal(usage?.totalTokens, 101);
  assert.equal(usage?.inputTokens, 77);
  assert.equal(usage?.outputTokens, 24);
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
