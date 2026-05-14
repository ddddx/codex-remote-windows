import test from 'node:test';
import assert from 'node:assert/strict';
import { __windowManagerTestUtils } from '../src/platform/window-manager.js';

test('resume window selection does not promote powershell parent as control pid', () => {
  const threadId = '00000000-0000-0000-0000-000000000123';
  const windows = __windowManagerTestUtils.selectResumeWindows([
    {
      pid: 600,
      parentPid: 500,
      name: 'codex.exe',
      commandLine: `codex.exe --remote ws://127.0.0.1:34792 resume ${threadId}`,
    },
    {
      pid: 500,
      parentPid: 400,
      name: 'powershell.exe',
      commandLine: `pwsh -Command codex.cmd --remote ws://127.0.0.1:34792 resume ${threadId}`,
    },
  ]);

  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.pid, 600);
  assert.equal(windows[0]?.processName, 'codex.exe');
});

test('resume window selection can still promote cmd wrapper as control pid', () => {
  const threadId = '00000000-0000-0000-0000-000000000456';
  const windows = __windowManagerTestUtils.selectResumeWindows([
    {
      pid: 710,
      parentPid: 700,
      name: 'codex.exe',
      commandLine: `codex.exe --remote ws://127.0.0.1:34792 resume ${threadId}`,
    },
    {
      pid: 700,
      parentPid: 650,
      name: 'cmd.exe',
      commandLine: `cmd.exe /d /s /c "codex.cmd --remote ws://127.0.0.1:34792 resume ${threadId}"`,
    },
  ]);

  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.pid, 700);
  assert.equal(windows[0]?.processName, 'cmd.exe');
});
