import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAppServerClient } from '../src/platform/codex-client.js';

function makeThread(id: string, turns: unknown[] = []) {
  return {
    id,
    sessionId: 'session-1',
    forkedFromId: null,
    parentThreadId: null,
    preview: '',
    ephemeral: false,
    modelProvider: 'openai',
    createdAt: 1,
    updatedAt: 2,
    status: 'idle',
    path: null,
    cwd: 'C:\\workspace',
    cliVersion: 'test',
    source: 'app-server',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: 'Thread',
    turns,
  };
}

function makeTurn(id: string, startedAt: number) {
  return {
    id,
    items: [],
    itemsView: 'full',
    status: 'completed',
    error: null,
    startedAt,
    completedAt: startedAt + 1,
    durationMs: null,
  };
}

function makeResumeResponse(thread: unknown, initialTurnsPage: unknown) {
  return {
    thread,
    model: 'gpt-5',
    modelProvider: 'openai',
    serviceTier: null,
    cwd: 'C:\\workspace',
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' },
    activePermissionProfile: null,
    reasoningEffort: 'medium',
    initialTurnsPage,
  };
}

test('resumeThread requests a full initial turns page and restores chronological turns', async () => {
  const client = new CodexAppServerClient({ cwd: 'C:\\workspace' });
  let capturedMethod = '';
  let capturedParams: any;

  (client as any).request = async (method: string, params: unknown) => {
    capturedMethod = method;
    capturedParams = params;
    return makeResumeResponse(makeThread('thread-1'), {
      data: [makeTurn('turn-new', 20), makeTurn('turn-old', 10)],
      nextCursor: null,
      backwardsCursor: null,
    });
  };

  const thread = await client.resumeThread('thread-1');

  assert.equal(capturedMethod, 'thread/resume');
  assert.deepEqual(capturedParams.initialTurnsPage, {
    limit: 100,
    sortDirection: 'desc',
    itemsView: 'full',
  });
  assert.deepEqual(thread.turns.map((turn) => turn.id), [
    'turn-old',
    'turn-new',
  ]);
});

test('resumeThread keeps live turn details when initial page overlaps thread.turns', async () => {
  const client = new CodexAppServerClient({ cwd: 'C:\\workspace' });
  const liveTurn = {
    ...makeTurn('turn-live', 30),
    status: 'inProgress',
    items: [{ id: 'assistant-live', type: 'agentMessage', text: 'partial' }],
  };

  (client as any).request = async () =>
    makeResumeResponse(makeThread('thread-1', [liveTurn]), {
      data: [makeTurn('turn-live', 30), makeTurn('turn-old', 10)],
      nextCursor: null,
      backwardsCursor: null,
    });

  const thread = await client.resumeThread('thread-1');
  const restoredLiveTurn = thread.turns.find((turn) => turn.id === 'turn-live');

  assert.deepEqual(thread.turns.map((turn) => turn.id), [
    'turn-old',
    'turn-live',
  ]);
  assert.equal(restoredLiveTurn?.status, 'inProgress');
  assert.equal(restoredLiveTurn?.items[0]?.id, 'assistant-live');
});

test('resumeThread skips initial turns page when explicitly excluding turns', async () => {
  const client = new CodexAppServerClient({ cwd: 'C:\\workspace' });
  let capturedParams: any;

  (client as any).request = async (_method: string, params: unknown) => {
    capturedParams = params;
    return makeResumeResponse(makeThread('thread-1'), null);
  };

  await client.resumeThread('thread-1', { excludeTurns: true });

  assert.equal(capturedParams.excludeTurns, true);
  assert.equal(capturedParams.initialTurnsPage, undefined);
});
