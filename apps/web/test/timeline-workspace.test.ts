import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDiffLineViews,
  buildFileChangeHeadlineText,
  buildRenderableChangesFromSource,
  formatFileChangeStatsText,
} from '../src/features/timeline/TimelineWorkspace.js';

test('file change preview data dedupes identical path entries from changes and patch parsing', () => {
  const changes = buildRenderableChangesFromSource({
    patch: '*** Begin Patch\n*** Update File: src/dup.ts\n+line\n*** End Patch',
    changes: [
      { path: 'src/dup.ts', kind: 'update', addedLines: 3, deletedLines: 1 },
    ],
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.path, 'src/dup.ts');
  assert.equal(changes[0]?.kind, 'update');
  assert.equal(changes[0]?.addedLines, 3);
  assert.equal(changes[0]?.deletedLines, 1);
});

test('file change stats text still renders when there are only added lines', () => {
  assert.equal(formatFileChangeStatsText({ addedLines: 4, deletedLines: 0 }), '+4');
  assert.equal(formatFileChangeStatsText({ addedLines: 0, deletedLines: 2 }), '-2');
});

test('file change stats are derived from per-change diffs when structured counts are absent', () => {
  const changes = buildRenderableChangesFromSource({
    changes: [
      {
        path: 'src/from-diff.ts',
        kind: 'update',
        diff: '@@ -10,2 +10,3 @@\n keep\n-old\n+new\n+again',
      },
    ],
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.addedLines, 2);
  assert.equal(changes[0]?.deletedLines, 1);
});

test('diff line views include old and new line numbers for changed lines', () => {
  const lines = buildDiffLineViews('@@ -10,2 +10,3 @@\n keep\n-old\n+new\n+again');

  assert.deepEqual(
    lines.map((line) => ({
      text: line.text,
      kind: line.kind,
      oldLine: line.oldLine,
      newLine: line.newLine,
    })),
    [
      { text: '@@ -10,2 +10,3 @@', kind: 'hunk', oldLine: undefined, newLine: undefined },
      { text: ' keep', kind: 'context', oldLine: 10, newLine: 10 },
      { text: '-old', kind: 'delete', oldLine: 11, newLine: undefined },
      { text: '+new', kind: 'add', oldLine: undefined, newLine: 11 },
      { text: '+again', kind: 'add', oldLine: undefined, newLine: 12 },
    ],
  );
});

test('file change headline text appends aggregate stats after the label', () => {
  assert.equal(
    buildFileChangeHeadlineText('文件变更', [
      { addedLines: 3, deletedLines: 0 },
      { addedLines: 1, deletedLines: 2 },
    ]),
    '文件变更 +4 / -2',
  );
});
